-- Correct SPMB boarding policy:
-- - SMA (Ikhwan/Akhwat): parent chooses Asrama or Non Asrama.
-- - SMP Ikhwan: parent chooses Asrama or Non Asrama.
-- - SMP Akhwat: no boarding option; stored as non_asrama.
-- - MTA: public new registrations are always Asrama.
--
-- Do not rewrite existing SMA registrations here. A previous migration temporarily
-- normalized SMA to non_asrama, and the original parent choice cannot be inferred safely.

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
    IF COALESCE(NEW.status_asrama, '') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilihan Asrama / Non Asrama wajib dipilih untuk SMA';
    END IF;
  ELSIF code = 'SMP' AND s.jenis_kelamin = 'P' THEN
    NEW.status_asrama := 'non_asrama';
  ELSIF code = 'SMP' AND s.jenis_kelamin = 'L' THEN
    IF COALESCE(NEW.status_asrama, '') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilihan Asrama / Non Asrama wajib dipilih untuk SMP Ikhwan';
    END IF;
  ELSE
    NEW.status_asrama := NULL;
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.spmb_normalize_public_boarding_policy() IS
  'SPMB publik: SMA dan SMP Ikhwan memilih Asrama/Non Asrama; SMP Akhwat non_asrama; MTA pendaftar baru selalu Asrama.';
