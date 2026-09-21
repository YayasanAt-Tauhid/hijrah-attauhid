CREATE OR REPLACE FUNCTION public.can_access_spmb_siswa(_user_id uuid,_siswa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT
    public.has_role(_user_id,'admin')
    OR EXISTS (
      SELECT 1
      FROM public.siswa s
      LEFT JOIN public.siswa_detail d ON d.siswa_id=s.id
      WHERE s.id=_siswa_id
        AND (
          public.can_manage_akademik_departemen(_user_id,s.departemen_id)
          OR (
            d.spmb_departemen_tujuan_id IS NOT NULL
            AND public.can_manage_akademik_departemen(_user_id,d.spmb_departemen_tujuan_id)
          )
        )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_spmb_siswa(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_spmb_siswa(uuid,uuid) TO authenticated;

DO $patch$
DECLARE rec record; f text;
BEGIN
  FOR rec IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'spmb_finance_status',
        'spmb_mark_verified',
        'spmb_set_field_verification',
        'spmb_set_field_verifications',
        'spmb_verification_state',
        'spmb_verification_state_list'
      )
  LOOP
    SELECT pg_get_functiondef(rec.oid) INTO f;
    f:=replace(f,'public.can_access_akademik_siswa','public.can_access_spmb_siswa');
    EXECUTE f;
  END LOOP;
END
$patch$;

DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.spmb_verification_payload(uuid)'::regprocedure) INTO f;
  f:=replace(f,
    'SELECT * INTO dep FROM public.departemen WHERE id = s.departemen_id;',
    'SELECT * INTO dep FROM public.departemen WHERE id = COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id);');
  f:=replace(f,
    'SELECT * INTO ang FROM public.angkatan WHERE id = s.angkatan_id;',
    'SELECT * INTO ang FROM public.angkatan WHERE id = COALESCE(d.spmb_angkatan_tujuan_id, s.angkatan_id);');
  f:=replace(f,
    '''departemen_id'',s.departemen_id,',
    '''departemen_id'',COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id),');
  f:=replace(f,
    '''angkatan_id'',s.angkatan_id,',
    '''angkatan_id'',COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id),');
  f:=replace(f,
    'ang.departemen_id = s.departemen_id',
    'ang.departemen_id = COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id)');
  EXECUTE f;
END
$patch$;
