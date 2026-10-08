-- Finance can resolve employees recorded as journal creators.
-- Keep employee write permissions and other roles unchanged.
CREATE POLICY keuangan_jurnal_penginput_select
ON public.pegawai
FOR SELECT TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'keuangan')
  AND EXISTS (
    SELECT 1 FROM public.jurnal j
    WHERE j.dibuat_oleh = pegawai.id
  )
);
