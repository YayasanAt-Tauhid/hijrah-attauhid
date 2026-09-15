-- Run with a database owner connection. All fixtures and changes roll back.
BEGIN;
DO $$
DECLARE uid uuid; dept uuid; k uuid; ta uuid; sid uuid; r jsonb; before_count bigint; failed boolean;
BEGIN
 SELECT id INTO uid FROM public.users_profile WHERE role='admin' LIMIT 1;
 SELECT c.id,c.departemen_id INTO k,dept FROM public.kelas c WHERE c.departemen_id IS NOT NULL LIMIT 1;
 SELECT id INTO ta FROM public.tahun_ajaran LIMIT 1;
 IF uid IS NULL OR k IS NULL OR ta IS NULL THEN RAISE EXCEPTION 'Test needs admin, class and academic year'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 -- Save biodata and class as one operation.
 r:=public.akademik_save_siswa(jsonb_build_object('nama','__TEST_SPMB_ROLLBACK__','status','calon','departemen_id',dept),jsonb_build_object('nama_ayah','test'),jsonb_build_object('kelas_id',k,'tahun_ajaran_id',ta));
 sid:=(r->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.siswa_detail WHERE siswa_id=sid AND nama_ayah='test') THEN RAISE EXCEPTION 'detail missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.kelas_siswa WHERE siswa_id=sid AND aktif AND tahun_ajaran_id=ta) THEN RAISE EXCEPTION 'class missing'; END IF;
 -- A failure after creating the master must roll the master back too.
 SELECT count(*) INTO before_count FROM public.siswa;
 failed:=false;
 BEGIN
   PERFORM public.akademik_save_siswa(jsonb_build_object('nama','__TEST_FAIL__','status','calon','departemen_id',dept),jsonb_build_object('unknown_column','x'));
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed OR (SELECT count(*) FROM public.siswa)<>before_count THEN RAISE EXCEPTION 'partial insert was not rolled back'; END IF;
 -- Reject bypass from both generic edit and direct table update.
 failed:=false;
 BEGIN
   PERFORM public.akademik_save_siswa(jsonb_build_object('nama','__TEST__','status','aktif','departemen_id',dept),NULL,NULL,sid);
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'edit bypass accepted'; END IF;
 failed:=false;
 BEGIN UPDATE public.siswa SET status='aktif' WHERE id=sid;
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'direct activation bypass accepted'; END IF;
 failed:=false;
 BEGIN UPDATE public.siswa SET status='diterima',nis='__TEST_NIS__' WHERE id=sid;
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'incomplete applicant accepted'; END IF;
 -- Failed class replacement must preserve the original active class.
 failed:=false;
 BEGIN
   PERFORM public.akademik_save_siswa(jsonb_build_object('nama','__TEST__','status','calon','departemen_id',dept),NULL,jsonb_build_object('kelas_id',k,'tahun_ajaran_id',gen_random_uuid()),sid);
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed OR NOT EXISTS(SELECT 1 FROM public.kelas_siswa WHERE siswa_id=sid AND aktif AND tahun_ajaran_id=ta) THEN RAISE EXCEPTION 'class rollback failed'; END IF;
 -- Missing class year fails instead of silently dropping the placement.
 failed:=false;
 BEGIN PERFORM public.akademik_save_siswa(jsonb_build_object('nama','__TEST__','departemen_id',dept),NULL,jsonb_build_object('kelas_id',k));
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'missing class year accepted'; END IF;
 -- A batch containing a missing student must roll back all preceding changes.
 r:=public.akademik_save_siswa(jsonb_build_object('nama','__TEST_ACTIVE_ROLLBACK__','status','aktif','departemen_id',dept),NULL,jsonb_build_object('kelas_id',k,'tahun_ajaran_id',ta));
 sid:=(r->>'id')::uuid;
 failed:=false;
 BEGIN PERFORM public.akademik_mutasi(ARRAY[sid,gen_random_uuid()],'alumni');
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed OR (SELECT status FROM public.siswa WHERE id=sid)<>'aktif' THEN RAISE EXCEPTION 'batch rollback failed'; END IF;
 PERFORM public.akademik_mutasi(ARRAY[sid],'tinggal',NULL,ta);
 PERFORM public.akademik_mutasi(ARRAY[sid],'alumni');
 IF (SELECT status FROM public.siswa WHERE id=sid)<>'alumni' OR EXISTS(SELECT 1 FROM public.kelas_siswa WHERE siswa_id=sid AND aktif) THEN RAISE EXCEPTION 'graduation failed'; END IF;
 -- Anonymous callers cannot execute mutation helpers.
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{}',true);
 failed:=false;
 BEGIN PERFORM public.akademik_mutasi(ARRAY[sid],'alumni');
 EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'anonymous mutation accepted'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: atomic save, rollback, status guards, class year, bulk mutation and authorization' AS result;
