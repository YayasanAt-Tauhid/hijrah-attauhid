CREATE OR REPLACE FUNCTION public.spmb_sync_registration_status_from_siswa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE public.siswa_detail
  SET spmb_status_pendaftaran=CASE WHEN NEW.status IN ('calon','diterima','aktif') THEN NEW.status ELSE spmb_status_pendaftaran END
  WHERE siswa_id=NEW.id AND (spmb_gelombang_id IS NOT NULL OR pmb_payment_token IS NOT NULL)
    AND NOT COALESCE(spmb_siswa_internal,false);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_spmb_sync_registration_status_from_siswa ON public.siswa;
CREATE TRIGGER trg_spmb_sync_registration_status_from_siswa AFTER UPDATE OF status ON public.siswa
FOR EACH ROW EXECUTE FUNCTION public.spmb_sync_registration_status_from_siswa();

CREATE OR REPLACE FUNCTION public.akademik_find_spmb_migration_candidates(
 p_nisns text[] DEFAULT ARRAY[]::text[],p_niks text[] DEFAULT ARRAY[]::text[]
) RETURNS TABLE(id uuid,nis text,nisn text,status text,departemen_id uuid,nik text,nik_dapodik text,spmb_gelombang_id uuid,spmb_siswa_internal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.id,s.nis,s.nisn,s.status,s.departemen_id,d.nik,d.nik_dapodik,d.spmb_gelombang_id,d.spmb_siswa_internal
 FROM public.siswa s JOIN public.siswa_detail d ON d.siswa_id=s.id
 WHERE (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'admin_tu'))
   AND d.spmb_gelombang_id IS NOT NULL AND NOT COALESCE(d.spmb_siswa_internal,false) AND s.status='calon'
   AND (
    (s.nisn IS NOT NULL AND regexp_replace(s.nisn,'[^0-9]','','g')=ANY(SELECT regexp_replace(x,'[^0-9]','','g') FROM unnest(COALESCE(p_nisns,ARRAY[]::text[])) x))
    OR (d.nik IS NOT NULL AND regexp_replace(d.nik,'[^0-9]','','g')=ANY(SELECT regexp_replace(x,'[^0-9]','','g') FROM unnest(COALESCE(p_niks,ARRAY[]::text[])) x))
    OR (d.nik_dapodik IS NOT NULL AND regexp_replace(d.nik_dapodik,'[^0-9]','','g')=ANY(SELECT regexp_replace(x,'[^0-9]','','g') FROM unnest(COALESCE(p_niks,ARRAY[]::text[])) x))
   );
$$;
REVOKE ALL ON FUNCTION public.akademik_find_spmb_migration_candidates(text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.akademik_find_spmb_migration_candidates(text[],text[]) TO authenticated;
