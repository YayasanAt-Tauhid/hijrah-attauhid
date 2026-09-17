-- Run on the intended project only. Fixtures and all changes roll back.
BEGIN;
DO $$
DECLARE sid uuid; first_at timestamptz; again_at timestamptz; a text; rejected boolean; before_siswa jsonb; before_detail jsonb;
BEGIN
  INSERT INTO public.siswa(nama,status) VALUES ('__TEST_MILESTONE_ROLLBACK__','calon') RETURNING id INTO sid;
  INSERT INTO public.siswa_detail(siswa_id) SELECT sid WHERE NOT EXISTS (SELECT 1 FROM public.siswa_detail WHERE siswa_id=sid);
  SELECT to_jsonb(s) INTO before_siswa FROM public.siswa s WHERE id=sid;
  SELECT to_jsonb(d)-ARRAY['spmb_tanggal_tes','spmb_tanggal_lulus','spmb_tanggal_daftar_ulang','updated_at'] INTO before_detail FROM public.siswa_detail d WHERE siswa_id=sid;
  FOREACH a IN ARRAY ARRAY['lulus','daftar_ulang'] LOOP
    rejected:=false;
    BEGIN PERFORM public.spmb_mark_milestone(sid,a);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Premature % accepted',a; END IF;
  END LOOP;
  FOREACH a IN ARRAY ARRAY['tes','lulus','daftar_ulang'] LOOP
    first_at:=public.spmb_mark_milestone(sid,a);
    again_at:=public.spmb_mark_milestone(sid,a);
    IF first_at IS NULL OR first_at IS DISTINCT FROM again_at THEN RAISE EXCEPTION 'Not idempotent: %',a; END IF;
  END LOOP;
  IF (SELECT to_jsonb(s) FROM public.siswa s WHERE id=sid) IS DISTINCT FROM before_siswa THEN RAISE EXCEPTION 'Student master changed'; END IF;
  IF (SELECT to_jsonb(d)-ARRAY['spmb_tanggal_tes','spmb_tanggal_lulus','spmb_tanggal_daftar_ulang','updated_at'] FROM public.siswa_detail d WHERE siswa_id=sid) IS DISTINCT FROM before_detail THEN RAISE EXCEPTION 'Non-milestone detail changed'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: prerequisite rejection, three milestones, idempotency, biodata unchanged; fixtures rolled back' AS result;
