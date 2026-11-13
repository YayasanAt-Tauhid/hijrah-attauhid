-- Migrasi 04: potongan kakak-adik per bulan di semua jalur (sinkronisasi, nonaktifkan, pemicu, pemeriksaan harian).
-- Prasyarat: migrasi 01, 02, 03 sudah diterapkan.
-- Isi:
--   * tinjau_potongan_saudara(keluarga, dari_bulan, user, siswa, sumber, ketat): cabut potongan saudara mulai bulan pertama yang tidak sah
--   * tinjau_potongan_saudara_semua(tanggal): pemeriksaan ulang seluruh keluarga (jaring pengaman harian)
--   * pemicu_tinjau_potongan_saudara + trigger trg_tinjau_potongan_saudara pada siswa
--   * sinkronkan_diskon_kakak_adik_keluarga: anggota dihitung per bulan (siswa_aktif_di_bulan)
--   * akademik_nonaktifkan_siswa: tidak lagi mengubah baris disetujui langsung (bug yang sama dengan akademik_akhiri_siswa)
--   * akademik_akhiri_siswa: mematikan pemicu saat memperbarui status sendiri (app.lewati_pemicu_saudara)
-- ROLLBACK: DROP TRIGGER trg_tinjau_potongan_saudara ON public.siswa;
--           DROP FUNCTION pemicu_tinjau_potongan_saudara(), tinjau_potongan_saudara_semua(date), tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean);
--           lalu pulihkan sinkronkan_diskon_kakak_adik_keluarga dan akademik_nonaktifkan_siswa dari asli/*.sql,
--           dan akademik_akhiri_siswa dari definisi di migrasi 03.

CREATE OR REPLACE FUNCTION public.tinjau_potongan_saudara(
  p_keluarga_id uuid,
  p_dari_bulan date,
  p_user_id uuid DEFAULT NULL,
  p_siswa_id uuid DEFAULT NULL,
  p_sumber text DEFAULT 'pemeriksaan',
  p_ketat boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_awal date := date_trunc('month', p_dari_bulan::timestamp)::date;
  v_diskon record;
  v_invalid date;
  v_diperiksa integer := 0;
  v_dicabut integer := 0;
  v_galat text[] := '{}';
BEGIN
  IF p_keluarga_id IS NULL AND p_siswa_id IS NULL THEN
    RETURN jsonb_build_object('diperiksa',0,'dicabut',0,'errors','[]'::jsonb);
  END IF;

  FOR v_diskon IN
    SELECT sd.id, sd.siswa_id, sx.keluarga_id,
           greatest(date_trunc('month', sd.periode_mulai::timestamp)::date, v_awal) AS dari_bulan,
           sd.periode_selesai
    FROM public.siswa_diskon sd
    JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
    JOIN public.siswa sx ON sx.id = sd.siswa_id
    WHERE sk.kategori = 'kakak_adik'
      AND sd.status IN ('diajukan','disetujui')
      AND sd.periode_selesai >= v_awal
      AND ((p_keluarga_id IS NOT NULL AND sx.keluarga_id = p_keluarga_id)
        OR (p_siswa_id IS NOT NULL AND sx.id = p_siswa_id))
    ORDER BY sd.id
  LOOP
    v_diperiksa := v_diperiksa + 1;

    -- bulan pertama saat saudara aktif < 2, atau pemilik potongan sendiri tidak aktif
    SELECT min(m)::date INTO v_invalid
    FROM generate_series(v_diskon.dari_bulan::timestamp, v_diskon.periode_selesai::timestamp, interval '1 month') AS m
    WHERE COALESCE(public.jumlah_saudara_aktif(v_diskon.keluarga_id, m::date), 0) < 2
       OR NOT EXISTS (
            SELECT 1 FROM public.siswa z
            WHERE z.id = v_diskon.siswa_id
              AND public.siswa_aktif_di_bulan(z.status, z.tanggal_mulai_aktif, z.tanggal_akhir_aktif, m::date)
          );

    IF v_invalid IS NULL THEN CONTINUE; END IF;

    IF p_ketat THEN
      PERFORM public.cabut_potongan_saudara(
        v_diskon.id, v_invalid,
        'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || to_char(v_invalid,'YYYY-MM-DD') || ' (' || p_sumber || ')',
        p_user_id);
      v_dicabut := v_dicabut + 1;
    ELSE
      BEGIN
        PERFORM public.cabut_potongan_saudara(
          v_diskon.id, v_invalid,
          'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || to_char(v_invalid,'YYYY-MM-DD') || ' (' || p_sumber || ')',
          p_user_id);
        v_dicabut := v_dicabut + 1;
      EXCEPTION WHEN OTHERS THEN
        v_galat := v_galat || (v_diskon.id::text || ': ' || SQLERRM);
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('diperiksa', v_diperiksa, 'dicabut', v_dicabut, 'errors', to_jsonb(v_galat));
END;
$f$;

CREATE OR REPLACE FUNCTION public.tinjau_potongan_saudara_semua(p_tanggal date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_awal date := date_trunc('month', p_tanggal::timestamp)::date;
  r record;
  v_hasil jsonb;
  v_unit integer := 0;
  v_diperiksa integer := 0;
  v_dicabut integer := 0;
  v_galat jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT DISTINCT sx.keluarga_id,
           CASE WHEN sx.keluarga_id IS NULL THEN sx.id END AS siswa_id
    FROM public.siswa_diskon sd
    JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
    JOIN public.siswa sx ON sx.id = sd.siswa_id
    WHERE sk.kategori = 'kakak_adik'
      AND sd.status IN ('diajukan','disetujui')
      AND sd.periode_selesai >= v_awal
  LOOP
    v_unit := v_unit + 1;
    BEGIN
      v_hasil := public.tinjau_potongan_saudara(r.keluarga_id, v_awal, NULL, r.siswa_id, 'pemeriksaan harian', false);
      v_diperiksa := v_diperiksa + (v_hasil->>'diperiksa')::integer;
      v_dicabut := v_dicabut + (v_hasil->>'dicabut')::integer;
      v_galat := v_galat || COALESCE(v_hasil->'errors','[]'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_galat := v_galat || to_jsonb(COALESCE(r.keluarga_id::text, r.siswa_id::text) || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('unit_diperiksa', v_unit, 'potongan_diperiksa', v_diperiksa, 'dicabut', v_dicabut, 'errors', v_galat);
END;
$f$;

CREATE OR REPLACE FUNCTION public.pemicu_tinjau_potongan_saudara()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_bulan date := date_trunc('month', current_date)::date;
  v_user uuid := auth.uid();
  v_hasil jsonb;
BEGIN
  -- alur resmi (akhiri/nonaktifkan) sudah menangani potongan sendiri
  IF current_setting('app.lewati_pemicu_saudara', true) = '1' THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF OLD.keluarga_id IS NOT NULL THEN
      v_hasil := public.tinjau_potongan_saudara(OLD.keluarga_id, v_bulan, v_user, NULL, 'perubahan data siswa', false);
      IF jsonb_array_length(COALESCE(v_hasil->'errors','[]'::jsonb)) > 0 THEN
        RAISE WARNING 'tinjau potongan saudara (keluarga lama) siswa %: %', NEW.id, v_hasil->'errors';
      END IF;
    END IF;
    IF NEW.keluarga_id IS NOT NULL AND NEW.keluarga_id IS DISTINCT FROM OLD.keluarga_id THEN
      v_hasil := public.tinjau_potongan_saudara(NEW.keluarga_id, v_bulan, v_user, NULL, 'perubahan data siswa', false);
      IF jsonb_array_length(COALESCE(v_hasil->'errors','[]'::jsonb)) > 0 THEN
        RAISE WARNING 'tinjau potongan saudara (keluarga baru) siswa %: %', NEW.id, v_hasil->'errors';
      END IF;
    END IF;
    v_hasil := public.tinjau_potongan_saudara(NULL, v_bulan, v_user, NEW.id, 'perubahan data siswa', false);
    IF jsonb_array_length(COALESCE(v_hasil->'errors','[]'::jsonb)) > 0 THEN
      RAISE WARNING 'tinjau potongan saudara (milik siswa) siswa %: %', NEW.id, v_hasil->'errors';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- perubahan data siswa tidak boleh gagal karena peninjauan; pemeriksaan harian akan mengulang
    RAISE WARNING 'pemicu_tinjau_potongan_saudara siswa %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$f$;

DROP TRIGGER IF EXISTS trg_tinjau_potongan_saudara ON public.siswa;
CREATE TRIGGER trg_tinjau_potongan_saudara
  AFTER UPDATE OF status, keluarga_id, tanggal_mulai_aktif, tanggal_akhir_aktif ON public.siswa
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.keluarga_id IS DISTINCT FROM NEW.keluarga_id
     OR OLD.tanggal_mulai_aktif IS DISTINCT FROM NEW.tanggal_mulai_aktif
     OR OLD.tanggal_akhir_aktif IS DISTINCT FROM NEW.tanggal_akhir_aktif)
  EXECUTE FUNCTION public.pemicu_tinjau_potongan_saudara();

REVOKE ALL ON FUNCTION public.tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.tinjau_potongan_saudara_semua(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tinjau_potongan_saudara_semua(date) TO service_role;
REVOKE ALL ON FUNCTION public.pemicu_tinjau_potongan_saudara() FROM PUBLIC, anon, authenticated;

-- sinkronkan_diskon_kakak_adik_keluarga: anggota dihitung per bulan
CREATE OR REPLACE FUNCTION public.sinkronkan_diskon_kakak_adik_keluarga(p_keluarga_id uuid, p_tanggal date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mulai date := date_trunc('month',p_tanggal)::date;
  v_selesai date := (date_trunc('month',p_tanggal)+interval '1 month - 1 day')::date;
  v_row record;
  v_skema_id uuid;
  v_policy public.kebijakan_keringanan;
  v_diskon_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_applied integer := 0;
  v_policy_skipped integer := 0;
  v_result jsonb;
  v_errors text[] := '{}';
BEGIN
  FOR v_row IN
    WITH anggota AS (
      SELECT
        s.id AS siswa_id,
        s.keluarga_id,
        count(*) OVER (PARTITION BY s.keluarga_id) AS jumlah
      FROM public.siswa s
      WHERE s.keluarga_id IS NOT NULL
        AND public.siswa_aktif_di_bulan(s.status,s.tanggal_mulai_aktif,s.tanggal_akhir_aktif,v_mulai)
        AND (p_keluarga_id IS NULL OR s.keluarga_id=p_keluarga_id)
    )
    SELECT a.siswa_id,a.keluarga_id,r.jenis_id
    FROM anggota a
    JOIN (
      SELECT r.siswa_id,r.jenis_id
      FROM public.rencana_tagihan_siswa r
      JOIN public.jenis_pembayaran j ON j.id=r.jenis_id
      WHERE r.aktif=true AND j.aktif=true AND j.tipe='bulanan'
        AND j.nama ILIKE 'SPP%'
        AND v_mulai BETWEEN date_trunc('month',r.mulai)::date
                        AND date_trunc('month',r.selesai)::date
      UNION
      SELECT t.siswa_id,t.jenis_id
      FROM public.tagihan t
      JOIN public.jenis_pembayaran j ON j.id=t.jenis_id
      WHERE j.aktif=true AND j.tipe='bulanan' AND j.nama ILIKE 'SPP%'
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
    ) r ON r.siswa_id=a.siswa_id
    WHERE a.jumlah>=2
    ORDER BY a.keluarga_id,a.siswa_id,r.jenis_id
  LOOP
    BEGIN
    -- Serialize cron and family confirmation for the same child/month/type.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sibling-discount:' || v_row.siswa_id::text || ':' ||
      v_row.jenis_id::text || ':' || v_mulai::text, 0));

    IF EXISTS (
      SELECT 1
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id=v_row.siswa_id
        AND sd.jenis_id=v_row.jenis_id
        AND sd.status IN ('diajukan','disetujui')
        AND daterange(sd.periode_mulai,sd.periode_selesai,'[]')
            && daterange(v_mulai,v_selesai,'[]')
    ) THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    -- Preserve reductions already present on bills, including imported ones
    -- without a corresponding siswa_diskon record.
    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id=v_row.siswa_id AND t.jenis_id=v_row.jenis_id
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
        AND COALESCE(t.nominal_diskon,0)>0
    ) THEN
      v_skipped := v_skipped+1;
      CONTINUE;
    END IF;

    SELECT sk.id INTO v_skema_id
    FROM public.skema_diskon sk
    WHERE sk.aktif=true
      AND sk.kategori='kakak_adik'
      AND sk.nama='Potongan Kakak-Adik'
    LIMIT 1;

    IF v_skema_id IS NULL THEN
      v_policy_skipped := v_policy_skipped+1;
      CONTINUE;
    END IF;

    SELECT kk.* INTO v_policy
    FROM public.kebijakan_keringanan kk
    WHERE kk.aktif=true
      AND kk.skema_diskon_id=v_skema_id
      AND kk.jenis_id=v_row.jenis_id
      AND kk.berlaku_mulai<=p_tanggal
      AND (kk.berlaku_selesai IS NULL OR kk.berlaku_selesai>=p_tanggal)
      AND kk.otomatis=true
    ORDER BY kk.berlaku_mulai DESC,kk.versi DESC
    LIMIT 1;

    IF v_policy.id IS NULL THEN
      v_policy_skipped := v_policy_skipped+1;
      CONTINUE;
    END IF;

    INSERT INTO public.siswa_diskon(
      siswa_id,skema_diskon_id,jenis_id,kebijakan_keringanan_id,
      periode_mulai,periode_selesai,nilai,
      status,catatan,diputuskan_at,diterapkan_at
    )
    VALUES(
      v_row.siswa_id,v_skema_id,v_row.jenis_id,v_policy.id,
      v_mulai,v_selesai,v_policy.nilai,
      'disetujui',
      'Potongan kakak/adik otomatis mengikuti kebijakan '
        || v_policy.kode || ' v' || v_policy.versi::text
        || '; tidak ditumpuk dengan potongan lain.',
      now(),NULL
    )
    RETURNING id INTO v_diskon_id;

    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id=v_row.siswa_id
        AND t.jenis_id=v_row.jenis_id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan))
            BETWEEN v_mulai AND v_selesai
    ) THEN
      v_result := public.terapkan_diskon_siswa(v_diskon_id,NULL);
      IF jsonb_array_length(COALESCE(v_result->'errors','[]'::jsonb))>0 THEN
        RAISE EXCEPTION '%',v_result->'errors';
      END IF;
      IF COALESCE((v_result->>'terjadwal_diubah')::integer,0)
           + COALESCE((v_result->>'dikoreksi_jurnal')::integer,0)>0 THEN
        v_applied := v_applied+1;
      END IF;
    END IF;
    v_created := v_created+1;
    EXCEPTION WHEN OTHERS THEN
      -- Roll back this child's discount/journal together; allow other children
      -- to proceed and surface the failure instead of reporting false success.
      v_errors := v_errors || (v_row.siswa_id::text || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'periode_mulai',v_mulai,
    'periode_selesai',v_selesai,
    'dibuat',v_created,
    'dilewati_karena_diskon_lain',v_skipped,
    'diterapkan_ke_tagihan_existing',v_applied,
    'dilewati_kebijakan',v_policy_skipped,
    'errors',to_jsonb(v_errors)
  );
END;
$function$;

-- akademik_nonaktifkan_siswa: tanpa mengubah baris disetujui langsung
CREATE OR REPLACE FUNCTION public.akademik_nonaktifkan_siswa(p_ids uuid[], p_status text, p_bulan_efektif date, p_alasan text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_efektif date := date_trunc('month',p_bulan_efektif)::date;
  v_s public.siswa;
  v_tagihan_id uuid;
  v_keluarga_id uuid;
  v_processed integer := 0;
  v_tagihan_dibatalkan integer := 0;
  v_rencana_dinonaktifkan integer := 0;
  v_diskon_dihentikan integer := 0;
  v_tagihan_lunas_masa_depan integer := 0;
  v_kakak_adik_dihentikan integer := 0;
  v_count integer := 0;
  v_dk record;
  v_hasil jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid,'admin')
    OR public.has_role(v_uid,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF coalesce(cardinality(p_ids),0)=0 THEN
    RAISE EXCEPTION 'Pilih siswa terlebih dahulu';
  END IF;

  IF p_status NOT IN ('pindah','alumni') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;

  IF p_bulan_efektif IS NULL THEN
    RAISE EXCEPTION 'Bulan efektif wajib diisi';
  END IF;

  IF length(btrim(coalesce(p_alasan,'')))<5 THEN
    RAISE EXCEPTION 'Alasan wajib diisi minimal 5 karakter';
  END IF;

  FOR v_s IN
    SELECT * FROM public.siswa
    WHERE id=ANY(p_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_s.status<>'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat diproses: %',v_s.nama;
    END IF;

    v_keluarga_id := v_s.keluarga_id;

    FOR v_tagihan_id IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id=v_s.id
        AND t.status IN ('terjadwal','belum_bayar')
        AND t.jatuh_tempo>=v_efektif
      ORDER BY t.jatuh_tempo,t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan_id,
        'batal',
        'Berhenti otomatis karena siswa '||p_status||
          ' efektif '||to_char(v_efektif,'MM/YYYY')||
          ': '||btrim(p_alasan),
        CURRENT_DATE,
        v_uid,
        NULL
      );
      v_tagihan_dibatalkan := v_tagihan_dibatalkan+1;
    END LOOP;

    SELECT count(*) INTO v_count
    FROM public.tagihan t
    WHERE t.siswa_id=v_s.id
      AND t.status IN ('lunas','sebagian')
      AND t.jatuh_tempo>=v_efektif;
    v_tagihan_lunas_masa_depan := v_tagihan_lunas_masa_depan+v_count;

    UPDATE public.rencana_tagihan_siswa
    SET aktif=false,
        dinonaktifkan_at=now(),
        dinonaktifkan_oleh=v_uid,
        dinonaktifkan_alasan='Siswa '||p_status||' efektif '||to_char(v_efektif,'MM/YYYY')||': '||btrim(p_alasan),
        updated_at=now()
    WHERE siswa_id=v_s.id AND aktif=true;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rencana_dinonaktifkan := v_rencana_dinonaktifkan+v_count;

    FOR v_dk IN
      SELECT sd.id
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id=v_s.id
        AND sd.status IN ('diajukan','disetujui')
        AND sd.periode_selesai>=v_efektif
    LOOP
      PERFORM public.pangkas_diskon_siswa(
        v_dk.id,
        v_efektif-1,
        'Dihentikan otomatis karena siswa '||p_status||' efektif '||to_char(v_efektif,'MM/YYYY')
      );
      v_diskon_dihentikan := v_diskon_dihentikan+1;
    END LOOP;

    PERFORM set_config('app.lewati_pemicu_saudara','1',true);
    UPDATE public.siswa
    SET status=p_status,
        tanggal_akhir_aktif=v_efektif-1
    WHERE id=v_s.id;
    PERFORM set_config('app.lewati_pemicu_saudara','',true);

    UPDATE public.kelas_siswa
    SET aktif=false
    WHERE siswa_id=v_s.id AND aktif=true;

    IF v_keluarga_id IS NOT NULL THEN
      v_hasil := public.tinjau_potongan_saudara(v_keluarga_id, v_efektif, v_uid, NULL, 'nonaktifkan', true);
      v_kakak_adik_dihentikan := v_kakak_adik_dihentikan + COALESCE((v_hasil->>'dicabut')::integer,0);
    END IF;

    v_processed := v_processed+1;
  END LOOP;

  IF v_processed<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'processed',v_processed,
    'status',p_status,
    'bulan_efektif',v_efektif,
    'tagihan_dibatalkan',v_tagihan_dibatalkan,
    'rencana_dinonaktifkan',v_rencana_dinonaktifkan,
    'diskon_dihentikan',v_diskon_dihentikan,
    'kakak_adik_dihentikan',v_kakak_adik_dihentikan,
    'tagihan_lunas_atau_sebagian_setelah_efektif',v_tagihan_lunas_masa_depan
  );
END;
$function$;

-- akademik_akhiri_siswa: matikan pemicu saat memperbarui status sendiri
CREATE OR REPLACE FUNCTION public.akademik_akhiri_siswa(p_ids uuid[], p_status text, p_tanggal_efektif date, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  v_processed integer := 0;
  v_tagihan record;
  v_keluarga_id uuid;
  v_aktif_keluarga integer;
  v_diskon record;
  v_bulan date;
  v_invalid date;
  v_alasan text;
BEGIN
  IF p_status NOT IN ('pindah','alumni') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  IF p_tanggal_efektif IS NULL THEN
    RAISE EXCEPTION 'Tanggal efektif wajib diisi';
  END IF;
  IF p_user_id IS NULL OR NOT (
    public.has_role(p_user_id,'admin') OR public.has_role(p_user_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF COALESCE(cardinality(p_ids),0)=0 THEN
    RAISE EXCEPTION 'Pilih siswa terlebih dahulu';
  END IF;

  FOR s IN
    SELECT * FROM public.siswa
    WHERE id = ANY(p_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF s.status <> 'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat diubah statusnya';
    END IF;

    v_keluarga_id := s.keluarga_id;
    v_alasan := CASE WHEN p_status='pindah'
      THEN 'Siswa pindah keluar efektif ' || p_tanggal_efektif::text
      ELSE 'Siswa menjadi alumni efektif ' || p_tanggal_efektif::text
    END;

    FOR v_tagihan IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id = s.id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(
              t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            ) >= p_tanggal_efektif
      ORDER BY t.jatuh_tempo NULLS LAST, t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan.id, 'batal', v_alasan, current_date, p_user_id, NULL
      );
    END LOOP;

    UPDATE public.rencana_tagihan_siswa
    SET aktif = false,
        updated_at = now(),
        dinonaktifkan_at = now(),
        dinonaktifkan_oleh = p_user_id,
        dinonaktifkan_alasan = v_alasan
    WHERE siswa_id = s.id
      AND aktif = true;

    FOR v_diskon IN
      SELECT sd.id
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id = s.id
        AND sd.status IN ('diajukan','disetujui')
        AND sd.periode_selesai >= p_tanggal_efektif
    LOOP
      PERFORM public.pangkas_diskon_siswa(
        v_diskon.id,
        p_tanggal_efektif - 1,
        'Otomatis diakhiri karena ' || p_status || ' efektif ' || p_tanggal_efektif::text
      );
    END LOOP;

    PERFORM set_config('app.lewati_pemicu_saudara','1',true);
    UPDATE public.siswa SET status = p_status, tanggal_akhir_aktif = p_tanggal_efektif - 1 WHERE id = s.id;
    PERFORM set_config('app.lewati_pemicu_saudara','',true);
    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = s.id AND aktif;

    IF v_keluarga_id IS NOT NULL THEN
      -- bulan pertama saat siswa ini sudah tidak aktif (bulan sesudah hari terakhir aktifnya)
      v_bulan := (date_trunc('month', (p_tanggal_efektif - 1)::timestamp) + interval '1 month')::date;

      FOR v_diskon IN
        SELECT sd.id, sd.siswa_id, sd.jenis_id,
               greatest(date_trunc('month', sd.periode_mulai::timestamp)::date, v_bulan) AS dari_bulan,
               sd.periode_selesai
        FROM public.siswa_diskon sd
        JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
        JOIN public.siswa sx ON sx.id = sd.siswa_id
        WHERE sx.keluarga_id = v_keluarga_id
          AND sx.id <> s.id
          AND sk.kategori = 'kakak_adik'
          AND sd.status IN ('diajukan','disetujui')
          AND sd.periode_selesai >= v_bulan
      LOOP
        -- bulan pertama saat saudara aktif < 2, atau anak pemilik potongan sendiri tidak aktif
        SELECT min(m)::date INTO v_invalid
        FROM generate_series(v_diskon.dari_bulan::timestamp, v_diskon.periode_selesai::timestamp, interval '1 month') AS m
        WHERE public.jumlah_saudara_aktif(v_keluarga_id, m::date) < 2
           OR NOT EXISTS (
                SELECT 1 FROM public.siswa z
                WHERE z.id = v_diskon.siswa_id
                  AND public.siswa_aktif_di_bulan(z.status, z.tanggal_mulai_aktif, z.tanggal_akhir_aktif, m::date)
              );

        IF v_invalid IS NOT NULL THEN
          PERFORM public.cabut_potongan_saudara(
            v_diskon.id,
            v_invalid,
            'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || to_char(v_invalid,'YYYY-MM-DD'),
            p_user_id
          );
        END IF;
      END LOOP;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  IF v_processed <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN v_processed;
END;
$function$;
