CREATE OR REPLACE FUNCTION public.spmb_mark_milestone(p_siswa_id uuid,p_action text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.siswa_detail; s public.siswa; target_dept uuid; marked_at timestamptz:=now();
BEGIN
 SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;
 SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
 target_dept:=COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id);
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR
   (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(),target_dept)))
 THEN RAISE EXCEPTION 'Akses ditolak'; END IF;
 CASE p_action
  WHEN 'tes' THEN
   IF d.spmb_tanggal_tes IS NOT NULL THEN RETURN d.spmb_tanggal_tes; END IF;
   UPDATE public.siswa_detail SET spmb_tanggal_tes=marked_at WHERE siswa_id=p_siswa_id; RETURN marked_at;
  WHEN 'lulus' THEN
   IF d.spmb_tanggal_tes IS NULL THEN RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu'; END IF;
   IF d.spmb_status_kelulusan='lulus' AND d.spmb_tanggal_lulus IS NOT NULL THEN RETURN d.spmb_tanggal_lulus; END IF;
   UPDATE public.siswa_detail SET spmb_status_kelulusan='lulus',spmb_tanggal_lulus=marked_at,spmb_tanggal_keputusan=marked_at WHERE siswa_id=p_siswa_id; RETURN marked_at;
  WHEN 'tidak_lulus' THEN
   IF d.spmb_tanggal_tes IS NULL THEN RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu'; END IF;
   IF d.spmb_status_kelulusan='tidak_lulus' AND d.spmb_tanggal_keputusan IS NOT NULL THEN RETURN d.spmb_tanggal_keputusan; END IF;
   UPDATE public.siswa_detail SET spmb_status_kelulusan='tidak_lulus',spmb_tanggal_lulus=NULL,spmb_tanggal_daftar_ulang=NULL,spmb_tanggal_keputusan=marked_at WHERE siswa_id=p_siswa_id; RETURN marked_at;
  WHEN 'daftar_ulang' THEN
   IF COALESCE(d.spmb_status_kelulusan,'')<>'lulus' OR d.spmb_tanggal_lulus IS NULL THEN RAISE EXCEPTION 'Calon murid harus dinyatakan Lulus terlebih dahulu'; END IF;
   IF d.spmb_tanggal_daftar_ulang IS NOT NULL THEN RETURN d.spmb_tanggal_daftar_ulang; END IF;
   UPDATE public.siswa_detail SET spmb_tanggal_daftar_ulang=marked_at WHERE siswa_id=p_siswa_id; RETURN marked_at;
  ELSE RAISE EXCEPTION 'Aksi SPMB tidak valid';
 END CASE;
END $$;
REVOKE ALL ON FUNCTION public.spmb_mark_milestone(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spmb_mark_milestone(uuid,text) TO authenticated;
