-- Final SPMB boarding policy by gender:
-- - SMP Ikhwan: choose Asrama / Non Asrama.
-- - SMA Ikhwan: choose Asrama / Non Asrama.
-- - SMP Akhwat: Non Asrama only.
-- - SMA Akhwat: Non Asrama only.
-- - MTA: Asrama only for public new registrations.
-- - TK/SD: no boarding status.

CREATE OR REPLACE FUNCTION public.spmb_normalize_public_boarding_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  dep public.departemen;
  target_dept uuid;
  code text;
  upper_name text;
BEGIN
  IF NEW.pmb_payment_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s
  FROM public.siswa
  WHERE id = NEW.siswa_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  target_dept := COALESCE(NEW.spmb_departemen_tujuan_id, s.departemen_id);

  SELECT * INTO dep
  FROM public.departemen
  WHERE id = target_dept;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  code := upper(trim(COALESCE(dep.kode, '')));
  upper_name := upper(trim(COALESCE(dep.nama, '')));

  IF code NOT IN ('TK','SD','SMP','SMA','MTA') THEN
    IF upper_name ~ '(^|[[:space:]])MTA([[:space:]]|$)' THEN code := 'MTA';
    ELSIF upper_name ~ '(^|[[:space:]])SMA([[:space:]]|$)' THEN code := 'SMA';
    ELSIF upper_name ~ '(^|[[:space:]])SMP([[:space:]]|$)' THEN code := 'SMP';
    ELSIF upper_name ~ '(^|[[:space:]])SD([[:space:]]|$)' THEN code := 'SD';
    ELSIF upper_name ~ '(^|[[:space:]])TK([[:space:]]|$)' THEN code := 'TK';
    END IF;
  END IF;

  IF code = 'MTA' AND COALESCE(NEW.jenis_pendaftaran, 'baru') <> 'alumni_internal' THEN
    NEW.status_asrama := 'asrama';
  ELSIF code IN ('SMP','SMA') AND s.jenis_kelamin = 'P' THEN
    NEW.status_asrama := 'non_asrama';
  ELSIF code IN ('SMP','SMA') AND s.jenis_kelamin = 'L' THEN
    IF COALESCE(NEW.status_asrama, '') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilihan Asrama / Non Asrama wajib dipilih untuk SMP dan SMA Ikhwan';
    END IF;
  ELSE
    NEW.status_asrama := NULL;
  END IF;

  RETURN NEW;
END
$$;

-- Normalize any existing public SPMB Akhwat rows to the only allowed value.
UPDATE public.siswa_detail d
SET status_asrama = 'non_asrama'
FROM public.siswa s, public.departemen dep
WHERE s.id = d.siswa_id
  AND dep.id = COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id)
  AND d.pmb_payment_token IS NOT NULL
  AND s.jenis_kelamin = 'P'
  AND upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA')
  AND d.status_asrama IS DISTINCT FROM 'non_asrama';

COMMENT ON FUNCTION public.spmb_normalize_public_boarding_policy() IS
  'SPMB publik: SMP/SMA Ikhwan memilih Asrama/Non Asrama; SMP/SMA Akhwat hanya non_asrama; MTA pendaftar baru selalu Asrama.';
