-- Limit transfer-only school documents to the target SMP/SMA/MTA.
-- Keep all other checks, ACLs, and existing uploaded documents intact.
DO $migration$
DECLARE
  definition text;
  original text;
BEGIN
  SELECT pg_get_functiondef('public.guard_spmb_public_registration_policy()'::regprocedure) INTO original;
  definition := replace(original,
    $old$  IF NEW.kategori = 'MURID PINDAHAN' THEN
    IF NULLIF(trim(COALESCE(NEW.dokumen_rapor_path,'')), '') IS NULL$old$,
    $new$  IF NEW.kategori = 'MURID PINDAHAN' AND (
    upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
    OR upper(COALESCE(dep.nama,'')) ~ '(^|[[:space:]])(SMP|SMA|MTA)([[:space:]]|$)'
  ) THEN
    IF NULLIF(trim(COALESCE(NEW.dokumen_rapor_path,'')), '') IS NULL$new$);
  IF definition = original THEN
    RAISE EXCEPTION 'Transfer document guard does not match expected definition';
  END IF;
  -- Preserve previously uploaded files on transfer records outside these levels.
  original := definition;
  definition := replace(definition,
    $old$  ELSE
    NEW.dokumen_rapor_path := NULL;
    NEW.dokumen_ijazah_path := NULL;
  END IF;$old$,
    $new$  ELSIF NEW.kategori <> 'MURID PINDAHAN' THEN
    NEW.dokumen_rapor_path := NULL;
    NEW.dokumen_ijazah_path := NULL;
  END IF;$new$);
  IF definition = original THEN
    RAISE EXCEPTION 'Transfer document cleanup does not match expected definition';
  END IF;
  EXECUTE definition;

  SELECT pg_get_functiondef('public.spmb_verification_payload(uuid)'::regprocedure) INTO original;
  definition := replace(original, 'IF is_transfer THEN', 'IF is_transfer AND need_nisn THEN');
  IF definition = original THEN
    RAISE EXCEPTION 'Transfer document verification does not match expected definition';
  END IF;
  EXECUTE definition;
END
$migration$;
