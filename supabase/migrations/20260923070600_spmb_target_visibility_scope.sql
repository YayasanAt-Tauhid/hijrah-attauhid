CREATE OR REPLACE FUNCTION public.spmb_visible_siswa_ids()
RETURNS TABLE(siswa_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.siswa_id
  FROM public.siswa_detail d
  JOIN public.siswa s ON s.id = d.siswa_id
  WHERE d.spmb_gelombang_id IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'kepala_sekolah')
      OR (
        public.has_role(auth.uid(), 'admin_tu')
        AND public.can_manage_akademik_departemen(
          auth.uid(),
          COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id)
        )
      )
    )
  ORDER BY COALESCE(d.spmb_registered_at, s.created_at) DESC, d.siswa_id;
$$;

REVOKE ALL ON FUNCTION public.spmb_visible_siswa_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_visible_siswa_ids() TO authenticated;

COMMENT ON FUNCTION public.spmb_visible_siswa_ids() IS
  'Daftar siswa yang boleh tampil pada /akademik/spmb. Admin TU discope berdasarkan lembaga tujuan SPMB, bukan lembaga aktif siswa.';
