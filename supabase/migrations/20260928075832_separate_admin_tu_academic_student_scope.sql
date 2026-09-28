-- Separate the academic student scope from SPMB target visibility.
-- Admin TU may validate internal SPMB candidates in the destination unit even while
-- the student's current academic department is still the previous unit. Generic
-- academic lists/statistics must only use the units the user actually manages.

CREATE OR REPLACE FUNCTION public.akademik_managed_departemen_ids()
RETURNS TABLE(departemen_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.departemen d
  WHERE d.kategori = 'unit_pendidikan'
    AND d.aktif = true
    AND public.can_manage_akademik_departemen(auth.uid(), d.id)
  ORDER BY d.kode NULLS LAST, d.nama, d.id
$$;

REVOKE ALL ON FUNCTION public.akademik_managed_departemen_ids()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_managed_departemen_ids()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.akademik_managed_departemen_ids() IS
  'Unit pendidikan yang menjadi scope akademik caller. Dipakai untuk memisahkan master/statistik siswa dari visibility calon SPMB lintas jenjang.';
