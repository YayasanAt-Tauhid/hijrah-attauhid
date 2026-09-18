-- Complete scoped Admin TU access for academic assessment/reporting tables.

DROP POLICY IF EXISTS admin_tu_penilaian_all ON public.penilaian;
CREATE POLICY admin_tu_penilaian_all ON public.penilaian
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);

DROP POLICY IF EXISTS admin_tu_presensi_kbm_all ON public.presensi_kbm;
CREATE POLICY admin_tu_presensi_kbm_all ON public.presensi_kbm
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);

DROP POLICY IF EXISTS admin_tu_komentar_rapor_all ON public.komentar_rapor;
CREATE POLICY admin_tu_komentar_rapor_all ON public.komentar_rapor
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);
