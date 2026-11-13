-- Migrasi 02: perbaiki akademik_akhiri_siswa (bug: memotong periode potongan yang sudah disetujui)
-- dan hitung kelayakan potongan kakak-adik PER BULAN. Bergantung pada migrasi 01.
-- Rollback: pulihkan definisi asli dari asli/*.sql; DROP FUNCTION public.pangkas_diskon_siswa(uuid,date,text).

CREATE OR REPLACE FUNCTION public.validasi_diskon_kakak_adik()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $f$
DECLARE
  v_kategori text;
  v_keluarga_id uuid;
  v_status text;
  v_mulai date;
  v_akhir date;
  v_bulan date;
BEGIN
  -- hanya baris yang berlaku yang divalidasi; pembatalan/penolakan selalu boleh
  IF NEW.status NOT IN ('diajukan','disetujui') THEN RETURN NEW; END IF;

  SELECT kategori INTO v_kategori FROM public.skema_diskon WHERE id = NEW.skema_diskon_id;
  IF v_kategori IS DISTINCT FROM 'kakak_adik' THEN RETURN NEW; END IF;

  SELECT keluarga_id, status, tanggal_mulai_aktif, tanggal_akhir_aktif
  INTO v_keluarga_id, v_status, v_mulai, v_akhir
  FROM public.siswa WHERE id = NEW.siswa_id;

  IF v_keluarga_id IS NULL THEN
    RAISE EXCEPTION 'Potongan kakak-adik membutuhkan siswa aktif yang sudah dikelompokkan ke keluarga';
  END IF;

  v_bulan := date_trunc('month', NEW.periode_mulai::timestamp)::date;

  IF NOT public.siswa_aktif_di_bulan(v_status, v_mulai, v_akhir, v_bulan) THEN
    RAISE EXCEPTION 'Potongan kakak-adik membutuhkan siswa yang aktif pada bulan awal periode';
  END IF;

  IF public.jumlah_saudara_aktif(v_keluarga_id, v_bulan) < 2 THEN
    RAISE EXCEPTION 'Potongan kakak-adik hanya berlaku bila minimal 2 bersaudara masih aktif di yayasan';
  END IF;

  RETURN NEW;
END;
$f$;

-- Potongan yang sudah disetujui tidak boleh diubah (trigger cegah_mutasi_diskon_disetujui),
-- jadi "memangkas" = batalkan baris lama lalu buat baris awalan baru; tagihan awalan dipindah ke baris baru.
CREATE OR REPLACE FUNCTION public.pangkas_diskon_siswa(
  p_siswa_diskon_id uuid, p_akhir_aktif date, p_alasan text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  r public.siswa_diskon;
  v_end date;
  v_new uuid;
BEGIN
  SELECT * INTO r FROM public.siswa_diskon WHERE id = p_siswa_diskon_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('diajukan','disetujui') THEN RETURN NULL; END IF;

  -- potongan berlaku sampai akhir bulan hari terakhir aktif
  v_end := (date_trunc('month', p_akhir_aktif::timestamp) + interval '1 month - 1 day')::date;
  IF r.periode_selesai <= v_end THEN RETURN NULL; END IF;

  UPDATE public.siswa_diskon
  SET status = 'dibatalkan',
      catatan = concat_ws(E'\n', NULLIF(catatan,''), p_alasan)
  WHERE id = r.id;

  IF r.periode_mulai > v_end THEN RETURN NULL; END IF;  -- seluruh periode gugur

  INSERT INTO public.siswa_diskon(
    siswa_id, skema_diskon_id, jenis_id, kebijakan_keringanan_id,
    periode_mulai, periode_selesai, nilai, status, catatan, dokumen_url,
    diajukan_oleh, diputuskan_oleh, diputuskan_at, diterapkan_at,
    tipe_snapshot, nilai_snapshot
  ) VALUES (
    r.siswa_id, r.skema_diskon_id, r.jenis_id, r.kebijakan_keringanan_id,
    r.periode_mulai, v_end, r.nilai, r.status,
    concat_ws(E'\n', NULLIF(r.catatan,''), p_alasan || ' (periode dipangkas dari baris ' || r.id::text || ')'),
    r.dokumen_url, r.diajukan_oleh, r.diputuskan_oleh, r.diputuskan_at, r.diterapkan_at,
    r.tipe_snapshot, r.nilai_snapshot
  )
  RETURNING id INTO v_new;

  UPDATE public.tagihan t
  SET siswa_diskon_id = v_new
  WHERE t.siswa_diskon_id = r.id
    AND COALESCE(t.jatuh_tempo, public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id, t.bulan)) <= v_end;

  RETURN v_new;
END;
$f$;

REVOKE ALL ON FUNCTION public.pangkas_diskon_siswa(uuid,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pangkas_diskon_siswa(uuid,date,text) TO service_role;

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

    UPDATE public.siswa SET status = p_status, tanggal_akhir_aktif = p_tanggal_efektif - 1 WHERE id = s.id;
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
          UPDATE public.tagihan t
          SET nominal = COALESCE(t.nominal_bruto,t.nominal),
              nominal_diskon = 0,
              siswa_diskon_id = NULL
          WHERE t.siswa_id = v_diskon.siswa_id
            AND t.jenis_id = v_diskon.jenis_id
            AND t.status = 'terjadwal'
            AND t.siswa_diskon_id = v_diskon.id
            AND COALESCE(
                  t.jatuh_tempo,
                  public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
                ) >= v_invalid;

          PERFORM public.pangkas_diskon_siswa(
            v_diskon.id,
            v_invalid - 1,
            'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || to_char(v_invalid,'YYYY-MM-DD')
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
