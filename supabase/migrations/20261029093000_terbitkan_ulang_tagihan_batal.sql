-- Terbitkan ulang tagihan SPMB yang pernah dibatalkan (SPP awal dan uang pangkal).
--
-- Latar belakang: index tagihan_unique tidak mengecualikan status batal, sehingga slot tagihan yang
-- sudah dibatalkan (mis. siswa pindah asrama <-> non asrama) tidak dapat diterbitkan ulang oleh alur
-- generate. Migrasi ini ADITIF: satu tabel riwayat immutable dan satu RPC. Tidak ada fungsi, trigger,
-- atau index lama yang diubah (tagihan_unique dan 12 definisi generate yang memakainya tetap utuh).
--
-- Perilaku RPC:
--   * hanya tagihan berstatus 'dibatalkan' yang belum pernah dibayar / dihapusbukukan;
--   * SPP: hanya bulan mendatang dan belum pernah dijurnal; kategori/akun/nominal diubah lewat
--     protokol otorisasi guard_snapshot_spp_tagihan (baris audit spp_kategori_periode_audit pada
--     transaksi yang sama), sama seperti sesuaikan_kategori_spp_periode;
--   * uang pangkal: hanya jatuh tempo di masa depan; verifikasi ulang memakai verify_pangkal yang ada;
--   * tarif per siswa diganti (tarif lama dinonaktifkan beralasan, tarif baru aktif);
--   * kondisi lama disimpan di tagihan_riwayat_terbit_ulang (immutable) dan audit_keuangan.

DO $preflight$
BEGIN
  IF to_regprocedure('spmb_finance_private.preview_pangkal(uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('spmb_finance_private.verify_pangkal(uuid,uuid,text,text,numeric,text,text,boolean)') IS NULL
     OR to_regprocedure('public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric)') IS NULL
     OR to_regprocedure('public.is_tahun_buku_pendidikan_locked(uuid)') IS NULL
     OR to_regprocedure('public.has_role(uuid,text)') IS NULL
     OR to_regclass('public.spp_kategori_periode_audit') IS NULL
     OR to_regclass('public.spp_kategori_periode') IS NULL
     OR to_regclass('public.spmb_uang_pangkal_verifikasi') IS NULL
     OR to_regclass('public.rencana_tagihan_siswa') IS NULL
     OR to_regclass('public.payment_link') IS NULL
     OR to_regclass('public.transaksi_midtrans_item') IS NULL THEN
    RAISE EXCEPTION 'Dependensi penerbitan ulang tagihan belum lengkap; tinjau schema sebelum migrasi';
  END IF;
  IF md5(pg_get_functiondef('spmb_finance_private.verify_pangkal(uuid,uuid,text,text,numeric,text,text,boolean)'::regprocedure))<>'bfdb447dfa7b293472c6470b67b5cbf0'
     OR md5(pg_get_functiondef('spmb_finance_private.preview_pangkal(uuid,uuid,text,text)'::regprocedure))<>'ce58e7c4a4da77ed051c93e68faa063a'
     OR md5(pg_get_functiondef('public.guard_snapshot_spp_tagihan()'::regprocedure))<>'2903697d144a3970a684e25f8a200a20'
     OR md5(pg_get_functiondef('public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)'::regprocedure))<>'cd7b9d5c22f3d671dee0ca271e9a10be' THEN
    RAISE EXCEPTION 'Definisi fungsi dependensi berubah sejak ditinjau; hentikan dan tinjau ulang sebelum migrasi';
  END IF;
END;
$preflight$;

CREATE TABLE public.tagihan_riwayat_terbit_ulang (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tagihan_id uuid NOT NULL REFERENCES public.tagihan(id) ON DELETE RESTRICT,
  siswa_id uuid NOT NULL,
  jenis_id uuid NOT NULL,
  jenis_tagihan text NOT NULL CHECK (jenis_tagihan IN ('spp','uang_pangkal')),
  alasan text NOT NULL CHECK (length(btrim(alasan)) BETWEEN 10 AND 1000),
  nominal_bruto_lama numeric NOT NULL,
  nominal_bruto_baru numeric NOT NULL CHECK (nominal_bruto_baru > 0),
  snapshot_tagihan_lama jsonb NOT NULL,
  snapshot_tarif_lama jsonb,
  snapshot_verifikasi_lama jsonb,
  tarif_baru_id uuid,
  spp_audit_id uuid,
  diterbitkan_oleh uuid NOT NULL,
  diterbitkan_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tagihan_riwayat_terbit_ulang_tagihan_idx ON public.tagihan_riwayat_terbit_ulang(tagihan_id);
CREATE INDEX tagihan_riwayat_terbit_ulang_siswa_idx ON public.tagihan_riwayat_terbit_ulang(siswa_id);

ALTER TABLE public.tagihan_riwayat_terbit_ulang ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tagihan_riwayat_terbit_ulang FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tagihan_riwayat_terbit_ulang TO authenticated;
CREATE POLICY tagihan_riwayat_terbit_ulang_staff_read ON public.tagihan_riwayat_terbit_ulang
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'keuangan'));

CREATE FUNCTION public.guard_tagihan_riwayat_terbit_ulang_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Riwayat penerbitan ulang tagihan tidak dapat diubah atau dihapus';
END;
$function$;
CREATE TRIGGER guard_tagihan_riwayat_terbit_ulang_immutable
  BEFORE UPDATE OR DELETE ON public.tagihan_riwayat_terbit_ulang
  FOR EACH ROW EXECUTE FUNCTION public.guard_tagihan_riwayat_terbit_ulang_immutable();
CREATE TRIGGER guard_tagihan_riwayat_terbit_ulang_truncate
  BEFORE TRUNCATE ON public.tagihan_riwayat_terbit_ulang
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_tagihan_riwayat_terbit_ulang_immutable();

CREATE FUNCTION public.terbitkan_ulang_tagihan_batal(
  p_tagihan_id uuid,
  p_nominal_bruto numeric,
  p_alasan text,
  p_apply boolean DEFAULT false,
  p_preview_hash text DEFAULT NULL,
  p_alumni_asrama text DEFAULT 'none',
  p_fase_mta text DEFAULT NULL,
  p_catatan text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_t public.tagihan;
  v_jp public.jenis_pembayaran;
  v_kind text;
  v_dept_kode text;
  v_month date;
  v_kategori text;
  v_akun uuid;
  v_n integer;
  v_q jsonb;
  v_q2 jsonb;
  v_detail_id uuid;
  v_bruto numeric;
  v_old_bruto numeric;
  v_diskon numeric := 0;
  v_diskon_id uuid;
  v_netto numeric;
  v_tarif public.tarif_tagihan;
  v_ver public.spmb_uang_pangkal_verifikasi;
  v_preview jsonb;
  v_hash text;
  v_new_tarif_id uuid;
  v_audit_id uuid;
  v_perubahan jsonb;
  v_riwayat_id uuid;
  v_alumni text := COALESCE(p_alumni_asrama,'none');
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'keuangan')) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk menerbitkan ulang tagihan';
  END IF;
  IF p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Alasan minimal 10 karakter wajib diisi';
  END IF;

  IF p_apply THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('terbit-ulang:'||p_tagihan_id::text,0));
    SELECT * INTO v_t FROM public.tagihan WHERE id=p_tagihan_id FOR UPDATE;
  ELSE
    SELECT * INTO v_t FROM public.tagihan WHERE id=p_tagihan_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tagihan tidak ditemukan'; END IF;
  IF v_t.status<>'dibatalkan' THEN
    RAISE EXCEPTION 'Hanya tagihan berstatus dibatalkan yang dapat diterbitkan ulang; tagihan dihapusbuku melalui proses terpisah';
  END IF;

  SELECT * INTO v_jp FROM public.jenis_pembayaran WHERE id=v_t.jenis_id;
  SELECT d.kode INTO v_dept_kode FROM public.departemen d WHERE d.id=v_jp.departemen_id;
  IF v_jp.tipe='bulanan' AND lower(btrim(v_jp.nama)) ~ '^spp([[:space:]-]|$)' THEN
    v_kind:='spp';
  ELSIF v_jp.tipe='sekali' AND upper(btrim(v_jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$' THEN
    v_kind:='uang_pangkal';
  ELSE
    RAISE EXCEPTION 'Jenis tagihan ini belum didukung untuk penerbitan ulang';
  END IF;

  IF v_t.pembayaran_id IS NOT NULL OR v_t.write_off_id IS NOT NULL OR COALESCE(v_t.legacy_paid_amount,0)>0
     OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=v_t.id) THEN
    RAISE EXCEPTION 'Tagihan sudah memiliki pembayaran atau hapus buku; gunakan koreksi keuangan';
  END IF;
  IF v_t.tahun_akademik_id IS NULL THEN
    RAISE EXCEPTION 'Tagihan tanpa tahun ajaran tujuan tidak dapat diterbitkan ulang; periksa melalui koreksi';
  END IF;
  IF public.is_tahun_buku_pendidikan_locked(v_t.tahun_ajaran_id)
     OR EXISTS(SELECT 1 FROM public.tahun_buku b WHERE b.id=v_t.tahun_ajaran_id AND COALESCE(b.ditutup,false)) THEN
    RAISE EXCEPTION 'Tahun Buku tagihan sudah ditutup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans m ON m.id=i.transaksi_id
    WHERE (i.tagihan_id=v_t.id OR (i.tagihan_id IS NULL AND i.siswa_id=v_t.siswa_id AND i.jenis_id=v_t.jenis_id
           AND COALESCE(i.bulan,0)=COALESCE(v_t.bulan,0) AND i.tahun_ajaran_id=v_t.tahun_ajaran_id))
      AND (i.pembayaran_id IS NOT NULL OR m.status IS NULL
           OR m.status NOT IN ('failed','expired','cancelled','canceled','deny','cancel'))
  ) THEN
    RAISE EXCEPTION 'Tagihan terhubung dengan pembayaran online aktif';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_link pl
             WHERE pl.canceled_at IS NULL AND pl.expires_at>now() AND v_t.id=ANY(pl.tagihan_ids)) THEN
    RAISE EXCEPTION 'Tagihan masih terhubung dengan link pembayaran aktif';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rencana_tagihan_siswa r
             WHERE r.siswa_id=v_t.siswa_id AND r.jenis_id=v_t.jenis_id AND r.aktif) THEN
    RAISE EXCEPTION 'Siswa memiliki rencana tagihan aktif untuk jenis ini; ubah melalui Edit Rencana';
  END IF;

  SELECT * INTO v_tarif FROM public.tarif_tagihan x
   WHERE x.aktif AND x.jenis_id=v_t.jenis_id AND x.siswa_id=v_t.siswa_id
     AND x.tahun_ajaran_id=v_t.tahun_ajaran_id AND x.kelas_id IS NULL
   LIMIT 1;

  IF v_kind='spp' THEN
    IF v_dept_kode NOT IN ('SMP','SMA','MTA') THEN
      RAISE EXCEPTION 'Penerbitan ulang SPP hanya untuk jenjang SMP/SMA/MTA';
    END IF;
    IF p_nominal_bruto IS NULL OR p_nominal_bruto<=0 OR p_nominal_bruto>100000000
       OR p_nominal_bruto::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Nominal bruto SPP harus lebih dari 0 dan maksimal Rp100.000.000';
    END IF;
    IF v_t.bulan IS NULL OR v_t.jurnal_piutang_id IS NOT NULL OR v_t.jurnal_pembalik_id IS NOT NULL
       OR v_t.pengakuan_spp_selesai IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'SPP ini pernah dijurnal; gunakan koreksi keuangan';
    END IF;
    v_month := date_trunc('month',COALESCE(v_t.tanggal_pengakuan,v_t.jatuh_tempo))::date;
    IF v_month <= date_trunc('month',v_today)::date THEN
      RAISE EXCEPTION 'Hanya SPP bulan mendatang yang dapat diterbitkan ulang';
    END IF;
    SELECT sd.status_asrama,sd.id INTO v_kategori,v_detail_id FROM public.siswa_detail sd
     WHERE sd.siswa_id=v_t.siswa_id AND sd.tahun_ajaran_id=v_t.tahun_akademik_id AND sd.spmb_gelombang_id IS NOT NULL
     ORDER BY sd.spmb_registered_at DESC NULLS LAST,sd.id LIMIT 1;
    IF v_kategori IS NULL OR v_kategori NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Lengkapi status asrama tujuan siswa sebelum menerbitkan ulang SPP';
    END IF;
    SELECT count(*),(array_agg(a.id))[1] INTO v_n,v_akun FROM public.akun_rekening a
     WHERE a.aktif AND a.jenis='pendapatan' AND a.kode=CASE WHEN v_kategori='asrama' THEN '4102' ELSE '4103' END;
    IF v_n<>1 THEN RAISE EXCEPTION 'Akun kategori SPP belum dikonfigurasi'; END IF;
    v_bruto := p_nominal_bruto;
    SELECT d.nominal_diskon,d.siswa_diskon_id INTO v_diskon,v_diskon_id
      FROM public.hitung_diskon_tagihan(v_t.siswa_id,v_t.jenis_id,v_t.tahun_ajaran_id,v_t.bulan,v_bruto) d;
    v_diskon := COALESCE(v_diskon,0);
    v_netto := v_bruto-v_diskon;
    v_old_bruto := COALESCE(v_t.nominal_bruto,v_t.nominal+COALESCE(v_t.nominal_diskon,0));
    v_preview := jsonb_build_object('jenis','spp','tagihan_id',v_t.id,'siswa_id',v_t.siswa_id,'periode',v_month,
      'kategori_lama',v_t.spp_kategori,'kategori_baru',v_kategori,'akun_lama',v_t.spp_akun_pendapatan_id,'akun_baru',v_akun,
      'nominal_bruto_lama',v_old_bruto,'nominal_bruto_baru',v_bruto,'nominal_diskon_baru',v_diskon,'nominal_netto_baru',v_netto,
      'dibatalkan_at',v_t.dibatalkan_at,'dibatalkan_alasan',v_t.dibatalkan_alasan,
      'tarif_lama',CASE WHEN v_tarif.id IS NULL THEN NULL ELSE jsonb_build_object('id',v_tarif.id,'nominal',v_tarif.nominal) END);
  ELSE
    IF v_t.bulan IS NOT NULL THEN RAISE EXCEPTION 'Uang pangkal harus tagihan sekali bayar'; END IF;
    IF v_t.jatuh_tempo IS NULL OR v_t.jatuh_tempo<=v_today THEN
      RAISE EXCEPTION 'Jatuh tempo uang pangkal sudah lewat; penerbitan ulang yang memposting jurnal belum didukung, gunakan koreksi keuangan';
    END IF;
    IF v_t.jurnal_piutang_id IS NOT NULL AND v_t.jurnal_pembalik_id IS NULL THEN
      RAISE EXCEPTION 'Jurnal piutang tagihan ini belum dibalik; gunakan koreksi keuangan';
    END IF;
    v_q := spmb_finance_private.preview_pangkal(v_t.siswa_id,v_t.tahun_akademik_id,v_alumni,p_fase_mta);
    IF (v_q->>'jenis_id')::uuid IS DISTINCT FROM v_t.jenis_id OR (v_q->>'tahun_buku_id')::uuid IS DISTINCT FROM v_t.tahun_ajaran_id
       OR (v_q->'tagihan'->>'id')::uuid IS DISTINCT FROM v_t.id THEN
      RAISE EXCEPTION 'Jenis atau tahun buku tagihan tidak sesuai tujuan SPMB siswa saat ini';
    END IF;
    v_bruto := COALESCE(p_nominal_bruto,(v_q->>'bruto_acuan')::numeric);
    IF v_bruto IS NULL OR v_bruto<=0 THEN RAISE EXCEPTION 'Nominal bruto uang pangkal harus valid'; END IF;
    v_detail_id := (v_q->>'siswa_detail_id')::uuid;
    SELECT * INTO v_ver FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_detail_id=v_detail_id;
    v_old_bruto := COALESCE(v_t.nominal_bruto,v_t.nominal);
    v_preview := jsonb_build_object('jenis','uang_pangkal','tagihan_id',v_t.id,'siswa_id',v_t.siswa_id,
      'program_baru',v_q->>'program','nominal_bruto_lama',v_old_bruto,'nominal_bruto_baru',v_bruto,
      'bruto_acuan',v_q->'bruto_acuan','keringanan_alumni',v_q->'keringanan_alumni',
      'verifikasi_lama_id',v_ver.id,'dibatalkan_at',v_t.dibatalkan_at,'dibatalkan_alasan',v_t.dibatalkan_alasan,
      'pratinjau_spmb',v_q->>'preview_hash',
      'tarif_lama',CASE WHEN v_tarif.id IS NULL THEN NULL ELSE jsonb_build_object('id',v_tarif.id,'nominal',v_tarif.nominal) END);
  END IF;

  v_hash := md5(v_preview::text);
  IF NOT p_apply THEN
    RETURN v_preview||jsonb_build_object('preview_hash',v_hash,'applied',false);
  END IF;
  IF p_preview_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Data berubah sejak pratinjau; muat pratinjau ulang';
  END IF;

  -- Tarif per siswa: nonaktifkan tarif lama (beralasan) dan buat tarif baru.
  IF v_tarif.id IS NOT NULL THEN
    UPDATE public.tarif_tagihan SET aktif=false,
      dinonaktifkan_alasan='Diterbitkan ulang setelah pembatalan: '||btrim(p_alasan)
     WHERE id=v_tarif.id AND aktif;
  END IF;
  INSERT INTO public.tarif_tagihan(jenis_id,siswa_id,kelas_id,angkatan_id,tahun_ajaran_id,nominal,aktif,keterangan)
  VALUES(v_t.jenis_id,v_t.siswa_id,NULL,NULL,v_t.tahun_ajaran_id,v_bruto,true,
    CASE WHEN v_kind='spp' THEN 'SPP awal SPMB per bulan (diterbitkan ulang)'
         ELSE 'Tagihan awal siswa baru dari SPMB (diterbitkan ulang)' END)
  RETURNING id INTO v_new_tarif_id;

  IF v_kind='spp' THEN
    -- Langkah 1: hanya status (tidak menyentuh kolom yang dijaga guard snapshot SPP).
    UPDATE public.tagihan SET status='terjadwal',dibatalkan_alasan=NULL,dibatalkan_at=NULL,dibatalkan_oleh=NULL,
      jurnal_pembalik_id=NULL WHERE id=v_t.id;
    -- Langkah 2: ubah snapshot lewat protokol otorisasi guard (audit + update pada transaksi yang sama).
    v_perubahan := jsonb_build_array(jsonb_build_object('periode',v_month,'tagihan_id',v_t.id,'status','terjadwal',
      'nominal',v_t.nominal,'kategori_lama',v_t.spp_kategori,'kategori_baru',v_kategori,
      'akun_lama',v_t.spp_akun_pendapatan_id,'akun_baru',v_akun,
      'nominal_bruto_lama',v_old_bruto,'nominal_bruto_baru',v_bruto,
      'nominal_diskon_lama',COALESCE(v_t.nominal_diskon,0),'nominal_diskon_baru',v_diskon,
      'nominal_netto_lama',v_t.nominal,'nominal_netto_baru',v_netto,
      'siswa_diskon_id_lama',v_t.siswa_diskon_id,'siswa_diskon_id_baru',v_diskon_id,
      'aksi','ubah_tagihan','alasan',NULL,'sumber','terbitkan_ulang_tagihan_batal'));
    INSERT INTO public.spp_kategori_periode_audit(siswa_id,jenis_id,mulai,selesai,kategori,nominal_bruto,alasan,dibuat_oleh,perubahan)
    VALUES(v_t.siswa_id,v_t.jenis_id,v_month,v_month,v_kategori,v_bruto,btrim(p_alasan),v_uid,v_perubahan)
    RETURNING id INTO v_audit_id;
    INSERT INTO public.spp_kategori_periode(siswa_id,jenis_id,periode,kategori,nominal_bruto,audit_id)
    VALUES(v_t.siswa_id,v_t.jenis_id,v_month,v_kategori,v_bruto,v_audit_id)
    ON CONFLICT(siswa_id,jenis_id,periode) DO UPDATE
      SET kategori=EXCLUDED.kategori,nominal_bruto=EXCLUDED.nominal_bruto,audit_id=EXCLUDED.audit_id;
    UPDATE public.tagihan SET spp_kategori=v_kategori,spp_akun_pendapatan_id=v_akun,nominal_bruto=v_bruto,
      nominal_diskon=v_diskon,nominal=v_netto,siswa_diskon_id=v_diskon_id WHERE id=v_t.id;
  ELSE
    IF v_ver.id IS NOT NULL THEN
      DELETE FROM public.spmb_uang_pangkal_verifikasi WHERE id=v_ver.id;  -- tersimpan di riwayat; diganti verifikasi baru
    END IF;
    UPDATE public.tagihan SET status='terjadwal',dibatalkan_alasan=NULL,dibatalkan_at=NULL,dibatalkan_oleh=NULL,
      jurnal_pembalik_id=NULL,jurnal_piutang_id=NULL,nominal_bruto=v_bruto,nominal_diskon=0,nominal=v_bruto,
      siswa_diskon_id=NULL WHERE id=v_t.id;
    v_q2 := spmb_finance_private.preview_pangkal(v_t.siswa_id,v_t.tahun_akademik_id,v_alumni,p_fase_mta);
    PERFORM spmb_finance_private.verify_pangkal(v_t.siswa_id,v_t.tahun_akademik_id,v_alumni,p_fase_mta,
      v_bruto,p_catatan,v_q2->>'preview_hash',true);
  END IF;

  INSERT INTO public.tagihan_riwayat_terbit_ulang(tagihan_id,siswa_id,jenis_id,jenis_tagihan,alasan,nominal_bruto_lama,
    nominal_bruto_baru,snapshot_tagihan_lama,snapshot_tarif_lama,snapshot_verifikasi_lama,tarif_baru_id,spp_audit_id,diterbitkan_oleh)
  VALUES(v_t.id,v_t.siswa_id,v_t.jenis_id,v_kind,btrim(p_alasan),v_old_bruto,v_bruto,to_jsonb(v_t),
    CASE WHEN v_tarif.id IS NULL THEN NULL ELSE to_jsonb(v_tarif) END,
    CASE WHEN v_ver.id IS NULL THEN NULL ELSE to_jsonb(v_ver) END,v_new_tarif_id,v_audit_id,v_uid)
  RETURNING id INTO v_riwayat_id;

  INSERT INTO public.audit_keuangan(tabel_sumber,record_id,aksi,data_lama,data_baru,keterangan,departemen_id,dibuat_oleh)
  VALUES('tagihan',v_t.id::text,'UPDATE',
    jsonb_build_object('status','dibatalkan','nominal',v_t.nominal,'nominal_bruto',v_old_bruto,
      'dibatalkan_alasan',v_t.dibatalkan_alasan,'jurnal_piutang_id',v_t.jurnal_piutang_id,'jurnal_pembalik_id',v_t.jurnal_pembalik_id),
    jsonb_build_object('status','terjadwal','nominal_bruto',v_bruto,'alasan',btrim(p_alasan),'riwayat_id',v_riwayat_id),
    'Penerbitan ulang tagihan '||v_jp.nama||': '||v_old_bruto::text||' -> '||v_bruto::text||' — '||btrim(p_alasan),
    v_jp.departemen_id,v_uid);

  RETURN v_preview||jsonb_build_object('preview_hash',v_hash,'applied',true,'riwayat_id',v_riwayat_id,
    'tarif_baru_id',v_new_tarif_id,'spp_audit_id',v_audit_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.terbitkan_ulang_tagihan_batal(uuid,numeric,text,boolean,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terbitkan_ulang_tagihan_batal(uuid,numeric,text,boolean,text,text,text,text) TO authenticated;
