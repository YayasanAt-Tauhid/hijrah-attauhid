BEGIN;
DO $$
DECLARE uid uuid; dept uuid; k uuid; ta uuid; ang uuid; jenis uuid; journal uuid; sid uuid; r jsonb; amount numeric; pid uuid;
BEGIN
 SELECT id INTO uid FROM public.users_profile WHERE role='admin' LIMIT 1;
 SELECT c.id,c.departemen_id,cp.jenis_pembayaran_id INTO k,dept,jenis
 FROM public.kelas c JOIN public.konfigurasi_pmb cp ON cp.departemen_id=c.departemen_id
 JOIN public.departemen d ON d.id=c.departemen_id
 WHERE NULLIF(d.npsn,'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.angkatan a WHERE a.departemen_id=c.departemen_id) LIMIT 1;
 SELECT id INTO ang FROM public.angkatan WHERE departemen_id=dept LIMIT 1;
 SELECT id INTO ta FROM public.tahun_ajaran LIMIT 1;
 SELECT id INTO journal FROM public.jurnal LIMIT 1;
 IF k IS NULL OR journal IS NULL THEN RAISE EXCEPTION 'Test needs configured SPMB class and journal'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.akademik_save_siswa(jsonb_build_object('nama','__TEST_PAYMENT_ROLLBACK__','status','calon','departemen_id',dept,'angkatan_id',ang,'nis','__TEST_PAYMENT_NIS__'),jsonb_build_object('tahun_ajaran_id',ta,'status_asrama','non_asrama','dokumen_kk_path','kk/00000000-0000-0000-0000-000000000001.pdf','dokumen_akta_path','akta/00000000-0000-0000-0000-000000000001.pdf'),jsonb_build_object('kelas_id',k,'tahun_ajaran_id',ta));
 sid:=(r->>'id')::uuid;
 UPDATE public.siswa SET terverifikasi=true WHERE id=sid;
 r:=public.spmb_readiness(sid); amount:=(r->>'nominal')::numeric;
 IF amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'Test needs positive SPMB tariff'; END IF;
 INSERT INTO public.pembayaran(siswa_id,jenis_id,jumlah,jurnal_id,tanggal_bayar,tahun_ajaran_id) VALUES(sid,jenis,amount/2,journal,current_date,ta) RETURNING id INTO pid;
 IF (public.spmb_readiness(sid)->>'lunas')::boolean THEN RAISE EXCEPTION 'Partial payment counted as paid'; END IF;
 UPDATE public.pembayaran SET jumlah=amount,jurnal_id=NULL WHERE id=pid;
 IF (public.spmb_readiness(sid)->>'lunas')::boolean THEN RAISE EXCEPTION 'Unposted payment counted as paid'; END IF;
 UPDATE public.pembayaran SET jurnal_id=journal,tahun_ajaran_id=NULL,tanggal_bayar=current_date-1 WHERE id=pid;
 IF (public.spmb_readiness(sid)->>'lunas')::boolean THEN RAISE EXCEPTION 'Old payment counted as paid'; END IF;
 UPDATE public.pembayaran SET tanggal_bayar=current_date WHERE id=pid;
 r:=public.spmb_readiness(sid);
 IF NOT (r->>'siap')::boolean THEN RAISE EXCEPTION 'Complete applicant rejected: %',r; END IF;
 UPDATE public.siswa SET status='diterima' WHERE id=sid;
 UPDATE public.siswa SET status='aktif' WHERE id=sid;
 IF (SELECT status FROM public.siswa WHERE id=sid)<>'aktif' THEN RAISE EXCEPTION 'Activation failed'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: partial payment, unposted payment, legacy period, acceptance and activation' AS result;
