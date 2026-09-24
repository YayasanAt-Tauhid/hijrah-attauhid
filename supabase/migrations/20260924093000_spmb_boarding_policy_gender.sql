-- SPMB boarding policy:
-- - SMA: no boarding option; always non_asrama.
-- - SMP Akhwat (female): no boarding option; always non_asrama.
-- - SMP Ikhwan (male): Asrama / Non Asrama remains required.
-- - MTA: public new registrations remain automatically Asrama.
--
-- The automatic non_asrama value preserves compatibility with existing
-- readiness, verification, reporting, and integration fields without asking
-- parents an irrelevant boarding question.

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
  ELSIF code = 'SMA' THEN
    NEW.status_asrama := 'non_asrama';
  ELSIF code = 'SMP' AND s.jenis_kelamin = 'P' THEN
    NEW.status_asrama := 'non_asrama';
  ELSIF code NOT IN ('SMP','MTA') THEN
    NEW.status_asrama := NULL;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS aaa_spmb_normalize_public_boarding_policy ON public.siswa_detail;
CREATE TRIGGER aaa_spmb_normalize_public_boarding_policy
BEFORE INSERT OR UPDATE OF
  pmb_payment_token,
  status_asrama,
  spmb_departemen_tujuan_id,
  siswa_id,
  jenis_pendaftaran
ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.spmb_normalize_public_boarding_policy();

-- Correct current public SPMB registrations that previously carried an
-- irrelevant boarding choice for SMA or SMP Akhwat.
UPDATE public.siswa_detail d
SET status_asrama = 'non_asrama'
FROM public.siswa s, public.departemen dep
WHERE s.id = d.siswa_id
  AND dep.id = COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id)
  AND d.pmb_payment_token IS NOT NULL
  AND (
    upper(trim(COALESCE(dep.kode,''))) = 'SMA'
    OR (
      upper(trim(COALESCE(dep.kode,''))) = 'SMP'
      AND s.jenis_kelamin = 'P'
    )
  )
  AND d.status_asrama IS DISTINCT FROM 'non_asrama';

COMMENT ON FUNCTION public.spmb_normalize_public_boarding_policy() IS
  'Normalisasi status asrama SPMB publik: SMA dan SMP Akhwat non_asrama, SMP Ikhwan memilih status, MTA pendaftar baru Asrama.';
