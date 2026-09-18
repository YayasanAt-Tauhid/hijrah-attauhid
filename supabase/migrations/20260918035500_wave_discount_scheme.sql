-- Link free SPMB waves to an accounting discount scheme so future free waves
-- use the correct waiver without hardcoding "Gelombang Pertama".

ALTER TABLE public.spmb_gelombang
  ADD COLUMN IF NOT EXISTS skema_diskon_id uuid REFERENCES public.skema_diskon(id);

UPDATE public.skema_diskon
SET keterangan = 'Gratis biaya pendaftaran SPMB Gelombang 1 periode 23 September sampai 30 Oktober 2026 WIB.'
WHERE nama = 'Promo SPMB Gelombang Pertama 2027/2028';

UPDATE public.spmb_gelombang g
SET skema_diskon_id = s.id
FROM public.skema_diskon s
WHERE lower(trim(g.nama)) = 'gelombang 1'
  AND g.gratis_pendaftaran = true
  AND s.nama = 'Promo SPMB Gelombang Pertama 2027/2028'
  AND g.skema_diskon_id IS NULL;

CREATE OR REPLACE FUNCTION public.spmb_validate_wave_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  generated_scheme_name text;
BEGIN
  IF NEW.aktif AND EXISTS (
    SELECT 1
    FROM public.spmb_gelombang g
    WHERE g.id <> NEW.id
      AND g.aktif
      AND NEW.tanggal_mulai < COALESCE(g.tanggal_selesai, 'infinity'::timestamptz)
      AND g.tanggal_mulai < COALESCE(NEW.tanggal_selesai, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'Periode gelombang SPMB aktif tidak boleh saling tumpang tindih';
  END IF;

  IF NEW.gratis_pendaftaran THEN
    IF NEW.skema_diskon_id IS NULL THEN
      generated_scheme_name := 'Promo SPMB ' || trim(NEW.nama) || ' 2027/2028';

      SELECT id INTO NEW.skema_diskon_id
      FROM public.skema_diskon
      WHERE nama = generated_scheme_name
      LIMIT 1;

      IF NEW.skema_diskon_id IS NULL THEN
        INSERT INTO public.skema_diskon (
          nama, kategori, tipe, nilai_default, perlu_approval, aktif, keterangan
        )
        VALUES (
          generated_scheme_name,
          'promo',
          'persen',
          100,
          false,
          true,
          'Otomatis dibuat untuk gratis biaya pendaftaran ' || trim(NEW.nama) || ' SPMB 2027/2028.'
        )
        RETURNING id INTO NEW.skema_diskon_id;
      END IF;
    END IF;
  ELSE
    NEW.skema_diskon_id := NULL;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_spmb_validate_wave_schedule ON public.spmb_gelombang;
CREATE TRIGGER trg_spmb_validate_wave_schedule
BEFORE INSERT OR UPDATE ON public.spmb_gelombang
FOR EACH ROW EXECUTE FUNCTION public.spmb_validate_wave_schedule();

DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.spmb_apply_first_wave_promo(uuid)'::regprocedure) INTO f;

  f := replace(
    f,
    'SELECT id INTO v_skema_id
  FROM public.skema_diskon
  WHERE nama = ''Promo SPMB Gelombang Pertama 2027/2028''
    AND aktif = true
  LIMIT 1;
  IF v_skema_id IS NULL THEN
    RAISE EXCEPTION ''Skema Promo SPMB Gelombang Pertama belum tersedia'';
  END IF;',
    'SELECT g.skema_diskon_id INTO v_skema_id
  FROM public.siswa_detail sd
  JOIN public.spmb_gelombang g ON g.id = sd.spmb_gelombang_id
  JOIN public.skema_diskon sk ON sk.id = g.skema_diskon_id
  WHERE sd.siswa_id = s.id
    AND g.gratis_pendaftaran = true
    AND sk.aktif = true
  LIMIT 1;
  IF v_skema_id IS NULL THEN
    RAISE EXCEPTION ''Skema promo gratis untuk gelombang SPMB belum tersedia'';
  END IF;'
  );

  f := replace(
    f,
    '''Otomatis: Promo SPMB Gelombang Pertama 2027/2028 berdasarkan tanggal pendaftaran.''',
    '''Otomatis: Promo gratis biaya pendaftaran SPMB berdasarkan gelombang pendaftaran.''');

  EXECUTE f;
END
$patch$;
