-- Clone QA only. Fixtures, invoices, discounts and decisions are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.users_profile WHERE role='admin' LIMIT 1),true);
DO $qa$
DECLARE
  v_year uuid;
  v_wave uuid;
  v_sid uuid;
  v_dept uuid;
  v_sd uuid;
  v_quote jsonb;
  v_result jsonb;
  v_bill public.tagihan;
  r record;
  v_expected numeric;
  v_rejected boolean;
  v_discount_id uuid;
  v_staff uuid:=auth.uid();
  v_count integer:=0;
BEGIN
  SELECT id INTO STRICT v_year FROM public.tahun_ajaran WHERE tanggal_mulai='2027-07-01' AND tanggal_selesai='2028-06-30';
  SELECT spmb_gelombang_id INTO v_wave FROM public.siswa_detail WHERE tahun_ajaran_id=v_year AND spmb_gelombang_id IS NOT NULL LIMIT 1;
  FOR r IN SELECT * FROM public.spmb_tarif_uang_pangkal ORDER BY departemen_kode,program LOOP
    SELECT id INTO STRICT v_dept FROM public.departemen WHERE kode=r.departemen_kode;
    v_sid:=gen_random_uuid();
    INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES(v_sid,'QA uang pangkal '||r.departemen_kode,v_dept,'diterima');
    INSERT INTO public.siswa_detail(siswa_id,tahun_ajaran_id,spmb_gelombang_id,spmb_status_kelulusan,
      spmb_status_pendaftaran,spmb_departemen_tujuan_id,status_asrama,spmb_registered_at)
    VALUES(v_sid,v_year,v_wave,'lulus','diterima',v_dept,
      CASE WHEN r.program='asrama' OR r.departemen_kode='MTA' THEN 'asrama' WHEN r.program='non_asrama' THEN 'non_asrama' ELSE NULL END,now());
    v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'none',CASE WHEN r.departemen_kode='MTA' THEN r.program END);
    IF (v_quote->>'bruto_acuan')::numeric<>r.nominal_bruto THEN RAISE EXCEPTION 'incorrect base tariff %',r; END IF;
    v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',CASE WHEN r.departemen_kode='MTA' THEN r.program END,
      r.nominal_bruto,NULL,v_quote->>'preview_hash',true);
    SELECT * INTO STRICT v_bill FROM public.tagihan WHERE id=(v_result->>'tagihan_id')::uuid;
    IF v_bill.nominal<>r.nominal_bruto OR v_bill.nominal_bruto<>r.nominal_bruto OR v_bill.nominal_diskon<>0
      OR v_bill.tahun_akademik_id<>v_year OR v_bill.kelas_id IS NOT NULL OR v_bill.status<>'terjadwal' THEN
      RAISE EXCEPTION 'incorrect base invoice: %',row_to_json(v_bill);
    END IF;
    v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',CASE WHEN r.departemen_kode='MTA' THEN r.program END,
      r.nominal_bruto,NULL,v_quote->>'preview_hash',true);
    IF NOT (v_result->>'skipped')::boolean OR (SELECT count(*) FROM public.tagihan WHERE siswa_id=v_sid)<>1 THEN
      RAISE EXCEPTION 'repeat created duplicate';
    END IF;
    v_count:=v_count+1;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('SMA','asrama','asrama',5500000::numeric),('SMA','asrama','non_asrama',8500000),
    ('SMA','non_asrama','asrama',5500000),('SMA','non_asrama','non_asrama',5500000),
    ('MTA','sma','asrama',4250000),('MTA','sma','non_asrama',5250000)
  ) x(kode,program,asal,neto) LOOP
    SELECT id INTO STRICT v_dept FROM public.departemen WHERE kode=r.kode;
    v_sid:=gen_random_uuid();
    -- Internal student remains in SD source here; finance must use destination.
    INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES(v_sid,'QA alumni '||r.kode,(SELECT id FROM public.departemen WHERE kode='SD'),'aktif');
    INSERT INTO public.siswa_detail(siswa_id,tahun_ajaran_id,spmb_gelombang_id,spmb_status_kelulusan,
      spmb_status_pendaftaran,spmb_siswa_internal,spmb_departemen_tujuan_id,status_asrama,spmb_registered_at)
    VALUES(v_sid,v_year,v_wave,'lulus','diterima',true,v_dept,CASE WHEN r.kode='MTA' THEN 'asrama' ELSE r.program END,now());
    v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,r.asal,CASE WHEN r.kode='MTA' THEN r.program END);
    v_expected:=(v_quote->>'bruto_acuan')::numeric-r.neto;
    IF (v_quote->>'keringanan_alumni')::numeric<>v_expected THEN RAISE EXCEPTION 'incorrect alumni calculation: %',r; END IF;
    v_rejected:=false;
    BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,r.asal,CASE WHEN r.kode='MTA' THEN r.program END,
      r.neto,'Tidak boleh menulis tarif neto sebagai bruto',v_quote->>'preview_hash',true);
    EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Bruto alumni harus%' OR SQLERRM LIKE 'Keringanan alumni melebihi%'; END;
    IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.tagihan WHERE siswa_id=v_sid) THEN RAISE EXCEPTION 'alumni net written as gross'; END IF;
    v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,r.asal,CASE WHEN r.kode='MTA' THEN r.program END,
      (v_quote->>'bruto_acuan')::numeric,NULL,v_quote->>'preview_hash',true);
    SELECT * INTO STRICT v_bill FROM public.tagihan WHERE id=(v_result->>'tagihan_id')::uuid;
    IF v_bill.nominal<>(v_quote->>'bruto_acuan')::numeric OR v_bill.nominal_diskon<>0 THEN RAISE EXCEPTION 'unapproved reduction applied'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.siswa_diskon WHERE id=(v_result->>'siswa_diskon_id')::uuid
      AND status='diajukan' AND nilai=v_expected AND tipe_snapshot='nominal'
      AND periode_mulai='2027-07-01' AND periode_selesai='2027-07-31') THEN RAISE EXCEPTION 'pending alumni request missing'; END IF;
    PERFORM public.putuskan_diskon_siswa((v_result->>'siswa_diskon_id')::uuid,true,v_staff,NULL);
    SELECT * INTO STRICT v_bill FROM public.tagihan WHERE id=v_bill.id;
    IF v_bill.nominal<>r.neto OR v_bill.nominal_bruto<>(v_quote->>'bruto_acuan')::numeric OR v_bill.nominal_diskon<>v_expected THEN
      RAISE EXCEPTION 'approved discount incorrect: %',row_to_json(v_bill);
    END IF;
    v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,r.asal,CASE WHEN r.kode='MTA' THEN r.program END,
      (v_quote->>'bruto_acuan')::numeric,NULL,v_quote->>'preview_hash',true);
    IF NOT (v_result->>'skipped')::boolean OR (SELECT count(*) FROM public.siswa_diskon WHERE siswa_id=v_sid)<>1 THEN RAISE EXCEPTION 'repeat duplicated alumni request'; END IF;
    v_count:=v_count+1;
  END LOOP;

  -- Historical approval without a bill must require manual application/review.
  SELECT id INTO v_dept FROM public.departemen WHERE kode='SMA';
  v_sid:=gen_random_uuid();
  INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES(v_sid,'QA historical alumni approval',v_dept,'diterima');
  INSERT INTO public.siswa_detail(siswa_id,tahun_ajaran_id,spmb_gelombang_id,spmb_status_kelulusan,
    spmb_status_pendaftaran,spmb_departemen_tujuan_id,status_asrama,spmb_registered_at)
  VALUES(v_sid,v_year,v_wave,'lulus','diterima',v_dept,'non_asrama',now());
  v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL);
  INSERT INTO public.siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diajukan_oleh,tipe_snapshot)
  VALUES(v_sid,(v_quote->>'skema_diskon_id')::uuid,(v_quote->>'jenis_id')::uuid,'2027-07-01','2027-07-31',4600000,'diajukan',v_staff,'nominal')
  RETURNING id INTO v_discount_id;
  PERFORM public.putuskan_diskon_siswa(v_discount_id,true,v_staff,NULL);
  v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL);
  v_rejected:=false;
  BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL,10100000,NULL,v_quote->>'preview_hash',true);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Keringanan alumni sudah disetujui tetapi%'; END;
  IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.tagihan WHERE siswa_id=v_sid)
    OR EXISTS(SELECT 1 FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_id=v_sid) THEN
    RAISE EXCEPTION 'unapplied historical approval generated a full-gross invoice';
  END IF;
  -- An old full-gross invoice also needs review; a correctly applied one can
  -- be adopted without another invoice or approval request.
  PERFORM public.simpan_tarif_generate_dan_rencana_atomik(
    p_tarif_rows=>jsonb_build_array(jsonb_build_object('jenis_id',(v_quote->>'jenis_id')::uuid,'siswa_id',v_sid,
      'kelas_id',NULL,'angkatan_id',NULL,'tahun_ajaran_id',(v_quote->>'tahun_buku_id')::uuid,'nominal',10100000)),
    p_tahun_akademik_id=>v_year,p_jenis_id=>(v_quote->>'jenis_id')::uuid,
    p_generate_groups=>jsonb_build_array(jsonb_build_object('tahun_buku_id',(v_quote->>'tahun_buku_id')::uuid,'bulan_list',jsonb_build_array(NULL))),
    p_departemen_id=>v_dept,p_siswa_id=>v_sid,p_sampai_akhir_jenjang=>false);
  v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL);
  v_rejected:=false;
  BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL,10100000,NULL,v_quote->>'preview_hash',true);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Keringanan alumni sudah disetujui tetapi%'; END;
  IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_id=v_sid) THEN
    RAISE EXCEPTION 'unapplied historical approval adopted an incorrect invoice';
  END IF;
  PERFORM public.terapkan_diskon_siswa(v_discount_id,v_staff);
  v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL);
  v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'asrama',NULL,10100000,NULL,v_quote->>'preview_hash',true);
  IF NOT (v_result->>'tagihan_sudah_ada')::boolean
    OR (SELECT count(*) FROM public.tagihan WHERE siswa_id=v_sid)<>1
    OR (SELECT count(*) FROM public.siswa_diskon WHERE siswa_id=v_sid)<>1
    OR (SELECT nominal FROM public.tagihan WHERE id=(v_result->>'tagihan_id')::uuid)<>5500000 THEN
    RAISE EXCEPTION 'correctly applied historical approval was not reused';
  END IF;

  SELECT id INTO v_dept FROM public.departemen WHERE kode='SD';
  v_sid:=gen_random_uuid();
  INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES(v_sid,'QA validation',v_dept,'diterima');
  INSERT INTO public.siswa_detail(siswa_id,tahun_ajaran_id,spmb_gelombang_id,spmb_status_kelulusan,
    spmb_status_pendaftaran,spmb_departemen_tujuan_id,spmb_registered_at)
  VALUES(v_sid,v_year,v_wave,'lulus','diterima',v_dept,now()) RETURNING id INTO v_sd;
  v_quote:=public.preview_uang_pangkal_spmb(v_sid,v_year,'none',NULL);
  v_rejected:=false;
  BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',NULL,9400000,NULL,v_quote->>'preview_hash',false);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Nominal dan data%'; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'confirmation not required'; END IF;
  v_rejected:=false;
  BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',NULL,1000000,NULL,v_quote->>'preview_hash',true);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Perubahan bruto%'; END;
  IF NOT v_rejected OR EXISTS(SELECT 1 FROM public.tagihan WHERE siswa_id=v_sid) THEN RAISE EXCEPTION 'invalid override persisted'; END IF;
  v_rejected:=false;
  BEGIN PERFORM public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',NULL,9400000,NULL,'stale',true);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Data/tarif/tagihan berubah%'; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'stale quote accepted'; END IF;
  v_result:=public.verifikasi_uang_pangkal_spmb(v_sid,v_year,'none',NULL,9500000,'Bruto khusus sesuai keputusan yayasan',v_quote->>'preview_hash',true);
  IF (SELECT nominal_bruto FROM public.tagihan WHERE id=(v_result->>'tagihan_id')::uuid)<>9500000 THEN RAISE EXCEPTION 'custom gross not honored'; END IF;

  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  v_rejected:=false;
  BEGIN PERFORM public.preview_uang_pangkal_spmb(v_sid,v_year,'none',NULL);
  EXCEPTION WHEN OTHERS THEN v_rejected:=SQLERRM LIKE 'Anda tidak memiliki akses%'; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'non-staff preview permitted'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_staff::text,true);
  IF has_function_privilege('anon','public.verifikasi_uang_pangkal_spmb(uuid,uuid,text,text,numeric,text,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'anonymous execution granted'; END IF;
  PERFORM set_config('qa.pangkal_cases',v_count::text,true);
END;
$qa$;

-- Verify the public API as the actual authenticated database role.
DO $fixture$
DECLARE sid uuid:=gen_random_uuid(); y uuid; d uuid; w uuid;
BEGIN
  SELECT id INTO y FROM public.tahun_ajaran WHERE tanggal_mulai='2027-07-01' AND tanggal_selesai='2028-06-30';
  SELECT id INTO d FROM public.departemen WHERE kode='SD';
  SELECT spmb_gelombang_id INTO w FROM public.siswa_detail WHERE tahun_ajaran_id=y AND spmb_gelombang_id IS NOT NULL LIMIT 1;
  INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES(sid,'QA authenticated API',d,'diterima');
  INSERT INTO public.siswa_detail(siswa_id,tahun_ajaran_id,spmb_gelombang_id,spmb_status_kelulusan,spmb_status_pendaftaran,spmb_departemen_tujuan_id)
    VALUES(sid,y,w,'lulus','diterima',d);
  PERFORM set_config('qa.auth_student',sid::text,true); PERFORM set_config('qa.auth_year',y::text,true);
END;
$fixture$;
SET LOCAL ROLE authenticated;
DO $authenticated$
DECLARE q jsonb; r jsonb;
BEGIN
  q:=public.preview_uang_pangkal_spmb(current_setting('qa.auth_student')::uuid,current_setting('qa.auth_year')::uuid,'none',NULL);
  r:=public.verifikasi_uang_pangkal_spmb(current_setting('qa.auth_student')::uuid,current_setting('qa.auth_year')::uuid,'none',NULL,9400000,NULL,q->>'preview_hash',true);
  IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'authenticated API failed'; END IF;
  IF (SELECT count(*) FROM public.spmb_uang_pangkal_verifikasi WHERE siswa_id=current_setting('qa.auth_student')::uuid)<>1 THEN RAISE EXCEPTION 'staff audit visibility failed'; END IF;
  IF has_table_privilege('authenticated','public.spmb_uang_pangkal_verifikasi','INSERT')
    OR has_table_privilege('authenticated','public.spmb_tarif_uang_pangkal','UPDATE') THEN RAISE EXCEPTION 'direct write granted'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  IF EXISTS(SELECT 1 FROM public.spmb_tarif_uang_pangkal) OR EXISTS(SELECT 1 FROM public.spmb_uang_pangkal_verifikasi) THEN RAISE EXCEPTION 'non-staff RLS leak'; END IF;
END;
$authenticated$;
RESET ROLE;
SELECT 'PASS: '||current_setting('qa.pangkal_cases')||' SK/program/alumni cases; gross preserved until approval; repeat-safe invoice/request; historical approval guards; validation and role checks' AS result;
ROLLBACK;
