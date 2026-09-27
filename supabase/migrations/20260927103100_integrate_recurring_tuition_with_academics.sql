-- Integrasikan rencana SPP dengan mutasi akademik.
-- Pindah/lulus menghentikan rencana. Kenaikan/tidak naik menghitung ulang akhir
-- jenjang. Cron harian menjalankan akrual dan rencana tagihan secara idempotent.

CREATE OR REPLACE FUNCTION public.akademik_akhiri_siswa(
  p_ids uuid[],
  p_status text,
  p_tanggal_efektif date,
  p_user_id uuid
)
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

    UPDATE public.siswa_diskon
    SET status = CASE
          WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
          ELSE status
        END,
        periode_selesai = CASE
          WHEN periode_mulai < p_tanggal_efektif
            AND periode_selesai >= p_tanggal_efektif
          THEN p_tanggal_efektif - 1
          ELSE periode_selesai
        END,
        catatan = concat_ws(
          E'\n',
          NULLIF(catatan,''),
          'Otomatis diakhiri karena ' || p_status || ' efektif ' || p_tanggal_efektif::text
        )
    WHERE siswa_id = s.id
      AND status IN ('diajukan','disetujui')
      AND periode_selesai >= p_tanggal_efektif;

    UPDATE public.siswa SET status = p_status WHERE id = s.id;
    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = s.id AND aktif;

    IF v_keluarga_id IS NOT NULL THEN
      SELECT count(*) INTO v_aktif_keluarga
      FROM public.siswa
      WHERE keluarga_id = v_keluarga_id
        AND status = 'aktif';

      IF v_aktif_keluarga < 2 THEN
        FOR v_diskon IN
          SELECT sd.id, sd.siswa_id, sd.jenis_id, sd.periode_mulai
          FROM public.siswa_diskon sd
          JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
          JOIN public.siswa sx ON sx.id = sd.siswa_id
          WHERE sx.keluarga_id = v_keluarga_id
            AND sx.status = 'aktif'
            AND sk.kategori = 'kakak_adik'
            AND sd.status IN ('diajukan','disetujui')
            AND sd.periode_selesai >= p_tanggal_efektif
        LOOP
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
                ) >= p_tanggal_efektif;

          UPDATE public.siswa_diskon
          SET status = CASE
                WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
                ELSE status
              END,
              periode_selesai = CASE
                WHEN periode_mulai < p_tanggal_efektif
                  AND periode_selesai >= p_tanggal_efektif
                THEN p_tanggal_efektif - 1
                ELSE periode_selesai
              END,
              catatan = concat_ws(
                E'\n',
                NULLIF(catatan,''),
                'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || p_tanggal_efektif::text
              )
          WHERE id = v_diskon.id;
        END LOOP;
      END IF;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  IF v_processed <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.akademik_mutasi(
  p_ids uuid[],
  p_action text,
  p_kelas_id uuid DEFAULT NULL::uuid,
  p_tahun_ajaran_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  target uuid;
  processed integer := 0;
  v_uid uuid := auth.uid();
  v_akhir date;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid,'admin') OR public.has_role(v_uid,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF COALESCE(cardinality(p_ids),0)=0
     OR p_action NOT IN ('kelas','tinggal','alumni','pindah') THEN
    RAISE EXCEPTION 'Pilih siswa dan aksi yang valid';
  END IF;

  IF p_action IN ('alumni','pindah') THEN
    RETURN public.akademik_akhiri_siswa(
      p_ids, p_action, current_date, v_uid
    );
  END IF;

  FOR s IN
    SELECT * FROM public.siswa WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE
  LOOP
    IF s.status<>'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat dimutasi';
    END IF;

    IF p_tahun_ajaran_id IS NULL THEN
      RAISE EXCEPTION 'Tahun ajaran wajib dipilih';
    END IF;

    target := p_kelas_id;
    IF p_action='tinggal' THEN
      SELECT kelas_id INTO STRICT target
      FROM public.kelas_siswa WHERE siswa_id=s.id AND aktif;
    END IF;

    IF target IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.kelas WHERE id=target AND departemen_id=s.departemen_id
    ) THEN
      RAISE EXCEPTION 'Kelas tujuan harus sesuai lembaga siswa';
    END IF;

    UPDATE public.kelas_siswa SET aktif=false WHERE siswa_id=s.id AND aktif;
    INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
    VALUES(s.id,target,p_tahun_ajaran_id,true)
    ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id)
    DO UPDATE SET aktif=true;

    UPDATE public.tagihan t
    SET kelas_id = target
    WHERE t.siswa_id = s.id
      AND t.status = 'terjadwal'
      AND public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
          BETWEEN
            (SELECT tanggal_mulai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id)
            AND
            (SELECT tanggal_selesai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id);

    IF EXISTS (
      SELECT 1 FROM public.rencana_tagihan_siswa
      WHERE siswa_id = s.id
        AND aktif = true
        AND sampai_akhir_jenjang = true
    ) THEN
      v_akhir := public.hitung_akhir_jenjang_siswa(
        s.id, p_tahun_ajaran_id, target
      );

      UPDATE public.rencana_tagihan_siswa
      SET selesai = v_akhir,
          updated_at = now()
      WHERE siswa_id = s.id
        AND aktif = true
        AND sampai_akhir_jenjang = true;
    END IF;

    processed := processed + 1;
  END LOOP;

  IF processed<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  TO authenticated, service_role;

SELECT cron.schedule(
  'akrual-jatuh-tempo-harian',
  '5 0 * * *',
  $$SELECT public.jalankan_akrual_jatuh_tempo();$$
);

SELECT cron.schedule(
  'rencana-tagihan-siswa-harian',
  '15 0 * * *',
  $$SELECT public.jalankan_rencana_tagihan_siswa(current_date);$$
);
