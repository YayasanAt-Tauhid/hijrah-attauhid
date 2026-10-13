-- Run only against a test project. All fixtures are rolled back.
BEGIN;
DO $test$
DECLARE
  f uuid := gen_random_uuid(); control_family uuid := gen_random_uuid();
  older uuid := gen_random_uuid(); younger uuid := gen_random_uuid();
  control_old uuid := gen_random_uuid(); control_young uuid := gen_random_uuid();
  kind uuid; scheme uuid; dept uuid; policy uuid; original_journal uuid;
  fiscal2026 uuid; fiscal2027 uuid;
  current_bill uuid := gen_random_uuid(); older_bill uuid := gen_random_uuid();
  future_bill uuid := gen_random_uuid(); control_bill uuid := gen_random_uuid();
  pending_bill uuid := gen_random_uuid(); legacy_bill uuid := gen_random_uuid();
  failed_bill uuid := gen_random_uuid(); paid_bill uuid := gen_random_uuid();
  result jsonb; second_result jsonb; before_journals integer;
BEGIN
  SELECT id,departemen_id INTO kind,dept FROM jenis_pembayaran
    WHERE nama='SPP TK' AND aktif=true LIMIT 1;
  SELECT id INTO scheme FROM skema_diskon
    WHERE nama='Potongan Anak ke-2' AND kategori='kakak_adik' AND aktif=true LIMIT 1;
  IF kind IS NULL OR scheme IS NULL THEN RAISE EXCEPTION 'Missing test reference data'; END IF;
  SELECT id INTO fiscal2026 FROM tahun_buku WHERE '2026-10-10'::date BETWEEN tanggal_mulai AND tanggal_selesai LIMIT 1;
  SELECT id INTO fiscal2027 FROM tahun_buku WHERE '2027-01-10'::date BETWEEN tanggal_mulai AND tanggal_selesai LIMIT 1;
  IF fiscal2026 IS NULL OR fiscal2027 IS NULL THEN RAISE EXCEPTION 'Missing fixture fiscal years'; END IF;
  INSERT INTO kebijakan_keringanan(kode,versi,nama,skema_diskon_id,jenis_id,
    tipe,nilai,otomatis,perlu_pengajuan,berlaku_mulai)
  VALUES('qa-sibling-'||f::text,1,'QA sibling policy',scheme,kind,
    'nominal',50000,true,false,'2026-07-01') RETURNING id INTO policy;
  INSERT INTO keluarga(id,nama) VALUES(f,'QA existing bills'),(control_family,'QA untouched family');
  INSERT INTO siswa(id,nama,status,tanggal_lahir,keluarga_id,departemen_id) VALUES
    (older,'QA older','aktif','2018-06-09',f,dept),
    (younger,'QA younger','aktif','2022-03-22',f,dept),
    (control_old,'QA control older','aktif','2018-06-09',control_family,dept),
    (control_young,'QA control younger','aktif','2022-03-22',control_family,dept);
  INSERT INTO tarif_tagihan(jenis_id,siswa_id,nominal,aktif) VALUES
    (kind,older,350000,true),(kind,younger,350000,true),
    (kind,control_old,350000,true),(kind,control_young,350000,true);
  INSERT INTO jurnal(nomor,tanggal,keterangan,total_debit,total_kredit,status,departemen_id,referensi)
    VALUES('QA-SIBLING-'||f::text,'2026-10-01','QA original bill',350000,350000,'posted',dept,current_bill::text)
    RETURNING id INTO original_journal;
  INSERT INTO tagihan(id,siswa_id,jenis_id,tahun_ajaran_id,bulan,jatuh_tempo,nominal,nominal_bruto,
    nominal_diskon,status,jurnal_piutang_id) VALUES
    (current_bill,younger,kind,fiscal2026,10,'2026-10-10',350000,350000,0,'belum_bayar',original_journal),
    (older_bill,older,kind,fiscal2026,10,'2026-10-10',350000,350000,0,'terjadwal',NULL),
    (future_bill,younger,kind,fiscal2026,11,'2026-11-10',350000,350000,0,'terjadwal',NULL),
    (control_bill,control_young,kind,fiscal2026,10,'2026-10-10',350000,350000,0,'terjadwal',NULL),
    (pending_bill,younger,kind,fiscal2026,12,'2026-12-10',350000,350000,0,'terjadwal',NULL),
    (legacy_bill,younger,kind,fiscal2027,1,'2027-01-10',325000,350000,25000,'terjadwal',NULL),
    (failed_bill,younger,kind,fiscal2027,2,'2027-02-10',350000,350000,0,'belum_bayar',NULL),
    (paid_bill,younger,kind,fiscal2027,4,'2027-04-10',350000,350000,0,'lunas',NULL);

  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2026-10-13');
  IF result->>'dibuat'<>'1' OR result->>'diterapkan_ke_tagihan_existing'<>'1'
     OR result->'errors'<>'[]'::jsonb THEN RAISE EXCEPTION 'Current bill sync failed: %',result; END IF;
  IF NOT EXISTS(SELECT 1 FROM tagihan WHERE id=current_bill AND nominal=300000 AND nominal_diskon=50000)
     THEN RAISE EXCEPTION 'Current bill must be reduced without any plan'; END IF;
  IF EXISTS(SELECT 1 FROM tagihan WHERE id IN(older_bill,future_bill,control_bill) AND nominal<>350000)
     THEN RAISE EXCEPTION 'Older child, future month or another family changed'; END IF;
  SELECT count(*) INTO before_journals FROM jurnal WHERE referensi LIKE 'DISKON:%:'||current_bill::text;
  IF before_journals<>1 THEN RAISE EXCEPTION 'Expected exactly one correction journal'; END IF;
  IF EXISTS(SELECT 1 FROM jurnal j WHERE j.referensi LIKE 'DISKON:%:'||current_bill::text
    AND (SELECT COALESCE(sum(d.debit),0)-COALESCE(sum(d.kredit),0) FROM jurnal_detail d WHERE d.jurnal_id=j.id)<>0)
    THEN RAISE EXCEPTION 'Correction journal is unbalanced'; END IF;

  second_result := sinkronkan_diskon_kakak_adik_keluarga(f,'2026-10-13');
  IF second_result->>'dibuat'<>'0' OR
    (SELECT count(*) FROM siswa_diskon WHERE siswa_id=younger AND periode_mulai='2026-10-01')<>1 OR
    (SELECT count(*) FROM jurnal WHERE referensi LIKE 'DISKON:%:'||current_bill::text)<>before_journals
    THEN RAISE EXCEPTION 'Retry produced duplicate discounts or journals: %',second_result; END IF;

  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2026-11-01');
  IF result->>'dibuat'<>'1' OR NOT EXISTS(SELECT 1 FROM tagihan WHERE id=future_bill AND nominal=300000)
    THEN RAISE EXCEPTION 'Next month without plan failed: %',result; END IF;

  INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,kebijakan_keringanan_id,
    periode_mulai,periode_selesai,nilai,status)
    VALUES(younger,scheme,kind,policy,'2026-12-01','2026-12-31',50000,'diajukan');
  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2026-12-01');
  IF result->>'dibuat'<>'0' OR result->>'dilewati_karena_diskon_lain'<>'1'
    OR (SELECT nominal FROM tagihan WHERE id=pending_bill)<>350000
    THEN RAISE EXCEPTION 'Pending discount was overwritten: %',result; END IF;
  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2027-01-01');
  IF result->>'dibuat'<>'0' OR (SELECT nominal FROM tagihan WHERE id=legacy_bill)<>325000
    THEN RAISE EXCEPTION 'Existing bill reduction was stacked: %',result; END IF;
  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2027-02-01');
  IF result->>'dibuat'<>'0' OR jsonb_array_length(result->'errors')<>1 OR
    EXISTS(SELECT 1 FROM siswa_diskon WHERE siswa_id=younger AND periode_mulai='2027-02-01')
    THEN RAISE EXCEPTION 'Failed application did not roll back: %',result; END IF;
  result := sinkronkan_diskon_kakak_adik_keluarga(f,'2027-04-01');
  IF result->>'dibuat'<>'0' OR (SELECT nominal FROM tagihan WHERE id=paid_bill)<>350000
    THEN RAISE EXCEPTION 'Paid bill changed: %',result; END IF;
  IF has_function_privilege('anon','public.sinkronkan_diskon_kakak_adik_keluarga(uuid,date)','execute')
    OR has_function_privilege('authenticated','public.sinkronkan_diskon_kakak_adik_keluarga(uuid,date)','execute')
    THEN RAISE EXCEPTION 'Service-only RPC is exposed'; END IF;
END;
$test$;
SELECT 'PASS: existing unpaid bill, journal balance, oldest child, family scope, future month, idempotency, existing/pending discount, rollback, paid bill, permissions' AS result;
ROLLBACK;
