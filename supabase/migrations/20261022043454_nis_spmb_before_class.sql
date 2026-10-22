-- Reserve a destination-school NIS without moving the student's current school/class.
-- Called only by the authenticated, department-scoped server endpoint.
CREATE OR REPLACE FUNCTION public.akademik_generate_nis_spmb(
  p_siswa_id uuid, p_departemen_id uuid, p_angkatan_id uuid,
  p_nis text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  v_nis text;
  v_existing text;
  v_year text;
BEGIN
  SELECT * INTO s FROM public.siswa WHERE id=p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id=p_siswa_id FOR UPDATE;
  IF NOT FOUND
    OR COALESCE(d.spmb_departemen_tujuan_id,s.departemen_id) IS DISTINCT FROM p_departemen_id
    OR COALESCE(d.spmb_angkatan_tujuan_id,s.angkatan_id) IS DISTINCT FROM p_angkatan_id
  THEN RAISE EXCEPTION 'Lembaga/angkatan tidak sesuai tujuan SPMB siswa'; END IF;

  SELECT (regexp_match(a.nama,'([0-9]{4})'))[1] INTO v_year
  FROM public.angkatan a WHERE a.id=p_angkatan_id
    AND a.departemen_id=p_departemen_id AND COALESCE(a.aktif,true);
  IF v_year IS NULL THEN RAISE EXCEPTION 'Angkatan tujuan tidak valid'; END IF;

  IF p_nis IS NULL THEN
    v_nis := public.nis_get_or_create_for_department(
      p_siswa_id,p_departemen_id,p_angkatan_id,'spmb_sebelum_kelas',
      'NIS tujuan SPMB dibuat sebelum penempatan kelas');
  ELSE
    v_nis := replace(btrim(p_nis),'-','');
    IF v_nis !~ '^[0-9]{1,13}$' THEN
      RAISE EXCEPTION 'NIS harus berisi 1 sampai 13 digit';
    END IF;
    -- Share the generator's prefix lock to prevent manual/automatic collisions.
    PERFORM pg_advisory_xact_lock(hashtext('nis:' || left(v_nis,4)));
    SELECT nis INTO v_existing FROM public.siswa_tahun_masuk_departemen
    WHERE siswa_id=p_siswa_id AND departemen_id=p_departemen_id FOR UPDATE;
    IF NULLIF(btrim(v_existing),'') IS NOT NULL AND v_existing <> v_nis THEN
      RAISE EXCEPTION 'NIS tujuan sudah tersimpan. Gunakan prosedur koreksi identitas untuk menggantinya';
    END IF;
    IF EXISTS(SELECT 1 FROM public.siswa WHERE nis=v_nis AND id<>p_siswa_id)
      OR EXISTS(SELECT 1 FROM public.siswa_tahun_masuk_departemen WHERE nis=v_nis
        AND (siswa_id<>p_siswa_id OR departemen_id<>p_departemen_id))
    THEN RAISE EXCEPTION 'NIS sudah digunakan'; END IF;
    INSERT INTO public.siswa_tahun_masuk_departemen
      (siswa_id,departemen_id,tahun_masuk,nis,sumber,keterangan)
    VALUES(p_siswa_id,p_departemen_id,v_year::integer,v_nis,'spmb_manual_sebelum_kelas',
      'NIS tujuan SPMB diinput sebelum penempatan kelas')
    ON CONFLICT(siswa_id,departemen_id) DO UPDATE SET nis=EXCLUDED.nis,updated_at=now();
  END IF;

  -- The active-school NIS is changed only when this is already the same school.
  IF s.departemen_id=p_departemen_id THEN
    UPDATE public.siswa SET nis=v_nis WHERE id=p_siswa_id;
  END IF;
  RETURN v_nis;
END;
$$;
REVOKE ALL ON FUNCTION public.akademik_generate_nis_spmb(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.akademik_generate_nis_spmb(uuid,uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION public.akademik_generate_nis_spmb(uuid,uuid,uuid,text)
  IS 'Service-only scoped SPMB NIS reservation; no class, status or school transfer.';
