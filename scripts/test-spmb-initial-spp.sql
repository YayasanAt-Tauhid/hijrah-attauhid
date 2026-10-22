-- Run only on the clone. All financial and placement changes are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.users_profile WHERE role='admin' LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $qa$
DECLARE
  student_id uuid := '13900000-0000-4000-8000-000000000201';
  internal_id uuid := '13900000-0000-4000-8000-000000000202';
  academic_id uuid := '1e8bf57e-3093-411a-a980-afa9a2c3891c';
  spp_id uuid := '018835bd-866c-4c4e-a00b-6e977094276f';
  result jsonb;
  bill public.tagihan;
  before_plans integer;
  rejected boolean;
BEGIN
  SELECT count(*) INTO before_plans FROM public.rencana_tagihan_siswa WHERE siswa_id=student_id;
  result:=public.terbitkan_spp_awal_spmb(student_id,academic_id,spp_id,'2027-07-01',500000);
  IF (result->>'generated')::integer<>1 OR (result->>'scheduled')::integer<>1 THEN RAISE EXCEPTION 'initial SPP not generated: %',result; END IF;
  SELECT * INTO STRICT bill FROM public.tagihan WHERE siswa_id=student_id AND jenis_id=spp_id AND bulan=7 AND tahun_akademik_id=academic_id;
  IF bill.kelas_id IS NOT NULL OR bill.tanggal_pengakuan<>'2027-07-01' OR bill.jatuh_tempo<>'2027-07-10'
     OR bill.status<>'terjadwal' OR bill.jurnal_piutang_id IS NOT NULL OR bill.nominal_bruto<>500000 THEN
    RAISE EXCEPTION 'incorrect initial bill: %',row_to_json(bill);
  END IF;
  IF (SELECT count(*) FROM public.rencana_tagihan_siswa WHERE siswa_id=student_id)<>before_plans THEN RAISE EXCEPTION 'created recurring plan'; END IF;
  result:=public.terbitkan_spp_awal_spmb(student_id,academic_id,spp_id,'2027-07-01',900000);
  IF (result->>'skipped')::integer<>1 OR (SELECT nominal_bruto FROM public.tagihan WHERE id=bill.id)<>500000 THEN RAISE EXCEPTION 'duplicate changed original bill'; END IF;
  PERFORM set_config('qa.initial_spp_bill',bill.id::text,true);
  result:=public.terbitkan_spp_awal_spmb(internal_id,academic_id,spp_id,'2027-07-01',500000);
  IF (result->>'generated')::integer<>1 OR EXISTS(SELECT 1 FROM public.tagihan WHERE siswa_id=internal_id AND jenis_id=spp_id AND bulan=7 AND tahun_akademik_id=academic_id AND kelas_id IS NOT NULL) THEN
    RAISE EXCEPTION 'internal student reused former class';
  END IF;
  IF (SELECT spmb_tanggal_aktivasi FROM public.siswa_detail WHERE siswa_id=internal_id AND tahun_ajaran_id=academic_id LIMIT 1) IS NOT NULL THEN RAISE EXCEPTION 'unexpected academic activation'; END IF;

  rejected:=false;
  BEGIN PERFORM public.terbitkan_spp_awal_spmb(student_id,academic_id,spp_id,'2027-06-01',500000);
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'accepted month outside academic year'; END IF;
  rejected:=false;
  BEGIN PERFORM public.terbitkan_spp_awal_spmb(student_id,academic_id,spp_id,'2027-07-02',500000);
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'accepted invalid period'; END IF;
  rejected:=false;
  BEGIN PERFORM public.terbitkan_spp_awal_spmb(student_id,academic_id,(SELECT id FROM public.jenis_pembayaran WHERE nama='SPP SD' AND aktif LIMIT 1),'2027-07-01',500000);
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'accepted wrong school level'; END IF;
  PERFORM set_config('qa.staff_uid',auth.uid()::text,true);
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  rejected:=false;
  BEGIN PERFORM public.terbitkan_spp_awal_spmb(student_id,academic_id,spp_id,'2027-08-01',500000);
  EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM LIKE 'Anda tidak memiliki akses%'; END;
  PERFORM set_config('request.jwt.claim.sub',current_setting('qa.staff_uid'),true);
  IF NOT rejected THEN RAISE EXCEPTION 'unauthorized request was not rejected'; END IF;
  IF has_function_privilege('anon','public.terbitkan_spp_awal_spmb(uuid,uuid,uuid,date,numeric)','EXECUTE') THEN RAISE EXCEPTION 'anonymous execute permitted'; END IF;
END;
$qa$;
RESET ROLE;
DO $qa$
DECLARE
  bill public.tagihan;
  result jsonb;
  target_class uuid;
  cashier uuid;
  cash_account uuid;
  income_account uuid;
BEGIN
  SELECT * INTO STRICT bill FROM public.tagihan WHERE id=current_setting('qa.initial_spp_bill')::uuid;
  SELECT id INTO cashier FROM public.users_profile WHERE role='admin' LIMIT 1;
  SELECT akun_id INTO cash_account FROM public.pengaturan_akun WHERE kode_setting='kas_tunai';
  SELECT akun_id INTO income_account FROM public.pengaturan_akun WHERE kode_setting='AKUN_PENDAPATAN_DIMUKA';
  result:=public.proses_pembayaran_atomik(bill.siswa_id,bill.jenis_id,bill.bulan,bill.nominal,
    (now() AT TIME ZONE 'Asia/Jakarta')::date,'QA SPP before class',
    (SELECT departemen_id FROM public.jenis_pembayaran WHERE id=bill.jenis_id),
    (SELECT id FROM public.tahun_buku WHERE nama='Tahun 2026' LIMIT 1),true,bill.id,
    cash_account,income_account,'Pendapatan Diterima di Muka','JD',cashier,'SPP SMP');
  IF result->>'status_tagihan'<>'lunas' OR NOT (result->>'diterima_dimuka')::boolean THEN RAISE EXCEPTION 'early payment failed: %',result; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pendapatan_dimuka WHERE pembayaran_id=(result->>'pembayaran_id')::uuid AND status='pending') THEN RAISE EXCEPTION 'advance missing'; END IF;
  SELECT id INTO target_class FROM public.kelas WHERE departemen_id=(SELECT departemen_id FROM public.jenis_pembayaran WHERE id=bill.jenis_id) AND aktif ORDER BY nama LIMIT 1;
  INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif) VALUES(bill.siswa_id,target_class,bill.tahun_akademik_id,true);
  IF NOT EXISTS (SELECT 1 FROM public.v_tagihan_belum_bayar WHERE tagihan_id=bill.id AND kelas_nama=(SELECT nama FROM public.kelas WHERE id=target_class) AND sudah_bayar) THEN RAISE EXCEPTION 'class fallback or paid status missing'; END IF;
  SELECT to_jsonb(r) INTO result FROM public.generate_tagihan_batch(bill.jenis_id,bill.tahun_ajaran_id,bill.bulan,
    (SELECT departemen_id FROM public.jenis_pembayaran WHERE id=bill.jenis_id),
    jsonb_build_array(jsonb_build_object('siswa_id',bill.siswa_id,'kelas_id',target_class,'tahun_akademik_id',bill.tahun_akademik_id)),cashier) r;
  IF (result->>'generated')::integer<>0 OR (result->>'skipped')::integer<>1 THEN RAISE EXCEPTION 'regular generator duplicated bill: %',result; END IF;
  IF (SELECT count(*) FROM public.tagihan WHERE siswa_id=bill.siswa_id AND jenis_id=bill.jenis_id AND tahun_ajaran_id=bill.tahun_ajaran_id AND bulan=bill.bulan)<>1 THEN RAISE EXCEPTION 'duplicate July SPP'; END IF;
END;
$qa$;
SELECT 'PASS: external/internal classless SPP, academic period, no recurring plan, repeat-safe, invalid inputs, early payment/advance, later class and regular generator deduplication' AS result;
ROLLBACK;
