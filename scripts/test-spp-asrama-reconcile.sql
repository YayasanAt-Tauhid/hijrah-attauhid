BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'hijrah_spp_test_boarding_%' THEN
  RAISE EXCEPTION 'Tes hanya boleh berjalan pada fixture asrama';
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS migration;
CREATE TABLE migration.legacy_tagihan_snapshot(
 source_key text PRIMARY KEY,snapshot_date date,siswa_id uuid,source_name text,
 period_month date,category text,gross numeric,discount numeric,remaining numeric,
 source_ordinal integer,target_tagihan_id uuid,disposition text,imported_at timestamptz
);
ALTER TABLE public.siswa_detail ADD COLUMN pmb_payment_token text;
INSERT INTO public.departemen(kode,kategori) VALUES ('SMP','unit_pendidikan');
INSERT INTO public.akun_rekening(kode,nama,jenis,saldo_normal,aktif) VALUES
 ('4101','SPP Umum','pendapatan','K',true),('4102','SPP Asrama','pendapatan','K',true),('4103','SPP Non Asrama','pendapatan','K',true);
INSERT INTO siswa(id,nama,status,departemen_id)
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Siswa Rekonsiliasi '||n,'aktif',d.id
 FROM generate_series(1000,1346) n CROSS JOIN departemen d WHERE d.kode='SMP';
INSERT INTO siswa_detail(siswa_id,status_asrama)
 SELECT id,CASE WHEN nama='Siswa Rekonsiliasi 1346' THEN 'non_asrama' END
 FROM siswa WHERE nama LIKE 'Siswa Rekonsiliasi%';
INSERT INTO migration.legacy_tagihan_snapshot(source_key,snapshot_date,siswa_id,source_name,period_month,category,gross,discount,remaining)
 SELECT 'fixture-source-'||n,'2026-09-27',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
   CASE WHEN n%2=0 THEN 'SPP SMPITA ASRAMA' ELSE 'SPP SMPITA NON ASRAMA' END,
   '2026-11-01','terjadwal',450000,0,450000 FROM generate_series(1000,1344) n;
INSERT INTO migration.legacy_tagihan_snapshot(source_key,snapshot_date,siswa_id,source_name,period_month)
 VALUES('fixture-conflict','2026-09-27','00000000-0000-0000-0000-000000001346','SPP SMPITA ASRAMA','2026-11-01');
INSERT INTO jenis_pembayaran(nama,tipe,nominal,departemen_id,akun_pendapatan_id)
 SELECT 'SPP SMP','bulanan',0,d.id,a.id FROM departemen d,akun_rekening a WHERE d.kode='SMP' AND a.kode='4101';
INSERT INTO jurnal(nomor,tanggal,keterangan,total_debit,total_kredit,status)
 VALUES('FIXTURE-JPI','2026-09-28','Jurnal fixture rekonsiliasi',450000,450000,'posted');
INSERT INTO jurnal_detail(jurnal_id,akun_id,debit,kredit)
 SELECT j.id,a.id,0,450000 FROM jurnal j,akun_rekening a WHERE j.nomor='FIXTURE-JPI' AND a.kode='4101';
INSERT INTO jurnal_detail(jurnal_id,akun_id,debit,kredit)
 SELECT j.id,a.id,450000,0 FROM jurnal j,akun_rekening a WHERE j.nomor='FIXTURE-JPI' AND a.kode='1300';
-- Simulasikan data yang sudah ada sebelum penambahan trigger snapshot.
ALTER TABLE tagihan DISABLE TRIGGER trg_snapshot_spp_tagihan;
INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,legacy_source_key,jurnal_piutang_id)
 SELECT '00000000-0000-0000-0000-000000001000',jp.id,'00000000-0000-0000-0000-000000002026',11,450000,'belum_bayar','2026-11-10','fixture-source-1000',j.id
 FROM jenis_pembayaran jp,jurnal j WHERE jp.nama='SPP SMP' AND j.nomor='FIXTURE-JPI';
INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo)
 SELECT '00000000-0000-0000-0000-000000001001',jp.id,'00000000-0000-0000-0000-000000002026',11,450000,'terjadwal','2026-11-10'
 FROM jenis_pembayaran jp WHERE jp.nama='SPP SMP';
INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo)
 SELECT '00000000-0000-0000-0000-000000001345',jp.id,'00000000-0000-0000-0000-000000002026',8,450000,'belum_bayar','2026-08-10'
 FROM jenis_pembayaran jp WHERE jp.nama='SPP SMP';
ALTER TABLE tagihan ENABLE TRIGGER trg_snapshot_spp_tagihan;
ALTER TABLE pembayaran DISABLE TRIGGER trg_snapshot_spp_pembayaran;
INSERT INTO pembayaran(siswa_id,jenis_id,tahun_ajaran_id,bulan,jumlah,tanggal_bayar,tagihan_id)
 SELECT t.siswa_id,t.jenis_id,t.tahun_ajaran_id,t.bulan,100000,'2026-10-01',t.id FROM tagihan t
 WHERE t.siswa_id='00000000-0000-0000-0000-000000001000';
ALTER TABLE pembayaran ENABLE TRIGGER trg_snapshot_spp_pembayaran;
CREATE TEMP TABLE fixture_finance_baseline AS SELECT
 (SELECT sum(nominal) FROM tagihan) AS tagihan,
 (SELECT sum(jumlah) FROM pembayaran) AS pembayaran,
 (SELECT count(*) FROM jurnal) AS jurnal,
 (SELECT sum(kredit-debit) FROM jurnal_detail WHERE akun_id=(SELECT id FROM akun_rekening WHERE kode='4101')) AS akun_4101;

\ir ../supabase/migrations/20261005085418_spp_asrama_reconcile_metadata.sql

DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM siswa_detail WHERE status_asrama IS NOT NULL)=346;
 ASSERT (SELECT status_asrama FROM siswa_detail WHERE siswa_id='00000000-0000-0000-0000-000000001346')='non_asrama';
 ASSERT (SELECT status_asrama FROM siswa_detail WHERE siswa_id='00000000-0000-0000-0000-000000001345') IS NULL;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000001000')='asrama';
 ASSERT (SELECT spp_akun_pendapatan_id FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000001000')=(SELECT id FROM akun_rekening WHERE kode='4101');
 ASSERT (SELECT spp_akun_pendapatan_id FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000001001')=(SELECT id FROM akun_rekening WHERE kode='4103');
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000001345')='belum_terverifikasi';
 ASSERT (SELECT spp_kategori FROM pembayaran WHERE siswa_id='00000000-0000-0000-0000-000000001000')='asrama';
 ASSERT (SELECT tagihan FROM fixture_finance_baseline)=(SELECT sum(nominal) FROM tagihan);
 ASSERT (SELECT pembayaran FROM fixture_finance_baseline)=(SELECT sum(jumlah) FROM pembayaran);
 ASSERT (SELECT jurnal FROM fixture_finance_baseline)=(SELECT count(*) FROM jurnal);
 ASSERT (SELECT akun_4101 FROM fixture_finance_baseline)=(SELECT sum(kredit-debit) FROM jurnal_detail WHERE akun_id=(SELECT id FROM akun_rekening WHERE kode='4101'));
 ASSERT (SELECT count(*) FROM migration.spp_asrama_metadata_audit_20261005)=349;
 ASSERT NOT has_table_privilege('authenticated','migration.spp_asrama_metadata_audit_20261005','SELECT');
 RAISE NOTICE 'PASS: 345 status, histori, jadwal, pembayaran, audit dan saldo finansial tetap';
END; $test$;
ROLLBACK;
