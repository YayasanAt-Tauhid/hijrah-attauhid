-- Allow Admin TU to manage one, several, or all currently selected education units.
-- users_profile.departemen_id remains the primary/legacy unit for compatibility,
-- while authorization is driven by this many-to-many scope table.

CREATE TABLE IF NOT EXISTS public.admin_tu_departemen_scope (
  user_id uuid NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
  departemen_id uuid NOT NULL REFERENCES public.departemen(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, departemen_id)
);

CREATE INDEX IF NOT EXISTS admin_tu_departemen_scope_departemen_idx
  ON public.admin_tu_departemen_scope(departemen_id, user_id);

ALTER TABLE public.admin_tu_departemen_scope ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_tu_departemen_scope FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_tu_departemen_scope TO authenticated;
GRANT ALL ON TABLE public.admin_tu_departemen_scope TO service_role;

DROP POLICY IF EXISTS admin_tu_departemen_scope_admin_select ON public.admin_tu_departemen_scope;
CREATE POLICY admin_tu_departemen_scope_admin_select
ON public.admin_tu_departemen_scope
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.admin_tu_departemen_scope(user_id, departemen_id)
SELECT up.id, up.departemen_id
FROM public.users_profile up
JOIN public.departemen d ON d.id = up.departemen_id
WHERE up.role = 'admin_tu'
  AND up.departemen_id IS NOT NULL
  AND d.aktif = true
  AND d.kategori = 'unit_pendidikan'
ON CONFLICT (user_id, departemen_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_admin_tu_departemen_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin_tu' AND NEW.departemen_id IS NOT NULL THEN
    INSERT INTO public.admin_tu_departemen_scope(user_id, departemen_id)
    VALUES (NEW.id, NEW.departemen_id)
    ON CONFLICT (user_id, departemen_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'admin_tu' AND NEW.role IS DISTINCT FROM 'admin_tu' THEN
    DELETE FROM public.admin_tu_departemen_scope WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_admin_tu_departemen_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_admin_tu_departemen_scope ON public.users_profile;
CREATE TRIGGER trg_sync_admin_tu_departemen_scope
AFTER INSERT OR UPDATE OF role, departemen_id ON public.users_profile
FOR EACH ROW
EXECUTE FUNCTION public.sync_admin_tu_departemen_scope();

CREATE OR REPLACE FUNCTION public.can_manage_akademik_departemen(_user_id uuid, _departemen_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'admin_tu')
      AND _departemen_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.admin_tu_departemen_scope s
          WHERE s.user_id = _user_id
            AND s.departemen_id = _departemen_id
        )
        OR public.user_departemen_id(_user_id) = _departemen_id
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_admin_tu_scope(
  p_user_id uuid,
  p_departemen_ids uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  scoped uuid[];
  primary_dept uuid;
  valid_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT COALESCE(array_agg(x.id ORDER BY x.id), '{}'::uuid[])
  INTO scoped
  FROM (
    SELECT DISTINCT id
    FROM unnest(COALESCE(p_departemen_ids, '{}'::uuid[])) AS u(id)
    WHERE id IS NOT NULL
  ) x;

  IF cardinality(scoped) = 0 THEN
    RAISE EXCEPTION 'Admin TU wajib memiliki minimal satu lembaga';
  END IF;

  SELECT count(*)
  INTO valid_count
  FROM public.departemen d
  WHERE d.id = ANY(scoped)
    AND d.aktif = true
    AND d.kategori = 'unit_pendidikan';

  IF valid_count <> cardinality(scoped) THEN
    RAISE EXCEPTION 'Terdapat lembaga yang tidak valid atau bukan unit pendidikan';
  END IF;

  primary_dept := scoped[1];

  UPDATE public.users_profile
  SET role = 'admin_tu',
      departemen_id = primary_dept,
      aktif = true
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun tidak ditemukan';
  END IF;

  DELETE FROM public.admin_tu_departemen_scope
  WHERE user_id = p_user_id;

  INSERT INTO public.admin_tu_departemen_scope(user_id, departemen_id)
  SELECT p_user_id, id
  FROM unnest(scoped) AS s(id)
  ON CONFLICT (user_id, departemen_id) DO NOTHING;

  RETURN scoped;
END
$$;

REVOKE ALL ON FUNCTION public.admin_set_admin_tu_scope(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_admin_tu_scope(uuid,uuid[]) TO authenticated, service_role;

COMMENT ON TABLE public.admin_tu_departemen_scope IS
  'Cakupan lembaga untuk Admin TU. Satu akun dapat memiliki satu atau beberapa unit pendidikan.';

COMMENT ON FUNCTION public.admin_set_admin_tu_scope(uuid,uuid[]) IS
  'Admin-only setter atomik untuk role Admin TU dan cakupan satu/beberapa lembaga.';
