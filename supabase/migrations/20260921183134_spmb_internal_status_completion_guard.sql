CREATE OR REPLACE FUNCTION public.spmb_set_registration_status(p_siswa_id uuid,p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE d public.siswa_detail;
BEGIN
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(d.spmb_siswa_internal,false) THEN
    RAISE EXCEPTION 'Pendaftaran internal tidak ditemukan';
  END IF;

  IF d.spmb_tanggal_aktivasi IS NOT NULL OR d.spmb_status_pendaftaran='selesai' THEN
    RAISE EXCEPTION 'Pendaftaran SPMB sudah selesai dan tidak dapat dibuka kembali';
  END IF;

  IF p_status NOT IN ('calon','diterima') THEN
    RAISE EXCEPTION 'Status selesai hanya boleh dibuat melalui aktivasi ke jenjang tujuan';
  END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'admin')
    OR (
      public.has_role(auth.uid(),'admin_tu')
      AND public.can_manage_akademik_departemen(auth.uid(),d.spmb_departemen_tujuan_id)
    )
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF p_status='diterima'
     AND NOT COALESCE((public.spmb_readiness(p_siswa_id)->>'siap')::boolean,false) THEN
    RAISE EXCEPTION 'SPMB belum lengkap untuk diterima';
  END IF;

  UPDATE public.siswa_detail
  SET spmb_status_pendaftaran=p_status
  WHERE siswa_id=p_siswa_id;

  RETURN p_status;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_set_registration_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_registration_status(uuid,text) TO authenticated;
