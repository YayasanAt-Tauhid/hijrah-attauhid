-- Hanya fixture Postgres lokal dengan skema/default dan RPC produksi.
-- Clock di bawah hanya mengganti sumber waktu pada RPC fixture, tidak pada produksi.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'hijrah_spp_test_%' THEN
  RAISE EXCEPTION 'Tes hanya boleh berjalan pada database fixture SPP lokal';
 END IF;
END $$;
CREATE FUNCTION public.fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
 SELECT current_setting('test.today')::date::timestamp AT TIME ZONE 'Asia/Jakarta'
$$;
DO $clock$ DECLARE r record; BEGIN
 FOR r IN SELECT pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN
   ('proses_pembayaran_atomik','proses_pembayaran_midtrans_atomik','generate_tagihan_batch','posting_spp_tagihan_atomik','posting_piutang_jatuh_tempo',
    'akui_pendapatan_dimuka_atomik','akui_pendapatan_dimuka_jatuh_tempo','batalkan_pembayaran_atomik')
 LOOP EXECUTE replace(replace(r.def,'now()','public.fixture_now()'),'CURRENT_DATE',$date$(public.fixture_now() AT TIME ZONE 'Asia/Jakarta')::date$date$); END LOOP;
END; $clock$;
INSERT INTO public.akun_rekening(kode,nama,jenis,saldo_normal) VALUES
 ('2111','PD SPP','liabilitas','K'),('4101','PENDAPATAN SPP','pendapatan','K');
INSERT INTO public.jenis_pembayaran(nama,tipe,nominal,hari_jatuh_tempo,perlu_dimuka,akun_dimuka_id,akun_pendapatan_id)
 SELECT 'SPP TK','bulanan',450000,10,true,a.id,b.id FROM akun_rekening a,akun_rekening b
 WHERE a.kode='2111' AND b.kode='4101';
INSERT INTO public.siswa(id,nama)
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Siswa SPP Uji '||n
 FROM generate_series(7,12) n;
CREATE OR REPLACE FUNCTION public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric)
 RETURNS TABLE(nominal_diskon numeric,siswa_diskon_id uuid) LANGUAGE sql AS $$
 SELECT CASE WHEN $1 IN
 ('00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid) THEN 50000
 WHEN $1='00000000-0000-0000-0000-000000000009'::uuid THEN 450000 ELSE 0 END::numeric,NULL::uuid
$$;
DO $test$
DECLARE
 book uuid:='00000000-0000-0000-0000-000000002027';
 j uuid; kas uuid; bank uuid; liab uuid; rev uuid; rec uuid; disc uuid;
 s uuid; t public.tagihan; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
 pd1 uuid; pd2 uuid; pd4 uuid; p2 uuid; p4 uuid; p6 uuid; item uuid;
 r jsonb; g record; cnt integer; rejected boolean; pd public.pendapatan_dimuka; balance_before numeric;
BEGIN
 SELECT id INTO j FROM jenis_pembayaran WHERE nama='SPP TK';
 SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
 SELECT id INTO bank FROM akun_rekening WHERE kode='1102';
 SELECT id INTO liab FROM akun_rekening WHERE kode='2111';
 SELECT id INTO rev FROM akun_rekening WHERE kode='4101';
 SELECT id INTO rec FROM akun_rekening WHERE kode='1300';
 SELECT id INTO disc FROM akun_rekening WHERE kode='4602';
 PERFORM set_config('test.today','2027-01-31',true);
 ASSERT public.hitung_pengakuan_spp(book,2)='2027-02-01';
 ASSERT public.hitung_pengakuan_spp('00000000-0000-0000-0000-000000102027',2)='2028-02-01';
 ASSERT public.hitung_pengakuan_spp(book,NULL) IS NULL;
 ASSERT NOT has_function_privilege('anon','public.posting_spp_tagihan_atomik(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.posting_spp_tagihan_atomik(uuid,uuid)','EXECUTE');
 RAISE NOTICE 'PASS 1: awal bulan, tahun akademik kabisat, dan privilege';

 SELECT * INTO g FROM generate_tagihan_batch(j,book,2,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000001","kelas_id":null}]',NULL);
 ASSERT g.generated=1 AND g.scheduled=1 AND cardinality(g.errors)=0;
 SELECT id INTO t1 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000001' AND jenis_id=j;
 SELECT * INTO t FROM tagihan WHERE id=t1;
 ASSERT t.jatuh_tempo='2027-02-10' AND t.tanggal_pengakuan='2027-02-01' AND t.jurnal_piutang_id IS NULL;
 r:=proses_pembayaran_atomik(t.siswa_id,j,2,450000,'2027-02-05','Kasir',NULL,book,false,t1,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 SELECT id INTO pd1 FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid;
 ASSERT pd1 IS NOT NULL AND (r->>'diterima_dimuka')::boolean;
 ASSERT COALESCE((SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=rev),0)=0;
 RAISE NOTICE 'PASS 2: tanggal 10 tetap, kasir dipaksa kredit kewajiban meski caller meminta pendapatan';

 PERFORM set_config('test.today','2027-01-31',true);
 rejected:=false;
 BEGIN PERFORM akui_pendapatan_dimuka_atomik(pd1,NULL); EXCEPTION WHEN OTHERS THEN
  ASSERT SQLERRM LIKE 'Pendapatan belum dapat diakui%'; rejected:=true; END;
 ASSERT rejected;
 SELECT * INTO g FROM akui_pendapatan_dimuka_jatuh_tempo('2027-03-10',NULL,5000);
 ASSERT g.diakui=0 AND COALESCE((SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=rev),0)=0;
 RAISE NOTICE 'PASS 3: sebelum bulan layanan dan cutoff masa depan tidak mempercepat pengakuan';

 FOR s IN SELECT id FROM siswa WHERE id IN
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006')
 LOOP
  SELECT * INTO g FROM generate_tagihan_batch(j,book,2,NULL,
   jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',NULL)),NULL);
  ASSERT g.generated=1 AND g.scheduled=1 AND cardinality(g.errors)=0;
 END LOOP;
 SELECT id INTO t2 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000002' AND jenis_id=j;
 SELECT id INTO t3 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000003' AND jenis_id=j;
 SELECT id INTO t4 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000004' AND jenis_id=j;
 SELECT id INTO t5 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000005' AND jenis_id=j;
 SELECT id INTO t6 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000006' AND jenis_id=j;
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000002',j,2,100000,'2027-02-10','Cicilan',NULL,book,false,t2,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 p2:=(r->>'pembayaran_id')::uuid; SELECT id INTO pd2 FROM pendapatan_dimuka WHERE pembayaran_id=p2;
 ASSERT (SELECT status FROM tagihan WHERE id=t2)='sebagian';
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000004',j,2,400000,'2027-02-10','Lunas diskon',NULL,book,false,t4,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 p4:=(r->>'pembayaran_id')::uuid; SELECT id INTO pd4 FROM pendapatan_dimuka WHERE pembayaran_id=p4;
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000005',j,2,100000,'2027-02-10','Cicilan1',NULL,book,false,t5,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000005',j,2,200000,'2027-02-15','Cicilan2',NULL,book,false,t5,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000006',j,2,100000,'2027-02-10','Cicilan pending',NULL,book,false,t6,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 p6:=(r->>'pembayaran_id')::uuid;
 ASSERT COALESCE((SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=rev),0)=0;
 RAISE NOTICE 'PASS 4: pembayaran sebelum layanan tetap kewajiban, diskon belum diakui';

 PERFORM set_config('test.today','2027-01-31',true);
 SELECT * INTO g FROM posting_piutang_jatuh_tempo('2027-03-01',NULL,5000);
 ASSERT g.diposting=0;
 PERFORM set_config('test.today','2027-02-01',true);
 r:=akui_pendapatan_dimuka_atomik(pd1,NULL);
 ASSERT (r->>'diakui')::boolean AND (SELECT pengakuan_spp_selesai FROM tagihan WHERE id=t1);
 cnt:=(SELECT count(*) FROM jurnal);
 r:=akui_pendapatan_dimuka_atomik(pd1,NULL);
 ASSERT NOT (r->>'diakui')::boolean AND (SELECT count(*) FROM jurnal)=cnt;
 RAISE NOTICE 'PASS 5: awal bulan mengakui lunas tanpa piutang, pengakuan ulang idempoten';

 r:=akui_pendapatan_dimuka_atomik(pd2,NULL);
 SELECT * INTO t FROM tagihan WHERE id=t2;
 ASSERT t.jurnal_piutang_id IS NOT NULL AND t.status='sebagian';
 ASSERT (SELECT sum(debit-kredit) FROM jurnal_detail WHERE akun_id=rec AND jurnal_id=t.jurnal_piutang_id)=300000;
 ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE akun_id=disc AND jurnal_id=t.jurnal_piutang_id)=50000;
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=rev AND jurnal_id IN
  (t.jurnal_piutang_id,(SELECT jurnal_pengakuan_id FROM pendapatan_dimuka WHERE id=pd2)))=450000;
 RAISE NOTICE 'PASS 6: cicilan + diskon menghasilkan piutang sisa 300rb dan pendapatan bruto 450rb';

 SELECT * INTO g FROM posting_piutang_jatuh_tempo(NULL,NULL,5000);
 ASSERT cardinality(g.errors)=0;
 SELECT * INTO t FROM tagihan WHERE id=t3;
 ASSERT t.status='belum_bayar' AND t.jurnal_piutang_id IS NOT NULL;
 ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=t.jurnal_piutang_id AND akun_id=rec)=450000;
 r:=akui_pendapatan_dimuka_atomik(pd4,NULL);
 ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=(SELECT jurnal_piutang_id FROM tagihan WHERE id=t4) AND akun_id=disc)=50000;
 ASSERT COALESCE((SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=(SELECT jurnal_piutang_id FROM tagihan WHERE id=t4) AND akun_id=rec),0)=0;
 SELECT * INTO g FROM akui_pendapatan_dimuka_jatuh_tempo(NULL,NULL,5000);
 ASSERT cardinality(g.errors)=0;
 ASSERT (SELECT count(*) FROM pendapatan_dimuka advance JOIN pembayaran p ON p.id=advance.pembayaran_id WHERE p.tagihan_id=t5 AND advance.status='diakui')=2;
 RAISE NOTICE 'PASS 7: SPP belum dibayar, lunas diskon, dan dua cicilan masing-masing diakui tepat sekali';

 PERFORM set_config('test.today','2027-03-01',true);
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000002',j,2,300000,'2027-03-01','Pelunasan',NULL,book,true,t2,kas,liab,'Dimuka','JD',NULL,'SPP TK');
 ASSERT NOT (r->>'diterima_dimuka')::boolean;
 ASSERT (SELECT status FROM tagihan WHERE id=t2)='lunas';
 r:=batalkan_pembayaran_atomik(p2,'Uji','2027-03-02',NULL);
 ASSERT (SELECT status FROM tagihan WHERE id=t2)='sebagian';
 ASSERT (SELECT sum(debit-kredit) FROM jurnal_detail WHERE akun_id=rec)=1000000; -- t2=100k,t3=450k,t5=100k,t6=350k
 r:=proses_pembayaran_atomik('00000000-0000-0000-0000-000000000002',j,2,100000,'2027-03-03','Bayar ulang',NULL,book,false,t2,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 ASSERT NOT (r->>'diterima_dimuka')::boolean;
 r:=batalkan_pembayaran_atomik(p4,'Uji','2027-03-03',NULL);
 ASSERT (SELECT jurnal_piutang_id FROM tagihan WHERE id=t4) IS NOT NULL;
 ASSERT (SELECT status FROM tagihan WHERE id=t4)='belum_bayar';
 RAISE NOTICE 'PASS 8: pelunasan setelah pengakuan kredit piutang, pembatalan memulihkan piutang tanpa menghapus pendapatan layanan';

 -- Midtrans lintas tahun: tagihan Januari 2028, kas Desember 2027.
 INSERT INTO tahun_buku(nama,tanggal_mulai,tanggal_selesai) VALUES('Tahun 2028','2028-01-01','2028-12-31') RETURNING id INTO s;
 PERFORM set_config('test.today','2027-12-01',true);
 SELECT * INTO g FROM generate_tagihan_batch(j,s,1,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000007","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000007' AND jenis_id=j;
 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item,tagihan_id)
 VALUES(gen_random_uuid(),t.siswa_id,j,1,450000,'SPP Jan 2028',t.id) RETURNING id INTO item;
 r:=proses_pembayaran_midtrans_atomik(item,t.siswa_id,j,1,450000,'2027-12-15',NULL,s,'TEST-SPP-2027','qris',bank,rev,'SPP TK');
 ASSERT (r->>'diterima_dimuka')::boolean;
 SELECT * INTO pd FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid;
 ASSERT pd.tahun_ajaran_pembayaran_id=book AND pd.tahun_ajaran_target_id=s;
 ASSERT (SELECT tanggal FROM jurnal WHERE id=(r->>'jurnal_id')::uuid)='2027-12-15';
 PERFORM set_config('test.today','2027-12-31',true);
 rejected:=false; BEGIN PERFORM akui_pendapatan_dimuka_atomik(pd.id,NULL);
 EXCEPTION WHEN OTHERS THEN rejected:=true; END; ASSERT rejected;
 PERFORM set_config('test.today','2028-01-01',true);
 PERFORM akui_pendapatan_dimuka_atomik(pd.id,NULL);
 RAISE NOTICE 'PASS 9: Midtrans lintas tahun tetap kas 2027, target 2028 dan pengakuan 1 Januari';

 -- Saldo piutang lama yang telah terbit tidak direklasifikasi.
 PERFORM set_config('test.today','2027-02-10',true);
 SELECT * INTO g FROM generate_tagihan_batch(j,book,1,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000008","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000008' AND jenis_id=j;
 ASSERT t.jurnal_piutang_id IS NOT NULL AND t.pengakuan_spp_selesai;
 r:=proses_pembayaran_atomik(t.siswa_id,j,1,100000,'2027-02-10','Piutang lama',NULL,book,true,t.id,kas,liab,'Dimuka','JD',NULL,'SPP TK');
 ASSERT NOT (r->>'diterima_dimuka')::boolean;
 RAISE NOTICE 'PASS 10: piutang yang telah terbit tetap dilunasi sebagai piutang';


 -- Pembatalan setelah akrual sisa piutang tetapi sebelum PD diakui.
 PERFORM set_config('test.today','2027-01-31',true);
 SELECT * INTO g FROM generate_tagihan_batch(j,book,2,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000010","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000010' AND jenis_id=j;
 r:=proses_pembayaran_atomik(t.siswa_id,j,2,100000,'2027-02-10','Pending PD',NULL,book,false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP TK');
 p6:=(r->>'pembayaran_id')::uuid;
 SELECT sum(kredit-debit) INTO balance_before FROM jurnal_detail WHERE akun_id=rev;
 PERFORM set_config('test.today','2027-02-01',true);
 PERFORM posting_spp_tagihan_atomik(t.id,NULL);
 ASSERT (SELECT status FROM pendapatan_dimuka WHERE pembayaran_id=p6)='pending';
 PERFORM batalkan_pembayaran_atomik(p6,'Uji pending','2027-02-28',NULL);
 ASSERT (SELECT sum(kredit-debit) FROM jurnal_detail WHERE akun_id=rev)=balance_before+450000;
 ASSERT (SELECT status FROM tagihan WHERE id=t.id)='belum_bayar';
 ASSERT NOT EXISTS(SELECT 1 FROM pendapatan_dimuka WHERE pembayaran_id=p6);
 RAISE NOTICE 'PASS 12: pembatalan di antara akrual sisa piutang dan pengakuan PD tetap menjaga pendapatan layanan';

 -- Beasiswa penuh tanpa uang masuk.
 PERFORM set_config('test.today','2027-01-31',true);
 SELECT * INTO g FROM generate_tagihan_batch(j,book,2,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000009","kelas_id":null}]',NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000009' AND jenis_id=j;
 ASSERT t.nominal=0 AND t.nominal_diskon=450000 AND t.jurnal_piutang_id IS NULL;
 PERFORM set_config('test.today','2027-02-01',true);
 PERFORM posting_spp_tagihan_atomik(t.id,NULL);
 SELECT * INTO t FROM tagihan WHERE id=t.id;
 ASSERT t.status='lunas' AND t.pengakuan_spp_selesai;
 ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=t.jurnal_piutang_id AND akun_id=disc)=450000;
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=t.jurnal_piutang_id AND akun_id=rev)=450000;
 ASSERT NOT EXISTS(SELECT 1 FROM pembayaran WHERE tagihan_id=t.id);
 RAISE NOTICE 'PASS 13: potongan 100 persen diakui bruto/kontra tanpa penerimaan kas';

 -- Midtrans cicilan sesudah tanggal 10 + fallback lama sebelum tanggal 10.
 PERFORM set_config('test.today','2027-01-31',true);
 FOR s IN SELECT id FROM siswa WHERE id IN
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012')
 LOOP
  SELECT * INTO g FROM generate_tagihan_batch(j,book,2,NULL,
   jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',NULL)),NULL);
 END LOOP;
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000011' AND jenis_id=j;
 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item,tagihan_id)
 VALUES(gen_random_uuid(),t.siswa_id,j,2,100000,'Cicilan SPP',t.id) RETURNING id INTO item;
 r:=proses_pembayaran_midtrans_atomik(item,t.siswa_id,j,2,100000,'2027-02-10',NULL,book,'TEST-CICILAN','qris',bank,rev,'SPP TK');
 ASSERT (r->>'diterima_dimuka')::boolean AND (r->>'sisa_tagihan')::numeric=350000;
 SELECT id INTO pd1 FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid;
 PERFORM set_config('test.today','2027-02-01',true);
 PERFORM akui_pendapatan_dimuka_atomik(pd1,NULL);
 ASSERT (SELECT status FROM tagihan WHERE id=t.id)='sebagian';
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000012' AND jenis_id=j;
 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item)
 VALUES(gen_random_uuid(),t.siswa_id,j,2,100000,'Fallback lama') RETURNING id INTO item;
 cnt:=(SELECT count(*) FROM jurnal); rejected:=false;
 BEGIN
  PERFORM proses_pembayaran_midtrans_atomik(item,t.siswa_id,j,2,100000,'2027-01-31',NULL,book,'TEST-FALLBACK','qris',bank,rev,'SPP TK');
 EXCEPTION WHEN OTHERS THEN
  ASSERT SQLERRM LIKE 'Tagihan yang belum jatuh tempo harus dibayar penuh%'; rejected:=true;
 END;
 ASSERT rejected AND (SELECT count(*) FROM jurnal)=cnt;
 RAISE NOTICE 'PASS 14: Midtrans cicilan tetap dimuka, fallback lama menolak cicilan sebelum jatuh tempo';

 -- Data penerimaan historis yang tidak punya jurnal tidak boleh menghasilkan JPI/pengakuan.
 INSERT INTO pembayaran(siswa_id,jenis_id,tahun_ajaran_id,bulan,jumlah,tanggal_bayar,tagihan_id)
 VALUES(t.siswa_id,j,book,2,450000,'2027-02-05',t.id) RETURNING id INTO p6;
 INSERT INTO pendapatan_dimuka(pembayaran_id,siswa_id,jenis_id,tahun_ajaran_pembayaran_id,tahun_ajaran_target_id,bulan,jumlah,status)
 VALUES(p6,t.siswa_id,j,book,book,2,450000,'pending') RETURNING id INTO pd1;
 cnt:=(SELECT count(*) FROM jurnal); rejected:=false;
 BEGIN PERFORM posting_spp_tagihan_atomik(t.id,NULL);
 EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 ASSERT rejected AND (SELECT count(*) FROM jurnal)=cnt;
 RAISE NOTICE 'PASS 15: penerimaan historis tanpa jurnal diblokir tanpa membuat jurnal';

 -- Tagihan terjadwal yang belum diproses cron: kasir/Midtrans mengakui bulan berjalan atomik.
 PERFORM set_config('test.today','2027-09-30',true);
 SELECT * INTO g FROM generate_tagihan_batch(j,book,10,NULL,
  '[{"siswa_id":"00000000-0000-0000-0000-000000000001","kelas_id":null},{"siswa_id":"00000000-0000-0000-0000-000000000003","kelas_id":null}]',NULL);
 ASSERT g.generated=2 AND g.scheduled=2;
 PERFORM set_config('test.today','2027-10-02',true);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000001' AND jenis_id=j AND bulan=10;
 ASSERT t.tanggal_pengakuan='2027-10-01' AND t.jatuh_tempo='2027-10-10';
 r:=proses_pembayaran_atomik(t.siswa_id,j,10,100000,'2027-10-02','Bulan berjalan',NULL,book,true,t.id,kas,liab,'Dimuka','JD',NULL,'SPP TK');
 ASSERT NOT (r->>'diterima_dimuka')::boolean;
 ASSERT (SELECT pengakuan_spp_selesai FROM tagihan WHERE id=t.id);
 ASSERT NOT EXISTS(SELECT 1 FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid);
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000003' AND jenis_id=j AND bulan=10;
 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item,tagihan_id)
 VALUES(gen_random_uuid(),t.siswa_id,j,10,100000,'SPP Oktober',t.id) RETURNING id INTO item;
 r:=proses_pembayaran_midtrans_atomik(item,t.siswa_id,j,10,100000,'2027-10-02',NULL,book,'TEST-OCTOBER','qris',bank,rev,'SPP TK');
 ASSERT NOT (r->>'diterima_dimuka')::boolean;
 ASSERT (SELECT pengakuan_spp_selesai FROM tagihan WHERE id=t.id);
 RAISE NOTICE 'PASS 16: kasir dan Midtrans tanggal 2 mengakui SPP Oktober tanpa menunggu cron atau tanggal 10';

 -- Seluruh jurnal harus balance, termasuk pembalik dan potongan.
 ASSERT NOT EXISTS (SELECT 1 FROM jurnal_detail GROUP BY jurnal_id HAVING sum(debit)<>sum(kredit));
 ASSERT NOT EXISTS (SELECT 1 FROM jurnal j LEFT JOIN jurnal_detail d ON d.jurnal_id=j.id GROUP BY j.id
  HAVING j.total_debit<>COALESCE(sum(d.debit),0) OR j.total_kredit<>COALESCE(sum(d.kredit),0));
 cnt:=(SELECT count(*) FROM jurnal);
 SELECT * INTO g FROM posting_piutang_jatuh_tempo('2030-01-01',NULL,5000);
 SELECT * INTO g FROM akui_pendapatan_dimuka_jatuh_tempo('2030-01-01',NULL,5000);
 ASSERT (SELECT count(*) FROM jurnal)=cnt;
 RAISE NOTICE 'PASS 11: semua jurnal balance dan proses ulang tidak menggandakan jurnal';
END; $test$;
ROLLBACK;
