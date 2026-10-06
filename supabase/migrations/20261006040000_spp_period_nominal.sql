-- Target: Hijrah V5 (cmvzcpeiuompqgdvflky).
-- Tahap 2 kategori SPP per bulan: snapshot kategori + nominal bruto untuk bulan mendatang.
-- Tidak mengubah data siswa/tagihan/jurnal historis. Migration berhenti jika rencana lama sudah terisi.

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.spp_kategori_periode)
     OR EXISTS (SELECT 1 FROM public.spp_kategori_periode_audit) THEN
    RAISE EXCEPTION 'Rencana/audit kategori SPP sudah berisi data; review manual diperlukan sebelum menambah snapshot nominal';
  END IF;

  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname='generate_tagihan_batch')
       IS DISTINCT FROM '10f1bb26ebf964a09745f3091815b6a8'
     OR (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname='guard_snapshot_spp_tagihan')
       IS DISTINCT FROM 'adb6ac375b4280707dac79cc5b57d1e4'
     OR (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname='guard_tagihan_spp_tarif')
       IS DISTINCT FROM '28b3e810ebd096b1990b104590749dca'
     OR (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname='sesuaikan_kategori_spp_periode')
       IS DISTINCT FROM '93af9ff7ef640ab23f01c7e652c84e2c' THEN
    RAISE EXCEPTION 'Fungsi SPP production berubah sejak review; periksa ulang migration';
  END IF;
END;
$preflight$;

ALTER TABLE public.spp_kategori_periode
  ADD COLUMN nominal_bruto numeric(15,2) NOT NULL CHECK (nominal_bruto > 0);

ALTER TABLE public.spp_kategori_periode_audit
  ADD COLUMN nominal_bruto numeric(15,2) NOT NULL CHECK (nominal_bruto > 0);

COMMENT ON COLUMN public.spp_kategori_periode.nominal_bruto IS
  'Snapshot tarif bruto SPP untuk siswa dan bulan ini. Dipakai saat generate; tidak mengikuti perubahan tarif/status siswa sesudahnya.';
COMMENT ON COLUMN public.spp_kategori_periode_audit.nominal_bruto IS
  'Nominal bruto target yang diminta pada penyesuaian kategori SPP per periode.';

CREATE FUNCTION public.nominal_spp_periode(
  p_jenis_id uuid,
  p_siswa_id uuid,
  p_periode date
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path=''
AS $fn$
  SELECT k.nominal_bruto
  FROM public.spp_kategori_periode k
  WHERE k.siswa_id=p_siswa_id
    AND k.jenis_id=p_jenis_id
    AND k.periode=date_trunc('month',p_periode)::date
  LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.nominal_spp_periode(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nominal_spp_periode(uuid,uuid,date) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_tagihan_spp_tarif()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_jenis record;
  v_siswa record;
  v_tarif numeric;
  v_bruto numeric;
  v_periode date;
begin
  select nama, tipe, departemen_id into v_jenis
  from public.jenis_pembayaran where id = new.jenis_id;

  if not found
     or v_jenis.tipe is distinct from 'bulanan'
     or lower(btrim(v_jenis.nama)) !~ '^spp([[:space:]-]|$)'
  then
    return new;
  end if;

  if new.legacy_source_key is not null then
    perform 1
    from migration.legacy_tagihan_snapshot l
    where l.source_key = new.legacy_source_key
      and l.siswa_id = new.siswa_id
      and extract(month from l.period_month)::int is not distinct from new.bulan
      and abs(l.remaining::numeric - new.nominal::numeric) < 0.01;

    if not found then
      raise exception
        'Tagihan SPP legacy tidak cocok dengan snapshot sumber %',
        new.legacy_source_key;
    end if;

    if new.status is distinct from 'belum_bayar'
       or new.jurnal_piutang_id is null
    then
      raise exception
        'Tagihan SPP legacy harus berupa piutang terbuka dengan jurnal asal';
    end if;

    return new;
  end if;

  select nama, departemen_id, angkatan_id into v_siswa
  from public.siswa where id = new.siswa_id;

  if not found then
    raise exception 'Siswa tagihan SPP tidak ditemukan';
  end if;

  if v_jenis.departemen_id is distinct from v_siswa.departemen_id then
    raise exception 'Jenis SPP tidak sesuai lembaga siswa %', v_siswa.nama;
  end if;

  v_periode := coalesce(new.tanggal_pengakuan,new.jatuh_tempo);
  v_tarif := coalesce(
    public.nominal_spp_periode(new.jenis_id,new.siswa_id,v_periode),
    public.get_tarif_siswa(
      new.jenis_id, new.siswa_id, new.kelas_id,
      new.tahun_ajaran_id, v_siswa.angkatan_id
    )
  );

  if v_tarif is null or v_tarif <= 0 then
    raise exception
      'Tarif SPP belum dikonfigurasi untuk %. Tetapkan tarif terlebih dahulu.',
      v_siswa.nama;
  end if;

  v_bruto := coalesce(new.nominal_bruto, new.nominal);
  if round(v_bruto, 2) is distinct from round(v_tarif, 2) then
    raise exception
      'Nominal bruto SPP % tidak sesuai tarif efektif % untuk %',
      v_bruto, v_tarif, v_siswa.nama;
  end if;

  return new;
end;
$function$;

-- generate_tagihan_batch tetap memakai get_tarif_siswa sebagai fallback,
-- tetapi rencana per bulan menjadi sumber pertama bila tersedia.
DO $generate$
DECLARE
  v_def text;
  v_old text := $old$
        v_bruto := get_tarif_siswa(
          p_jenis_id, v_row.siswa_id, v_row.kelas_id,
          p_tahun_ajaran_id, v_angkatan_id
        );
$old$;
  v_new text := $new$
        v_bruto := COALESCE(
          public.nominal_spp_periode(p_jenis_id,v_row.siswa_id,v_pengakuan),
          get_tarif_siswa(
            p_jenis_id, v_row.siswa_id, v_row.kelas_id,
            p_tahun_ajaran_id, v_angkatan_id
          )
        );
$new$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO STRICT v_def
  FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname='generate_tagihan_batch';

  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'Blok tarif generate_tagihan_batch tidak sesuai review';
  END IF;

  EXECUTE replace(v_def,v_old,v_new);
END;
$generate$;

CREATE OR REPLACE FUNCTION public.guard_snapshot_spp_tagihan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $fn$
DECLARE
  v_snapshot record;
  v_authorized boolean:=false;
  v_old_bruto numeric;
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

    IF NEW.spp_kategori IS DISTINCT FROM OLD.spp_kategori
       OR NEW.spp_akun_pendapatan_id IS DISTINCT FROM OLD.spp_akun_pendapatan_id
       OR NEW.nominal_bruto IS DISTINCT FROM OLD.nominal_bruto THEN
      v_old_bruto:=COALESCE(OLD.nominal_bruto,OLD.nominal+COALESCE(OLD.nominal_diskon,0));

      IF current_user IN ('postgres','service_role') THEN
        SELECT EXISTS(
          SELECT 1
          FROM public.spp_kategori_periode_audit a
          CROSS JOIN LATERAL jsonb_array_elements(a.perubahan) e
          WHERE a.transaction_id=txid_current()
            AND a.siswa_id=OLD.siswa_id
            AND a.jenis_id=OLD.jenis_id
            AND e->>'tagihan_id'=OLD.id::text
            AND e->>'aksi'='ubah_tagihan'
            AND (e->>'kategori_lama') IS NOT DISTINCT FROM OLD.spp_kategori
            AND (e->>'akun_lama') IS NOT DISTINCT FROM OLD.spp_akun_pendapatan_id::text
            AND e->>'kategori_baru'=NEW.spp_kategori
            AND e->>'akun_baru'=NEW.spp_akun_pendapatan_id::text
            AND (e->>'nominal_bruto_lama')::numeric IS NOT DISTINCT FROM v_old_bruto
            AND (e->>'nominal_bruto_baru')::numeric IS NOT DISTINCT FROM NEW.nominal_bruto
            AND (e->>'nominal_diskon_lama')::numeric IS NOT DISTINCT FROM COALESCE(OLD.nominal_diskon,0)
            AND (e->>'nominal_diskon_baru')::numeric IS NOT DISTINCT FROM COALESCE(NEW.nominal_diskon,0)
            AND (e->>'nominal_netto_lama')::numeric IS NOT DISTINCT FROM OLD.nominal
            AND (e->>'nominal_netto_baru')::numeric IS NOT DISTINCT FROM NEW.nominal
            AND (e->>'siswa_diskon_id_lama') IS NOT DISTINCT FROM OLD.siswa_diskon_id::text
            AND (e->>'siswa_diskon_id_baru') IS NOT DISTINCT FROM NEW.siswa_diskon_id::text
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
      ELSIF current_user<>'postgres'
            OR OLD.spp_kategori IS NOT NULL
            OR OLD.spp_akun_pendapatan_id IS NOT NULL THEN
        RAISE EXCEPTION 'Snapshot SPP hanya dapat disesuaikan melalui alur kategori per periode';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_snapshot_spp_tagihan ON public.tagihan;
CREATE TRIGGER trg_snapshot_spp_tagihan
BEFORE INSERT OR UPDATE OF spp_kategori,spp_akun_pendapatan_id,nominal_bruto,siswa_id,jenis_id
ON public.tagihan
FOR EACH ROW EXECUTE FUNCTION public.guard_snapshot_spp_tagihan();

DROP FUNCTION public.sesuaikan_kategori_spp_periode(uuid,uuid,date,date,text,uuid,boolean,text,text);

CREATE FUNCTION public.sesuaikan_kategori_spp_periode(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_mulai date,
  p_selesai date,
  p_kategori text,
  p_nominal_bruto numeric,
  p_user_id uuid,
  p_apply boolean DEFAULT false,
  p_preview_hash text DEFAULT NULL,
  p_alasan text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path=''
AS $fn$
DECLARE
  v_month date;
  v_t public.tagihan;
  v_count integer;
  v_akun uuid;
  v_nakun integer;
  v_plan public.spp_kategori_periode;
  v_rows jsonb:='[]';
  v_row jsonb;
  v_alasan text;
  v_action text;
  v_oldcat text;
  v_hash text;
  v_audit uuid;
  v_eligible integer:=0;
  v_changes integer:=0;
  v_jp public.jenis_pembayaran;
  v_student public.siswa;
  v_old_bruto numeric;
  v_old_diskon numeric;
  v_old_netto numeric;
  v_new_diskon numeric;
  v_new_netto numeric;
  v_new_diskon_id uuid;
  v_tarif_referensi numeric;
  v_book uuid;
  v_book_count integer;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users_profile
    WHERE id=p_user_id AND role IN ('admin','keuangan') AND aktif
  ) THEN
    RAISE EXCEPTION 'Akses penyesuaian kategori SPP ditolak';
  END IF;

  IF p_kategori IS NULL OR p_kategori NOT IN ('asrama','non_asrama') THEN
    RAISE EXCEPTION 'Kategori harus Asrama atau Non Asrama';
  END IF;

  IF p_nominal_bruto IS NULL OR p_nominal_bruto<=0 OR p_nominal_bruto>100000000 THEN
    RAISE EXCEPTION 'Nominal bruto SPP harus lebih dari 0 dan maksimal Rp100.000.000';
  END IF;

  IF p_mulai IS NULL OR p_selesai IS NULL
     OR extract(day FROM p_mulai)<>1 OR extract(day FROM p_selesai)<>1
     OR p_mulai<=date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')::date
     OR p_selesai<p_mulai
     OR p_selesai>=(p_mulai+interval '24 months')::date THEN
    RAISE EXCEPTION 'Pilih bulan mendatang, maksimal 24 bulan, dengan tanggal awal bulan';
  END IF;

  IF p_apply THEN
    IF p_preview_hash IS NULL OR p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 10 AND 1000 THEN
      RAISE EXCEPTION 'Pratinjau dan alasan minimal 10 karakter wajib diisi';
    END IF;

    LOCK TABLE public.tagihan,public.pembayaran,public.transaksi_midtrans,
      public.transaksi_midtrans_item,public.spp_kategori_periode IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.tahun_buku,public.log_tutup_buku IN SHARE MODE NOWAIT;
    PERFORM 1 FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE NOWAIT;
  END IF;

  SELECT * INTO STRICT v_jp FROM public.jenis_pembayaran WHERE id=p_jenis_id;
  SELECT * INTO STRICT v_student FROM public.siswa WHERE id=p_siswa_id;

  IF v_student.status<>'aktif'
     OR v_jp.departemen_id IS DISTINCT FROM v_student.departemen_id
     OR v_jp.tipe<>'bulanan'
     OR lower(btrim(v_jp.nama)) !~ '^spp([[:space:]-]|$)'
     OR NOT v_jp.aktif
     OR NOT EXISTS(
       SELECT 1 FROM public.departemen
       WHERE id=v_jp.departemen_id AND kode IN ('SMP','SMA','MTA')
     ) THEN
    RAISE EXCEPTION 'Pilih siswa aktif dan jenis SPP SMP/SMA/MTA pada lembaga yang sama';
  END IF;

  SELECT count(*),(array_agg(id))[1] INTO v_nakun,v_akun
  FROM public.akun_rekening
  WHERE aktif AND jenis='pendapatan'
    AND kode=CASE WHEN p_kategori='asrama' THEN '4102' ELSE '4103' END;

  IF v_nakun<>1 THEN
    RAISE EXCEPTION 'Akun kategori SPP belum dikonfigurasi';
  END IF;

  FOR v_month IN
    SELECT generate_series(p_mulai,p_selesai,interval '1 month')::date
  LOOP
    v_t:=NULL;
    v_plan:=NULL;
    v_alasan:=NULL;
    v_action:='jadwalkan';
    v_old_bruto:=NULL;
    v_old_diskon:=NULL;
    v_old_netto:=NULL;
    v_new_diskon:=NULL;
    v_new_netto:=NULL;
    v_new_diskon_id:=NULL;
    v_tarif_referensi:=NULL;
    v_book:=NULL;
    v_book_count:=0;

    SELECT * INTO v_plan
    FROM public.spp_kategori_periode
    WHERE siswa_id=p_siswa_id
      AND jenis_id=p_jenis_id
      AND periode=v_month;

    SELECT count(*) INTO v_count
    FROM public.tagihan t
    WHERE t.siswa_id=p_siswa_id
      AND t.jenis_id=p_jenis_id
      AND t.status<>'dibatalkan'
      AND date_trunc('month',COALESCE(t.tanggal_pengakuan,t.jatuh_tempo))::date=v_month;

    IF v_count>1 THEN
      v_alasan:='Terdapat lebih dari satu tagihan aktif pada bulan ini';
    ELSIF v_count=1 THEN
      SELECT * INTO STRICT v_t
      FROM public.tagihan t
      WHERE t.siswa_id=p_siswa_id
        AND t.jenis_id=p_jenis_id
        AND t.status<>'dibatalkan'
        AND date_trunc('month',COALESCE(t.tanggal_pengakuan,t.jatuh_tempo))::date=v_month;

      v_action:='ubah_tagihan';

      IF v_t.status NOT IN ('terjadwal','belum_bayar')
         OR v_t.jurnal_piutang_id IS NOT NULL
         OR v_t.pembayaran_id IS NOT NULL
         OR v_t.jurnal_pembalik_id IS NOT NULL
         OR v_t.write_off_id IS NOT NULL
         OR v_t.pengakuan_spp_selesai IS DISTINCT FROM false
         OR COALESCE(v_t.legacy_paid_amount,0)>0
         OR EXISTS(SELECT 1 FROM public.pembayaran WHERE tagihan_id=v_t.id) THEN
        v_alasan:='Tagihan sudah memiliki pembayaran, jurnal, atau koreksi';
      ELSIF EXISTS (
        SELECT 1
        FROM public.transaksi_midtrans_item i
        JOIN public.transaksi_midtrans m ON m.id=i.transaksi_id
        WHERE (
          i.tagihan_id=v_t.id
          OR (
            i.tagihan_id IS NULL
            AND i.siswa_id=v_t.siswa_id
            AND i.jenis_id=v_t.jenis_id
            AND i.bulan=v_t.bulan
            AND i.tahun_ajaran_id=v_t.tahun_ajaran_id
          )
        )
        AND (
          i.pembayaran_id IS NOT NULL
          OR m.status IS NULL
          OR m.status NOT IN ('failed','expired','cancelled','canceled','deny','cancel')
        )
      ) THEN
        v_alasan:='Tagihan terhubung dengan pembayaran online aktif';
      END IF;

      v_old_bruto:=COALESCE(v_t.nominal_bruto,v_t.nominal+COALESCE(v_t.nominal_diskon,0));
      v_old_diskon:=COALESCE(v_t.nominal_diskon,0);
      v_old_netto:=v_t.nominal;

      SELECT d.nominal_diskon,d.siswa_diskon_id
      INTO v_new_diskon,v_new_diskon_id
      FROM public.hitung_diskon_tagihan(
        p_siswa_id,p_jenis_id,v_t.tahun_ajaran_id,v_t.bulan,p_nominal_bruto
      ) d;
      v_new_diskon:=COALESCE(v_new_diskon,0);
      v_new_netto:=p_nominal_bruto-v_new_diskon;
      v_tarif_referensi:=v_old_bruto;
    ELSE
      SELECT count(*),(array_agg(b.id))[1]
      INTO v_book_count,v_book
      FROM public.tahun_buku b
      WHERE v_month BETWEEN b.tanggal_mulai AND b.tanggal_selesai;

      IF v_plan.siswa_id IS NOT NULL THEN
        v_old_bruto:=v_plan.nominal_bruto;
        v_tarif_referensi:=v_plan.nominal_bruto;
      ELSIF v_book_count=1 THEN
        v_tarif_referensi:=public.get_tarif_siswa(
          p_jenis_id,p_siswa_id,NULL,v_book,v_student.angkatan_id
        );
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.tahun_buku b
      WHERE v_month BETWEEN b.tanggal_mulai AND b.tanggal_selesai
        AND (
          b.ditutup
          OR EXISTS(
            SELECT 1 FROM public.log_tutup_buku l
            WHERE l.tahun_ajaran_id=b.id AND l.unit='unit_pendidikan'
          )
        )
    ) THEN
      v_alasan:='Periode sudah ditutup buku';
    END IF;

    v_oldcat:=COALESCE(v_t.spp_kategori,v_plan.kategori);

    IF v_alasan IS NOT NULL THEN
      v_action:='terkunci';
    ELSIF v_plan.kategori=p_kategori
       AND v_plan.nominal_bruto=p_nominal_bruto
       AND (
         v_t.id IS NULL
         OR (
           v_t.spp_kategori=p_kategori
           AND v_t.spp_akun_pendapatan_id=v_akun
           AND v_old_bruto=p_nominal_bruto
           AND COALESCE(v_t.nominal_diskon,0)=COALESCE(v_new_diskon,0)
           AND v_t.nominal=p_nominal_bruto-COALESCE(v_new_diskon,0)
           AND v_t.siswa_diskon_id IS NOT DISTINCT FROM v_new_diskon_id
         )
       ) THEN
      v_action:='sudah_sesuai';
    ELSE
      v_eligible:=v_eligible+1;
    END IF;

    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'periode',v_month,
      'tagihan_id',v_t.id,
      'status',v_t.status,
      'nominal',v_t.nominal,
      'kategori_lama',v_oldcat,
      'kategori_baru',p_kategori,
      'akun_lama',v_t.spp_akun_pendapatan_id,
      'akun_baru',v_akun,
      'nominal_bruto_lama',v_old_bruto,
      'nominal_bruto_baru',p_nominal_bruto,
      'nominal_diskon_lama',v_old_diskon,
      'nominal_diskon_baru',v_new_diskon,
      'nominal_netto_lama',v_old_netto,
      'nominal_netto_baru',v_new_netto,
      'siswa_diskon_id_lama',v_t.siswa_diskon_id,
      'siswa_diskon_id_baru',v_new_diskon_id,
      'tarif_referensi',v_tarif_referensi,
      'rencana_lama',v_plan.kategori,
      'rencana_nominal_lama',v_plan.nominal_bruto,
      'rencana_audit_lama',v_plan.audit_id,
      'aksi',v_action,
      'alasan',v_alasan
    ));
  END LOOP;

  v_hash:=md5(jsonb_build_object(
    'siswa',p_siswa_id,
    'jenis',p_jenis_id,
    'mulai',p_mulai,
    'selesai',p_selesai,
    'kategori',p_kategori,
    'nominal_bruto',p_nominal_bruto,
    'rows',v_rows
  )::text);

  IF p_apply THEN
    IF p_preview_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Data berubah sejak pratinjau. Muat pratinjau ulang';
    END IF;

    IF v_eligible=0 THEN
      RAISE EXCEPTION 'Tidak ada bulan yang dapat disesuaikan';
    END IF;

    INSERT INTO public.spp_kategori_periode_audit(
      siswa_id,jenis_id,mulai,selesai,kategori,nominal_bruto,alasan,dibuat_oleh,perubahan
    )
    VALUES(
      p_siswa_id,p_jenis_id,p_mulai,p_selesai,p_kategori,p_nominal_bruto,
      btrim(p_alasan),p_user_id,v_rows
    )
    RETURNING id INTO v_audit;

    FOR v_row IN SELECT * FROM jsonb_array_elements(v_rows)
    LOOP
      IF v_row->>'aksi' IN ('jadwalkan','ubah_tagihan') THEN
        INSERT INTO public.spp_kategori_periode(
          siswa_id,jenis_id,periode,kategori,nominal_bruto,audit_id
        )
        VALUES(
          p_siswa_id,p_jenis_id,(v_row->>'periode')::date,p_kategori,p_nominal_bruto,v_audit
        )
        ON CONFLICT(siswa_id,jenis_id,periode) DO UPDATE
          SET kategori=EXCLUDED.kategori,
              nominal_bruto=EXCLUDED.nominal_bruto,
              audit_id=EXCLUDED.audit_id;

        IF v_row->>'aksi'='ubah_tagihan' THEN
          UPDATE public.tagihan
          SET spp_kategori=p_kategori,
              spp_akun_pendapatan_id=v_akun,
              nominal_bruto=(v_row->>'nominal_bruto_baru')::numeric,
              nominal_diskon=(v_row->>'nominal_diskon_baru')::numeric,
              nominal=(v_row->>'nominal_netto_baru')::numeric,
              siswa_diskon_id=NULLIF(v_row->>'siswa_diskon_id_baru','')::uuid
          WHERE id=(v_row->>'tagihan_id')::uuid;
          v_changes:=v_changes+1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'preview_hash',v_hash,
    'rows',v_rows,
    'bulan_dapat_disesuaikan',v_eligible,
    'applied',p_apply,
    'tagihan_diubah',v_changes,
    'audit_id',v_audit
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sesuaikan_kategori_spp_periode(
  uuid,uuid,date,date,text,numeric,uuid,boolean,text,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sesuaikan_kategori_spp_periode(
  uuid,uuid,date,date,text,numeric,uuid,boolean,text,text
) TO service_role;

COMMENT ON FUNCTION public.sesuaikan_kategori_spp_periode(
  uuid,uuid,date,date,text,numeric,uuid,boolean,text,text
) IS 'Preview/apply kategori dan nominal bruto SPP per bulan mendatang; tagihan historis/transaksional tetap terkunci.';
