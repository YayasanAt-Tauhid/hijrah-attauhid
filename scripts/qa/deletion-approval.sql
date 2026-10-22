-- Disposable LOCAL schema only. This file never targets production.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT IN ('hijrah_deletion_approval_test_20261021','hijrah_deletion_approval_clean_20261021') THEN
    RAISE EXCEPTION 'Use the isolated deletion-approval fixture database';
  END IF;
END $$;
CREATE TEMP TABLE checks(name text);
CREATE TEMP TABLE results(name text PRIMARY KEY,value jsonb);
CREATE FUNCTION pg_temp.ok(v boolean,n text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',n; END IF;
INSERT INTO checks VALUES(n); END $$;
CREATE FUNCTION pg_temp.denied(q text,expected text,n text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE message text;
BEGIN
  BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN message:=SQLERRM; END;
  IF message IS NULL OR position(expected IN message)=0 THEN
    RAISE EXCEPTION 'FAIL: % (expected %, got %)',n,expected,message;
  END IF;
  INSERT INTO checks VALUES(n);
END $$;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000001','deletion-admin@test.invalid'),
 ('00000000-0000-4000-8000-000000000002','deletion-finance@test.invalid'),
 ('00000000-0000-4000-8000-000000000003','deletion-tu@test.invalid'),
 ('00000000-0000-4000-8000-000000000004','deletion-cashier@test.invalid'),
 ('00000000-0000-4000-8000-000000000005','deletion-other@test.invalid');
INSERT INTO public.departemen(id,nama,kode,kategori) VALUES
 ('00000000-0000-4000-8000-000000000010','Dept A','DA','unit_pendidikan'),
 ('00000000-0000-4000-8000-000000000011','Dept B','DB','unit_pendidikan');
INSERT INTO public.users_profile(id,email,role,aktif,departemen_id)
SELECT id,email,CASE right(id::text,1) WHEN '1' THEN 'admin' WHEN '2' THEN 'keuangan'
 WHEN '3' THEN 'admin_tu' WHEN '4' THEN 'kasir' ELSE 'keuangan' END,true,
 CASE WHEN right(id::text,1)='3' THEN '00000000-0000-4000-8000-000000000010'::uuid END
FROM auth.users
ON CONFLICT(id) DO UPDATE SET role=excluded.role,aktif=excluded.aktif,departemen_id=excluded.departemen_id;
INSERT INTO public.jenis_pengeluaran(id,nama) VALUES
 ('00000000-0000-4000-8000-000000000020','Approve me'),
 ('00000000-0000-4000-8000-000000000021','Reject me'),
 ('00000000-0000-4000-8000-000000000022','Change me'),
 ('00000000-0000-4000-8000-000000000023','Duplicate me'),
 ('00000000-0000-4000-8000-000000000024','Disabled actor');
INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES
 ('00000000-0000-4000-8000-000000000030','Student A','00000000-0000-4000-8000-000000000010','aktif'),
 ('00000000-0000-4000-8000-000000000031','Student B','00000000-0000-4000-8000-000000000011','aktif');
INSERT INTO results VALUES('approve',public.process_data_deletion('00000000-0000-4000-8000-000000000002','jenis_pengeluaran','00000000-0000-4000-8000-000000000020','Fixture reason'));
SELECT pg_temp.ok((SELECT (value->>'pending')::boolean FROM results WHERE name='approve')
 AND EXISTS(SELECT 1 FROM public.jenis_pengeluaran WHERE id='00000000-0000-4000-8000-000000000020'),'queue preserves source');
SELECT pg_temp.denied(format('SELECT public.review_data_deletion(%L,%L,true,%L)',
 '00000000-0000-4000-8000-000000000002',(SELECT value->>'request_id' FROM results WHERE name='approve'),'Fixture note'),
 'Hanya admin','finance cannot approve');
SELECT pg_temp.ok((public.review_data_deletion('00000000-0000-4000-8000-000000000001',
 (SELECT (value->>'request_id')::uuid FROM results WHERE name='approve'),true,'Approved after review')->>'status')='approved',
 'admin approves');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM public.jenis_pengeluaran WHERE id='00000000-0000-4000-8000-000000000020')
 AND EXISTS(SELECT 1 FROM public.data_deletion_requests WHERE snapshot->'record'->>'nama'='Approve me' AND status='approved'),
 'approved delete retains snapshot');
SELECT pg_temp.denied(format('SELECT public.review_data_deletion(%L,%L,true,%L)',
 '00000000-0000-4000-8000-000000000001',(SELECT value->>'request_id' FROM results WHERE name='approve'),'Repeat note'),
 'sudah diputuskan','approval is single use');
INSERT INTO results VALUES('reject',public.process_data_deletion('00000000-0000-4000-8000-000000000002','jenis_pengeluaran','00000000-0000-4000-8000-000000000021','Fixture reason'));
SELECT public.review_data_deletion('00000000-0000-4000-8000-000000000001',(SELECT (value->>'request_id')::uuid FROM results WHERE name='reject'),false,'Do not delete');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.jenis_pengeluaran WHERE id='00000000-0000-4000-8000-000000000021'),'rejection preserves source');
INSERT INTO results VALUES('changed',public.process_data_deletion('00000000-0000-4000-8000-000000000002','jenis_pengeluaran','00000000-0000-4000-8000-000000000022','Fixture reason'));
UPDATE public.jenis_pengeluaran SET nama='New name' WHERE id='00000000-0000-4000-8000-000000000022';
SELECT pg_temp.ok((public.review_data_deletion('00000000-0000-4000-8000-000000000001',
 (SELECT (value->>'request_id')::uuid FROM results WHERE name='changed'),true,'Review note')->>'status')='changed'
 AND EXISTS(SELECT 1 FROM public.jenis_pengeluaran WHERE nama='New name'),'stale approval cannot delete changed source');
INSERT INTO results VALUES('duplicate',public.process_data_deletion('00000000-0000-4000-8000-000000000002','jenis_pengeluaran','00000000-0000-4000-8000-000000000023','Fixture reason'));
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000005','jenis_pengeluaran','00000000-0000-4000-8000-000000000023','Another reason')$q$,
 'sudah memiliki pengajuan','one pending request per source across actors');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000002','users_profile','00000000-0000-4000-8000-000000000001','Fixture reason')$q$,
 'tidak mendukung','table allowlist blocks privilege target');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000002','jenis_pengeluaran','00000000-0000-4000-8000-000000000021','x')$q$,
 'Alasan wajib','reason required');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000004','jenis_pengeluaran','00000000-0000-4000-8000-000000000021','Fixture reason')$q$,
 'di luar kewenangan','cashier cannot acquire finance delete access');
SELECT pg_temp.ok((public.process_data_deletion('00000000-0000-4000-8000-000000000003','siswa','00000000-0000-4000-8000-000000000030','Duplicate student')->>'pending')::boolean,
 'TU can request own department');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000003','siswa','00000000-0000-4000-8000-000000000031','Fixture reason')$q$,
 'di luar kewenangan','TU cannot request another department');
INSERT INTO results VALUES('disabled',public.process_data_deletion('00000000-0000-4000-8000-000000000005','jenis_pengeluaran','00000000-0000-4000-8000-000000000024','Fixture reason'));
UPDATE public.users_profile SET aktif=false WHERE id='00000000-0000-4000-8000-000000000005';
SELECT pg_temp.denied(format('SELECT public.review_data_deletion(%L,%L,true,%L)',
 '00000000-0000-4000-8000-000000000001',(SELECT value->>'request_id' FROM results WHERE name='disabled'),'Review note'),
 'Akun tidak aktif','revoked requester cannot execute approval');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.jenis_pengeluaran WHERE id='00000000-0000-4000-8000-000000000024'),'failed approval rolls back');
-- Exercise actual grants/RLS and direct REST equivalent access.
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT SELECT ON public.users_profile TO authenticated;
GRANT SELECT,DELETE,UPDATE ON public.jenis_pengeluaran TO authenticated;
GRANT SELECT,INSERT ON checks TO authenticated;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated',pg_my_temp_schema()::regnamespace); END $$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$DELETE FROM public.jenis_pengeluaran WHERE id='00000000-0000-4000-8000-000000000021'$q$,
 'persetujuan admin','direct REST DELETE cannot bypass workflow');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000001','jenis_pengeluaran','00000000-0000-4000-8000-000000000021','Spoof admin')$q$,
 'permission denied','client cannot spoof actor using service RPC');
SELECT pg_temp.denied($q$UPDATE public.data_deletion_requests SET status='approved'$q$,
 'permission denied','request decisions immutable from REST');
SELECT pg_temp.ok((SELECT count(*)>0 AND bool_and(requested_by='00000000-0000-4000-8000-000000000002'::uuid) FROM public.data_deletion_requests),'RLS requester sees only own requests');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.denied($q$SELECT public.batalkan_tagihan_atomik('00000000-0000-4000-8000-000000000090','batal','Fixture reason',current_date,'00000000-0000-4000-8000-000000000002',null)$q$,
 'Hanya admin','old bill RPC rejects non-admin actor');
SELECT pg_temp.denied($q$SELECT public.batalkan_pembayaran_dengan_kuitansi_atomik('00000000-0000-4000-8000-000000000090','Fixture reason',current_date,'00000000-0000-4000-8000-000000000002')$q$,
 'Hanya admin','old receipt RPC rejects non-admin actor');
INSERT INTO public.pegawai(id,nama,departemen_id) VALUES
 ('00000000-0000-4000-8000-000000002002','Finance employee','00000000-0000-4000-8000-000000000010'),
 ('00000000-0000-4000-8000-000000002001','Admin employee','00000000-0000-4000-8000-000000000010');
UPDATE public.users_profile SET pegawai_id='00000000-0000-4000-8000-000000002002' WHERE id='00000000-0000-4000-8000-000000000002';
UPDATE public.users_profile SET pegawai_id='00000000-0000-4000-8000-000000002001' WHERE id='00000000-0000-4000-8000-000000000001';
INSERT INTO public.jurnal(id,tanggal,keterangan,status,dibuat_oleh) VALUES
 ('00000000-0000-4000-8000-000000000040',current_date,'Own draft','draft','00000000-0000-4000-8000-000000002002'),
 ('00000000-0000-4000-8000-000000000041',current_date,'Posted journal','posted','00000000-0000-4000-8000-000000002002');
INSERT INTO results VALUES('own_draft',public.process_data_deletion('00000000-0000-4000-8000-000000000002','jurnal','00000000-0000-4000-8000-000000000040','Unused own draft'));
SELECT pg_temp.ok(NOT (SELECT (value->>'pending')::boolean FROM results WHERE name='own_draft')
 AND NOT EXISTS(SELECT 1 FROM public.jurnal WHERE id='00000000-0000-4000-8000-000000000040'),'own unprocessed draft may delete directly');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000001','jurnal','00000000-0000-4000-8000-000000000041','Posted is immutable')$q$,
 'jurnal pembalik','posted journal cannot hard delete');
INSERT INTO public.tahun_buku(id,nama,tanggal_mulai,tanggal_selesai) VALUES
 ('00000000-0000-4000-8000-000000000050','Fixture 2026','2026-01-01','2026-12-31');
INSERT INTO public.jenis_pembayaran(id,nama,tipe,departemen_id) VALUES
 ('00000000-0000-4000-8000-000000000060','Fixture registration','sekali','00000000-0000-4000-8000-000000000010');
INSERT INTO public.tagihan(id,siswa_id,jenis_id,tahun_ajaran_id,nominal,status,jatuh_tempo) VALUES
 ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000050',100000,'terjadwal','2026-12-30');
INSERT INTO results VALUES('bill',public.process_data_deletion('00000000-0000-4000-8000-000000000002','tagihan','00000000-0000-4000-8000-000000000070','Wrong bill amount','cancel_bill','{"tanggal":"2026-10-21"}'));
SELECT pg_temp.ok((SELECT status='terjadwal' FROM public.tagihan WHERE id='00000000-0000-4000-8000-000000000070'),'pending bill leaves amount and status unchanged');
INSERT INTO results VALUES('bill_result',public.review_data_deletion('00000000-0000-4000-8000-000000000001',(SELECT (value->>'request_id')::uuid FROM results WHERE name='bill'),true,'Bill reviewed'));
SELECT pg_temp.ok((SELECT value->>'status' FROM results WHERE name='bill_result')='approved'
 AND (SELECT status='dibatalkan' FROM public.tagihan WHERE id='00000000-0000-4000-8000-000000000070'),'approval uses real atomic bill cancellation');
INSERT INTO public.pembayaran(id,siswa_id,jenis_id,jumlah,tanggal_bayar,tahun_ajaran_id) VALUES
 ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000060',100000,'2026-10-21','00000000-0000-4000-8000-000000000050');
INSERT INTO results VALUES('payment',public.process_data_deletion('00000000-0000-4000-8000-000000000002','pembayaran','00000000-0000-4000-8000-000000000080','Wrong receipt entry','cancel_payment','{"tanggal":"2026-10-21"}'));
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.pembayaran WHERE id='00000000-0000-4000-8000-000000000080'),'pending payment preserves receipt');
INSERT INTO results VALUES('payment_result',public.review_data_deletion('00000000-0000-4000-8000-000000000001',(SELECT (value->>'request_id')::uuid FROM results WHERE name='payment'),true,'Receipt reviewed'));
SELECT pg_temp.ok((SELECT value->>'status' FROM results WHERE name='payment_result')='approved'
 AND NOT EXISTS(SELECT 1 FROM public.pembayaran WHERE id='00000000-0000-4000-8000-000000000080'),'approval uses real payment cancellation');
-- A paid bill cannot be removed through the generic deletion endpoint.
UPDATE public.tagihan SET status='lunas' WHERE id='00000000-0000-4000-8000-000000000070';
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000002','tagihan','00000000-0000-4000-8000-000000000070','Wrong paid bill','cancel_bill')$q$,
 'sudah dibayar','paid bill cannot be queued for cancellation');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000001','pembayaran','00000000-0000-4000-8000-000000000090','Generic deletion','delete')$q$,
 'Tindakan tidak valid','payments require the reversal action');
-- Cancellation and its reversal journal remain atomic; employee IDs differ from user IDs.
INSERT INTO public.akun_rekening(id,kode,nama,jenis,saldo_normal) VALUES
 ('00000000-0000-4000-8000-000000000101','5101','Fixture expense','beban','D'),
 ('00000000-0000-4000-8000-000000000102','1101','Fixture bank','aset','D');
INSERT INTO public.jurnal(id,nomor,tanggal,keterangan,status,total_debit,total_kredit) VALUES
 ('00000000-0000-4000-8000-000000000103','JU-FIXTURE-1','2026-10-21','Expense original','posted',250000,250000);
INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,urutan) VALUES
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000101',250000,0,1),
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000102',0,250000,2);
INSERT INTO public.pengeluaran(id,tanggal,jumlah,keterangan,jurnal_id,departemen_id) VALUES
 ('00000000-0000-4000-8000-000000000104','2026-10-21',250000,'Wrong expense','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010');
INSERT INTO results VALUES('expense',public.process_data_deletion('00000000-0000-4000-8000-000000000002','pengeluaran','00000000-0000-4000-8000-000000000104','Wrong expense entry'));
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.jurnal WHERE jurnal_asal_id='00000000-0000-4000-8000-000000000103') IS FALSE,
 'queue creates no reversal');
INSERT INTO results VALUES('expense_result',public.review_data_deletion('00000000-0000-4000-8000-000000000001',
 (SELECT (value->>'request_id')::uuid FROM results WHERE name='expense'),true,'Expense checked'));
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM public.pengeluaran WHERE id='00000000-0000-4000-8000-000000000104')
 AND EXISTS(SELECT 1 FROM public.jurnal WHERE jurnal_asal_id='00000000-0000-4000-8000-000000000103'
 AND dibuat_oleh='00000000-0000-4000-8000-000000002001' AND tipe='pembalik'),
 'expense approval reverses journal under the admin employee');
SELECT pg_temp.ok((SELECT count(*)=2 AND sum(debit)=250000 AND sum(kredit)=250000
 FROM public.jurnal_detail WHERE jurnal_id=(SELECT (value->'result'->>'jurnal_pembalik_id')::uuid FROM results WHERE name='expense_result')),
 'expense reversal lines remain balanced');
-- Source accounting cannot change unnoticed while approval waits.
INSERT INTO public.pengeluaran(id,tanggal,jumlah,keterangan,jurnal_id,departemen_id) VALUES
 ('00000000-0000-4000-8000-000000000105','2026-10-21',250000,'Changed journal','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010');
INSERT INTO results VALUES('related',public.process_data_deletion('00000000-0000-4000-8000-000000000002','pengeluaran','00000000-0000-4000-8000-000000000105','Wrong expense entry'));
UPDATE public.jurnal_detail SET keterangan='Changed since request' WHERE jurnal_id='00000000-0000-4000-8000-000000000103';
INSERT INTO results VALUES('related_result',public.review_data_deletion('00000000-0000-4000-8000-000000000001',
 (SELECT (value->>'request_id')::uuid FROM results WHERE name='related'),true,'Rechecked expense'));
SELECT pg_temp.ok((SELECT value->>'status'='changed' FROM results WHERE name='related_result')
 AND EXISTS(SELECT 1 FROM public.pengeluaran WHERE id='00000000-0000-4000-8000-000000000105'),
 'changed journal detail invalidates approval');
UPDATE public.tahun_buku SET ditutup=true WHERE id='00000000-0000-4000-8000-000000000050';
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000001','pengeluaran','00000000-0000-4000-8000-000000000105','Closed period')$q$,
 'ditutup buku','closed financial period cannot be mutated');
UPDATE public.tahun_buku SET ditutup=false WHERE id='00000000-0000-4000-8000-000000000050';
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.queue_bill_deletion_batch('00000000-0000-4000-8000-000000000002',
 ARRAY['00000000-0000-4000-8000-000000000099'::uuid,'00000000-0000-4000-8000-000000000099'::uuid],'Batch test reason','2026-10-21') WHERE NOT berhasil),
 'batch deduplicates IDs and returns per-item failure without a mutation');

-- Department scoping follows the class for schedules (jadwal has no department_id).
INSERT INTO public.kelas(id,nama,departemen_id) VALUES
 ('00000000-0000-4000-8000-000000000110','Class A','00000000-0000-4000-8000-000000000010'),
 ('00000000-0000-4000-8000-000000000111','Class B','00000000-0000-4000-8000-000000000011');
INSERT INTO public.jadwal(id,kelas_id,hari,jam_mulai,jam_selesai) VALUES
 ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000110','Senin','07:00','08:00'),
 ('00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000111','Selasa','07:00','08:00');
SELECT pg_temp.ok((public.process_data_deletion('00000000-0000-4000-8000-000000000003','jadwal','00000000-0000-4000-8000-000000000112','Wrong schedule')->>'pending')::boolean,
 'TU can request a schedule in an owned class');
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000003','jadwal','00000000-0000-4000-8000-000000000113','Wrong schedule')$q$,
 'di luar kewenangan','TU cannot request a schedule in another department');
INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-000000000006','deletion-teacher@test.invalid');
INSERT INTO public.users_profile(id,email,role,aktif) VALUES
 ('00000000-0000-4000-8000-000000000006','deletion-teacher@test.invalid','guru',true)
 ON CONFLICT(id) DO UPDATE SET role='guru',aktif=true;
INSERT INTO public.kompetensi_dasar(id,kode_kd,deskripsi) VALUES
 ('00000000-0000-4000-8000-000000000114','TEST-KD','Teacher fixture');
SELECT pg_temp.ok((public.process_data_deletion('00000000-0000-4000-8000-000000000006','kompetensi_dasar','00000000-0000-4000-8000-000000000114','Wrong competency')->>'pending')::boolean,
 'teacher competency deletion becomes a request without losing access');
INSERT INTO public.siswa_detail(siswa_id,status_asrama) VALUES
 ('00000000-0000-4000-8000-000000000030','non_asrama');
GRANT SELECT,DELETE ON public.siswa_detail TO authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$DELETE FROM public.siswa_detail WHERE siswa_id='00000000-0000-4000-8000-000000000030'$q$,
 'persetujuan admin','SPMB detail DELETE cannot bypass parent approval');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.denied($q$SELECT public.process_data_deletion('00000000-0000-4000-8000-000000000002','tagihan','00000000-0000-4000-8000-000000000070','Invalid amount','correct_bill','{"nominal_baru":"NaN"}')$q$,
 'Nominal baru','non-finite correction amounts rejected');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM public.audit_keuangan
 WHERE tabel_sumber='pengeluaran' AND record_id='00000000-0000-4000-8000-000000000104'
 AND dibuat_oleh='00000000-0000-4000-8000-000000000001' AND data_lama->>'jumlah' IS NOT NULL),
 'expense approval preserves the established finance audit');

SELECT count(*) AS passed_checks FROM checks;
ROLLBACK;
