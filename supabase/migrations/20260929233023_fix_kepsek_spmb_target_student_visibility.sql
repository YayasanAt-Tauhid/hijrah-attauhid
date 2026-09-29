-- Allow a kepala sekolah to read the base siswa row for SPMB registrations
-- that target the kepala sekolah's own department.
--
-- Generic academic pages remain scoped by siswa.departemen_id; this policy only
-- adds rows that have an actual SPMB registration targeting the managed unit.

DROP POLICY IF EXISTS kepsek_spmb_target_siswa_select ON public.siswa;

CREATE POLICY kepsek_spmb_target_siswa_select
ON public.siswa
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND EXISTS (
    SELECT 1
    FROM public.siswa_detail d
    WHERE d.siswa_id = siswa.id
      AND d.spmb_gelombang_id IS NOT NULL
      AND d.spmb_departemen_tujuan_id IS NOT NULL
      AND public.can_manage_akademik_departemen(
        auth.uid(),
        d.spmb_departemen_tujuan_id
      )
  )
);

COMMENT ON POLICY kepsek_spmb_target_siswa_select ON public.siswa IS
  'Kepala sekolah dapat membaca data dasar siswa yang memiliki pendaftaran SPMB aktif menuju lembaganya, termasuk siswa internal yang masih tercatat di lembaga asal.';
