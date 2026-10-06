-- Target: Hijrah V5 (cmvzcpeiuompqgdvflky). Review sebelum migration production.
-- Hanya menambah alur penyesuaian kategori untuk BULAN MENDATANG.
-- Tidak menjalankan koreksi data, mengubah nominal/status siswa, atau mereklasifikasi jurnal.
DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='generate_tagihan_batch') IS DISTINCT FROM '915636b34bda90bca811a81be826699b' OR
     (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='guard_snapshot_spp_tagihan') IS DISTINCT FROM 'a11486e57b6f9797eae794c65ded3e9b' THEN
    RAISE EXCEPTION 'Fungsi SPP berubah sejak review; periksa ulang migration';
  END IF;
END;
$preflight$;

CREATE TABLE public.spp_kategori_periode_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id),
  jenis_id uuid NOT NULL REFERENCES public.jenis_pembayaran(id),
  mulai date NOT NULL,
  selesai date NOT NULL,
  kategori text NOT NULL CHECK (kategori IN ('asrama','non_asrama')),
  alasan text NOT NULL CHECK (length(btrim(alasan)) BETWEEN 10 AND 1000),
  dibuat_oleh uuid NOT NULL REFERENCES public.users_profile(id),
  dibuat_at timestamptz NOT NULL DEFAULT now(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  perubahan jsonb NOT NULL
);
CREATE TABLE public.spp_kategori_periode (
  siswa_id uuid NOT NULL REFERENCES public.siswa(id),
  jenis_id uuid NOT NULL REFERENCES public.jenis_pembayaran(id),
  periode date NOT NULL CHECK (extract(day FROM periode)=1),
  kategori text NOT NULL CHECK (kategori IN ('asrama','non_asrama')),
  audit_id uuid NOT NULL REFERENCES public.spp_kategori_periode_audit(id),
  PRIMARY KEY (siswa_id,jenis_id,periode)
);
ALTER TABLE public.spp_kategori_periode ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spp_kategori_periode_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spp_kategori_periode,public.spp_kategori_periode_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.spp_kategori_periode TO service_role;
GRANT SELECT,INSERT ON public.spp_kategori_periode_audit TO service_role;
CREATE INDEX ON public.spp_kategori_periode_audit(siswa_id,dibuat_at DESC);
COMMENT ON TABLE public.spp_kategori_periode IS
 'Kategori layanan per siswa, jenis SPP, dan bulan. Tidak mengubah status siswa.';
COMMENT ON TABLE public.spp_kategori_periode_audit IS
 'Audit penyesuaian terotorisasi, termasuk kategori/akun lama dan baru setiap tagihan.';

CREATE FUNCTION public.snapshot_spp_periode(p_jenis_id uuid,p_siswa_id uuid,p_periode date)
RETURNS TABLE(kategori text,akun_id uuid)
LANGUAGE plpgsql SET search_path=''
AS $fn$
DECLARE v_override text; v_snapshot record; v_count integer;
BEGIN
  -- Semua proses generate untuk siswa yang sama mengunci sumber yang sama.
  PERFORM 1 FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR SHARE;
  SELECT k.kategori INTO v_override FROM public.spp_kategori_periode k
  WHERE k.siswa_id=p_siswa_id AND k.jenis_id=p_jenis_id
    AND k.periode=date_trunc('month',p_periode)::date;
  IF v_override IS NULL THEN
    RETURN QUERY SELECT * FROM public.snapshot_spp_siswa(p_jenis_id,p_siswa_id);
    RETURN;
  END IF;
  SELECT count(*),(array_agg(a.id))[1] INTO v_count,akun_id
  FROM public.akun_rekening a WHERE a.aktif AND a.jenis='pendapatan'
    AND a.kode=CASE WHEN v_override='asrama' THEN '4102' ELSE '4103' END;
  IF v_count<>1 THEN RAISE EXCEPTION 'Akun SPP kategori harus tersedia tepat satu dan aktif'; END IF;
  kategori:=v_override;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_snapshot_spp_tagihan()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $fn$
DECLARE v_snapshot record; v_authorized boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_snapshot FROM public.snapshot_spp_periode(
      NEW.jenis_id,NEW.siswa_id,COALESCE(NEW.tanggal_pengakuan,NEW.jatuh_tempo));
    NEW.spp_kategori:=v_snapshot.kategori;
    NEW.spp_akun_pendapatan_id:=v_snapshot.akun_id;
  ELSE
    IF OLD.spp_kategori IS NOT NULL AND
       (NEW.siswa_id IS DISTINCT FROM OLD.siswa_id OR NEW.jenis_id IS DISTINCT FROM OLD.jenis_id) THEN
      RAISE EXCEPTION 'Identitas tagihan dengan snapshot SPP tidak dapat diubah';
    END IF;
    IF NEW.spp_kategori IS DISTINCT FROM OLD.spp_kategori OR
       NEW.spp_akun_pendapatan_id IS DISTINCT FROM OLD.spp_akun_pendapatan_id THEN
      IF current_user IN ('postgres','service_role') THEN
        SELECT EXISTS(
          SELECT 1 FROM public.spp_kategori_periode_audit a
          CROSS JOIN LATERAL jsonb_array_elements(a.perubahan) e
          WHERE a.transaction_id=txid_current() AND a.siswa_id=OLD.siswa_id AND a.jenis_id=OLD.jenis_id
            AND e->>'tagihan_id'=OLD.id::text AND e->>'aksi'='ubah_tagihan'
            AND (e->>'kategori_lama') IS NOT DISTINCT FROM OLD.spp_kategori
            AND (e->>'akun_lama') IS NOT DISTINCT FROM OLD.spp_akun_pendapatan_id::text
            AND e->>'kategori_baru'=NEW.spp_kategori
            AND e->>'akun_baru'=NEW.spp_akun_pendapatan_id::text
        ) INTO v_authorized;
      END IF;
      IF v_authorized THEN
        IF OLD.status NOT IN ('terjadwal','belum_bayar') OR OLD.jurnal_piutang_id IS NOT NULL
           OR OLD.pembayaran_id IS NOT NULL OR OLD.jurnal_pembalik_id IS NOT NULL
           OR OLD.write_off_id IS NOT NULL OR OLD.pengakuan_spp_selesai IS DISTINCT FROM false
           OR COALESCE(OLD.legacy_paid_amount,0)>0
           OR COALESCE(OLD.tanggal_pengakuan,OLD.jatuh_tempo) IS NULL
           OR date_trunc('month',COALESCE(OLD.tanggal_pengakuan,OLD.jatuh_tempo))
              <=date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')
           OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=OLD.id) THEN
          RAISE EXCEPTION 'Tagihan historis atau sudah ditransaksikan tidak boleh disesuaikan';
        END IF;
      ELSIF current_user<>'postgres' OR OLD.spp_kategori IS NOT NULL OR OLD.spp_akun_pendapatan_id IS NOT NULL THEN
        RAISE EXCEPTION 'Snapshot SPP hanya dapat disesuaikan melalui alur kategori per periode';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Ubah tepat satu pemanggilan pada generate: jurnal dan tagihan memakai bulan yang sama.
DO $generate$
DECLARE v_def text; v_old text:='public.snapshot_spp_siswa(p_jenis_id,v_row.siswa_id)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO STRICT v_def FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname='generate_tagihan_batch';
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'Pemanggilan snapshot generate tidak sesuai review';
  END IF;
  EXECUTE replace(v_def,v_old,'public.snapshot_spp_periode(p_jenis_id,v_row.siswa_id,v_jatuh_tempo)');
END;
$generate$;

CREATE FUNCTION public.sesuaikan_kategori_spp_periode(
  p_siswa_id uuid,p_jenis_id uuid,p_mulai date,p_selesai date,p_kategori text,p_user_id uuid,
  p_apply boolean DEFAULT false,p_preview_hash text DEFAULT NULL,p_alasan text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $fn$
DECLARE
  v_month date; v_t public.tagihan; v_count integer; v_akun uuid; v_nakun integer;
  v_plan public.spp_kategori_periode; v_rows jsonb:='[]'; v_row jsonb; v_alasan text;
  v_action text; v_oldcat text; v_hash text; v_audit uuid; v_eligible integer:=0;
  v_changes integer:=0; v_jp public.jenis_pembayaran; v_student public.siswa;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users_profile WHERE id=p_user_id AND role IN ('admin','keuangan') AND aktif
  ) THEN RAISE EXCEPTION 'Akses penyesuaian kategori SPP ditolak'; END IF;
  IF p_kategori IS NULL OR p_kategori NOT IN ('asrama','non_asrama') THEN
    RAISE EXCEPTION 'Kategori harus Asrama atau Non Asrama';
  END IF;
  IF p_mulai IS NULL OR p_selesai IS NULL OR extract(day FROM p_mulai)<>1 OR extract(day FROM p_selesai)<>1
     OR p_mulai<=date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')::date
     OR p_selesai<p_mulai OR p_selesai>=(p_mulai+interval '24 months')::date THEN
    RAISE EXCEPTION 'Pilih bulan mendatang, maksimal 24 bulan, dengan tanggal awal bulan';
  END IF;
  IF p_apply THEN
    IF p_preview_hash IS NULL OR p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 10 AND 1000 THEN
      RAISE EXCEPTION 'Pratinjau dan alasan minimal 10 karakter wajib diisi';
    END IF;
    -- Gagal cepat jika kasir/webhook/generate/tutup buku sedang berjalan.
    LOCK TABLE public.tagihan,public.pembayaran,public.transaksi_midtrans,
      public.transaksi_midtrans_item,public.spp_kategori_periode IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.tahun_buku,public.log_tutup_buku IN SHARE MODE NOWAIT;
    PERFORM 1 FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE NOWAIT;
  END IF;
  SELECT * INTO STRICT v_jp FROM public.jenis_pembayaran WHERE id=p_jenis_id;
  SELECT * INTO STRICT v_student FROM public.siswa WHERE id=p_siswa_id;
  IF v_student.status<>'aktif' OR v_jp.departemen_id IS DISTINCT FROM v_student.departemen_id
     OR v_jp.tipe<>'bulanan' OR lower(btrim(v_jp.nama)) !~ '^spp([[:space:]-]|$)'
     OR NOT v_jp.aktif OR NOT EXISTS(SELECT 1 FROM public.departemen WHERE id=v_jp.departemen_id AND kode IN ('SMP','SMA','MTA')) THEN
    RAISE EXCEPTION 'Pilih siswa aktif dan jenis SPP SMP/SMA/MTA pada lembaga yang sama';
  END IF;
  SELECT count(*),(array_agg(id))[1] INTO v_nakun,v_akun FROM public.akun_rekening
  WHERE aktif AND jenis='pendapatan' AND kode=CASE WHEN p_kategori='asrama' THEN '4102' ELSE '4103' END;
  IF v_nakun<>1 THEN RAISE EXCEPTION 'Akun kategori SPP belum dikonfigurasi'; END IF;
  FOR v_month IN SELECT generate_series(p_mulai,p_selesai,interval '1 month')::date LOOP
    v_t:=NULL; v_plan:=NULL; v_alasan:=NULL; v_action:='jadwalkan';
    SELECT * INTO v_plan FROM public.spp_kategori_periode
    WHERE siswa_id=p_siswa_id AND jenis_id=p_jenis_id AND periode=v_month;
    SELECT count(*) INTO v_count FROM public.tagihan t
    WHERE t.siswa_id=p_siswa_id AND t.jenis_id=p_jenis_id AND t.status<>'dibatalkan'
      AND date_trunc('month',COALESCE(t.tanggal_pengakuan,t.jatuh_tempo))::date=v_month;
    IF v_count>1 THEN
      v_alasan:='Terdapat lebih dari satu tagihan aktif pada bulan ini';
    ELSIF v_count=1 THEN
      SELECT * INTO STRICT v_t FROM public.tagihan t
      WHERE t.siswa_id=p_siswa_id AND t.jenis_id=p_jenis_id AND t.status<>'dibatalkan'
        AND date_trunc('month',COALESCE(t.tanggal_pengakuan,t.jatuh_tempo))::date=v_month;
      v_action:='ubah_tagihan';
      IF v_t.status NOT IN ('terjadwal','belum_bayar') OR v_t.jurnal_piutang_id IS NOT NULL
         OR v_t.pembayaran_id IS NOT NULL OR v_t.jurnal_pembalik_id IS NOT NULL
         OR v_t.write_off_id IS NOT NULL OR v_t.pengakuan_spp_selesai IS DISTINCT FROM false
         OR COALESCE(v_t.legacy_paid_amount,0)>0
         OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=v_t.id) THEN
        v_alasan:='Tagihan sudah memiliki pembayaran, jurnal, atau koreksi';
      ELSIF EXISTS (
        SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans m ON m.id=i.transaksi_id
        WHERE (i.tagihan_id=v_t.id OR (i.tagihan_id IS NULL AND i.siswa_id=v_t.siswa_id
          AND i.jenis_id=v_t.jenis_id AND i.bulan=v_t.bulan AND i.tahun_ajaran_id=v_t.tahun_ajaran_id))
          AND (i.pembayaran_id IS NOT NULL OR m.status IS NULL
            OR m.status NOT IN ('failed','expired','cancelled','canceled','deny','cancel'))
      ) THEN v_alasan:='Tagihan terhubung dengan pembayaran online aktif'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tahun_buku b WHERE v_month BETWEEN b.tanggal_mulai AND b.tanggal_selesai
       AND (b.ditutup OR EXISTS(SELECT 1 FROM public.log_tutup_buku l WHERE l.tahun_ajaran_id=b.id AND l.unit='unit_pendidikan'))
    ) THEN v_alasan:='Periode sudah ditutup buku'; END IF;
    v_oldcat:=COALESCE(v_t.spp_kategori,v_plan.kategori);
    IF v_alasan IS NOT NULL THEN v_action:='terkunci';
    ELSIF v_plan.kategori=p_kategori AND (v_t.id IS NULL OR
       (v_t.spp_kategori=p_kategori AND v_t.spp_akun_pendapatan_id=v_akun)) THEN
      v_action:='sudah_sesuai';
    ELSE v_eligible:=v_eligible+1; END IF;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'periode',v_month,'tagihan_id',v_t.id,'status',v_t.status,'nominal',v_t.nominal,
      'kategori_lama',v_oldcat,'kategori_baru',p_kategori,'akun_lama',v_t.spp_akun_pendapatan_id,
      'akun_baru',v_akun,'rencana_lama',v_plan.kategori,'rencana_audit_lama',v_plan.audit_id,
      'aksi',v_action,'alasan',v_alasan));
  END LOOP;
  v_hash:=md5(jsonb_build_object('siswa',p_siswa_id,'jenis',p_jenis_id,'mulai',p_mulai,
    'selesai',p_selesai,'kategori',p_kategori,'rows',v_rows)::text);
  IF p_apply THEN
    IF p_preview_hash IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'Data berubah sejak pratinjau. Muat pratinjau ulang'; END IF;
    IF v_eligible=0 THEN RAISE EXCEPTION 'Tidak ada bulan yang dapat disesuaikan'; END IF;
    INSERT INTO public.spp_kategori_periode_audit(siswa_id,jenis_id,mulai,selesai,kategori,alasan,dibuat_oleh,perubahan)
    VALUES(p_siswa_id,p_jenis_id,p_mulai,p_selesai,p_kategori,btrim(p_alasan),p_user_id,v_rows)
    RETURNING id INTO v_audit;
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_rows) LOOP
      IF v_row->>'aksi' IN ('jadwalkan','ubah_tagihan') THEN
        INSERT INTO public.spp_kategori_periode(siswa_id,jenis_id,periode,kategori,audit_id)
        VALUES(p_siswa_id,p_jenis_id,(v_row->>'periode')::date,p_kategori,v_audit)
        ON CONFLICT(siswa_id,jenis_id,periode) DO UPDATE SET kategori=EXCLUDED.kategori,audit_id=EXCLUDED.audit_id;
        IF v_row->>'aksi'='ubah_tagihan' THEN
          UPDATE public.tagihan SET spp_kategori=p_kategori,spp_akun_pendapatan_id=v_akun
          WHERE id=(v_row->>'tagihan_id')::uuid;
          v_changes:=v_changes+1;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('preview_hash',v_hash,'rows',v_rows,'bulan_dapat_disesuaikan',v_eligible,
    'applied',p_apply,'tagihan_diubah',v_changes,'audit_id',v_audit);
END;
$fn$;

REVOKE ALL ON FUNCTION public.snapshot_spp_periode(uuid,uuid,date),
  public.sesuaikan_kategori_spp_periode(uuid,uuid,date,date,text,uuid,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_spp_periode(uuid,uuid,date),
  public.sesuaikan_kategori_spp_periode(uuid,uuid,date,date,text,uuid,boolean,text,text)
  TO service_role;

