-- Identitas siswa tetap berelasi melalui siswa.id/UUID.
-- NIS, NISN, NIK Hijrah, dan NIK Dapodik dapat dikoreksi tanpa memutus histori.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS nik_dapodik text;

COMMENT ON COLUMN public.siswa_detail.nik IS
  'NIK Hijrah/legacy. Mutable untuk koreksi dan pelacakan migrasi data lama.';
COMMENT ON COLUMN public.siswa_detail.nik_dapodik IS
  'NIK resmi yang dicocokkan dengan Dapodik/KK. Mutable untuk koreksi data.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_detail_nik_dapodik_format_check'
      AND conrelid = 'public.siswa_detail'::regclass
  ) THEN
    ALTER TABLE public.siswa_detail
      ADD CONSTRAINT siswa_detail_nik_dapodik_format_check
      CHECK (nik_dapodik IS NULL OR nik_dapodik = '' OR nik_dapodik ~ '^[0-9]{16}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS siswa_nisn_unique_nonempty
  ON public.siswa (nisn)
  WHERE NULLIF(BTRIM(nisn), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS siswa_detail_nik_dapodik_unique_nonempty
  ON public.siswa_detail (nik_dapodik)
  WHERE NULLIF(BTRIM(nik_dapodik), '') IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.siswa_identitas_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  field_name text NOT NULL CHECK (field_name IN ('nis','nisn','nik','nik_dapodik')),
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS siswa_identitas_audit_siswa_changed_idx
  ON public.siswa_identitas_audit (siswa_id, changed_at DESC);

ALTER TABLE public.siswa_identitas_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS siswa_identitas_audit_select ON public.siswa_identitas_audit;
CREATE POLICY siswa_identitas_audit_select
ON public.siswa_identitas_audit
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    public.has_role(auth.uid(), 'admin_tu')
    AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
  )
);

REVOKE ALL ON TABLE public.siswa_identitas_audit FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.siswa_identitas_audit FROM authenticated;
GRANT SELECT ON TABLE public.siswa_identitas_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_siswa_identitas_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.nis IS DISTINCT FROM NEW.nis THEN
    INSERT INTO public.siswa_identitas_audit(siswa_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'nis', OLD.nis, NEW.nis, auth.uid());
  END IF;
  IF OLD.nisn IS DISTINCT FROM NEW.nisn THEN
    INSERT INTO public.siswa_identitas_audit(siswa_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, 'nisn', OLD.nisn, NEW.nisn, auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.audit_siswa_identitas_detail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.nik IS DISTINCT FROM NEW.nik THEN
    INSERT INTO public.siswa_identitas_audit(siswa_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.siswa_id, 'nik', OLD.nik, NEW.nik, auth.uid());
  END IF;
  IF OLD.nik_dapodik IS DISTINCT FROM NEW.nik_dapodik THEN
    INSERT INTO public.siswa_identitas_audit(siswa_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.siswa_id, 'nik_dapodik', OLD.nik_dapodik, NEW.nik_dapodik, auth.uid());
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.audit_siswa_identitas_master() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_siswa_identitas_detail() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS audit_siswa_identitas_master_trigger ON public.siswa;
CREATE TRIGGER audit_siswa_identitas_master_trigger
AFTER UPDATE OF nis, nisn ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.audit_siswa_identitas_master();

DROP TRIGGER IF EXISTS audit_siswa_identitas_detail_trigger ON public.siswa_detail;
CREATE TRIGGER audit_siswa_identitas_detail_trigger
AFTER UPDATE OF nik, nik_dapodik ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.audit_siswa_identitas_detail();
