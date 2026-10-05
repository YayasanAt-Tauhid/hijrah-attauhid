-- Fixture lokal saja, tidak boleh dijalankan ke Supabase produksi.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT LIKE 'hijrah_spp_test_boarding_%' THEN
  RAISE EXCEPTION 'Tes hanya boleh berjalan di fixture SPP asrama lokal';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
 SELECT current_setting('test.today')::date::timestamp AT TIME ZONE 'Asia/Jakarta'
$$;
DO $clock$ DECLARE r record; BEGIN
 FOR r IN SELECT pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN
   ('proses_pembayaran_atomik','proses_pembayaran_midtrans_atomik','generate_tagihan_batch','posting_spp_tagihan_atomik',
    'akui_pendapatan_dimuka_atomik','batalkan_pembayaran_atomik')
 LOOP EXECUTE replace(replace(r.def,'now()','public.fixture_now()'),'CURRENT_DATE',$date$(public.fixture_now() AT TIME ZONE 'Asia/Jakarta')::date$date$); END LOOP;
END; $clock$;
INSERT INTO public.akun_rekening(kode,nama,jenis,saldo_normal,aktif) VALUES
 ('2111','PD SPP','liabilitas','K',true),('4101','SPP Umum','pendapatan','K',true),
 ('4102','SPP Asrama','pendapatan','K',true),('4103','SPP Non Asrama','pendapatan','K',true);
INSERT INTO public.departemen(kode,kategori) VALUES
 ('SMP','unit_pendidikan'),('SMA','unit_pendidikan'),('MTA','unit_pendidikan'),('SD','unit_pendidikan');
INSERT INTO public.jenis_pembayaran(nama,tipe,nominal,hari_jatuh_tempo,perlu_dimuka,akun_dimuka_id,akun_pendapatan_id,departemen_id)
 SELECT 'SPP '||d.kode,'bulanan',450000,10,true,a.id,b.id,d.id FROM departemen d,akun_rekening a,akun_rekening b
 WHERE a.kode='2111' AND b.kode='4101';
CREATE UNIQUE INDEX fixture_single_spp ON public.jenis_pembayaran(departemen_id)
 WHERE aktif=true AND tipe='bulanan' AND lower(btrim(nama)) ~ '^spp([[:space:]-]|$)';
INSERT INTO public.siswa(id,nama,departemen_id)
 SELECT ('00000000-0000-0000-0000-'||lpad((100+n)::text,12,'0'))::uuid,'Siswa Asrama Uji '||n,d.id
 FROM generate_series(1,8) n JOIN departemen d ON d.kode=CASE WHEN n=6 THEN 'SD' WHEN n=7 THEN 'SMA' WHEN n=8 THEN 'MTA' ELSE 'SMP' END;
INSERT INTO siswa_detail(siswa_id,status_asrama)
 SELECT id,CASE WHEN nama LIKE '%2' THEN 'non_asrama' WHEN nama LIKE '%3' THEN NULL ELSE 'asrama' END
 FROM siswa WHERE nama LIKE 'Siswa Asrama Uji%';
DO $test$
DECLARE
 book uuid:='00000000-0000-0000-0000-000000002027';
 s uuid; j uuid; t public.tagihan; t2 public.tagihan; g record; r jsonb;
 kas uuid; bank uuid; rev uuid; asrama uuid; non_asrama uuid; piutang uuid;
 payment uuid; pd uuid; item uuid; cnt integer; failed boolean; balance_before numeric;
BEGIN
 SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
 SELECT id INTO bank FROM akun_rekening WHERE kode='1102';
 SELECT id INTO piutang FROM akun_rekening WHERE kode='1300';
 SELECT id INTO rev FROM akun_rekening WHERE kode='4101';
 SELECT id INTO asrama FROM akun_rekening WHERE kode='4102';
 SELECT id INTO non_asrama FROM akun_rekening WHERE kode='4103';
 PERFORM set_config('test.today','2027-03-02',true);
 FOR s IN SELECT id FROM siswa WHERE nama LIKE 'Siswa Asrama Uji%' LOOP
  SELECT jp.id INTO j FROM jenis_pembayaran jp JOIN siswa st ON st.departemen_id=jp.departemen_id WHERE st.id=s;
  SELECT * INTO g FROM generate_tagihan_batch(j,book,3,NULL,jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',NULL)),NULL);
  ASSERT g.generated=1 AND cardinality(g.errors)=0, array_to_string(g.errors,',');
 END LOOP;
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000101' AND bulan=3;
 ASSERT t.spp_kategori='asrama' AND t.spp_akun_pendapatan_id=asrama;
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=t.jurnal_piutang_id AND akun_id=asrama)=450000;
 SELECT * INTO t2 FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000102' AND bulan=3;
 ASSERT t2.spp_kategori='non_asrama' AND t2.spp_akun_pendapatan_id=non_asrama;
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=t2.jurnal_piutang_id AND akun_id=non_asrama)=450000;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000103')='belum_terverifikasi';
 ASSERT (SELECT spp_akun_pendapatan_id FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000103')=rev;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000106')='umum';
 ASSERT (SELECT count(*) FROM tagihan WHERE siswa_id IN ('00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-000000000108') AND spp_akun_pendapatan_id=asrama)=2;
 RAISE NOTICE 'PASS 1: SMP/SMA/MTA dipetakan 4102/4103, SD umum, status kosong terpisah';

 UPDATE siswa_detail SET status_asrama='non_asrama' WHERE siswa_id=t.siswa_id;
 r:=proses_pembayaran_atomik(t.siswa_id,t.jenis_id,3,100000,'2027-03-02','Cicilan',NULL,book,false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP SMP');
 payment:=(r->>'pembayaran_id')::uuid;
 ASSERT (SELECT spp_kategori FROM pembayaran WHERE id=payment)='asrama';
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=piutang)=100000;
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=t.jurnal_piutang_id AND akun_id=asrama)=450000;
 RAISE NOTICE 'PASS 2: perubahan status tidak mengubah histori, cicilan melunasi piutang';

 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item,tagihan_id)
 VALUES(gen_random_uuid(),t2.siswa_id,t2.jenis_id,3,100000,'SPP SMP',t2.id) RETURNING id INTO item;
 r:=proses_pembayaran_midtrans_atomik(item,t2.siswa_id,t2.jenis_id,3,100000,'2027-03-02',NULL,book,'TEST-ASRAMA','qris',bank,rev,'SPP SMP');
 ASSERT (SELECT spp_kategori FROM pembayaran WHERE id=(r->>'pembayaran_id')::uuid)='non_asrama';
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=piutang)=100000;
 RAISE NOTICE 'PASS 3: pembayaran online menyimpan kategori tagihan dan tidak menggandakan pendapatan';

 -- Tagihan baru setelah pindah status mempunyai kategori baru; yang lama tetap.
 SELECT * INTO g FROM generate_tagihan_batch(t.jenis_id,book,4,NULL,jsonb_build_array(jsonb_build_object('siswa_id',t.siswa_id,'kelas_id',NULL)),NULL);
 ASSERT g.generated=1 AND cardinality(g.errors)=0;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id=t.siswa_id AND bulan=4)='non_asrama';
 ASSERT (SELECT spp_kategori FROM tagihan WHERE id=t.id)='asrama';
 RAISE NOTICE 'PASS 4: kategori berubah hanya pada tagihan baru';

 -- Pembayaran di muka tetap kewajiban, kemudian diakui ke snapshot saat dibuat.
 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000104' AND bulan=3;
 SELECT * INTO g FROM generate_tagihan_batch(t.jenis_id,book,5,NULL,jsonb_build_array(jsonb_build_object('siswa_id',t.siswa_id,'kelas_id',NULL)),NULL);
 ASSERT g.generated=1 AND g.scheduled=1 AND cardinality(g.errors)=0;
 SELECT * INTO t FROM tagihan WHERE siswa_id=t.siswa_id AND bulan=5;
 r:=proses_pembayaran_atomik(t.siswa_id,t.jenis_id,5,450000,'2027-03-02','Dimuka',NULL,book,false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP SMP');
 payment:=(r->>'pembayaran_id')::uuid;
 SELECT id INTO pd FROM pendapatan_dimuka WHERE pembayaran_id=payment;
 ASSERT pd IS NOT NULL AND (r->>'diterima_dimuka')::boolean;
 ASSERT (SELECT spp_kategori FROM pembayaran WHERE id=payment)='asrama';
 UPDATE siswa_detail SET status_asrama='non_asrama' WHERE siswa_id=t.siswa_id;
 PERFORM set_config('test.today','2027-05-01',true);
 r:=akui_pendapatan_dimuka_atomik(pd,NULL);
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=asrama)=450000;
 RAISE NOTICE 'PASS 5: pengakuan uang muka tetap ke akun snapshot meskipun siswa pindah status';
 r:=batalkan_pembayaran_atomik(payment,'Uji pembatalan','2027-05-02',NULL);
 ASSERT (SELECT status FROM tagihan WHERE id=t.id)='belum_bayar';
 ASSERT (SELECT sum(kredit-debit) FROM jurnal_detail WHERE akun_id=asrama)=6*450000;
 RAISE NOTICE 'PASS 6: pembatalan setelah pengakuan memulihkan piutang di akun snapshot';

 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000108' AND bulan=3;
 PERFORM set_config('test.today','2027-03-02',true);
 SELECT * INTO g FROM generate_tagihan_batch(t.jenis_id,book,4,NULL,jsonb_build_array(jsonb_build_object('siswa_id',t.siswa_id,'kelas_id',NULL)),NULL);
 SELECT * INTO t FROM tagihan WHERE siswa_id=t.siswa_id AND bulan=4;
 r:=proses_pembayaran_atomik(t.siswa_id,t.jenis_id,4,450000,'2027-03-02','PD pending',NULL,book,false,t.id,kas,rev,'Pendapatan','JP',NULL,'SPP MTA');
 payment:=(r->>'pembayaran_id')::uuid;
 PERFORM set_config('test.today','2027-04-01',true);
 PERFORM posting_spp_tagihan_atomik(t.id,NULL);
 SELECT sum(kredit-debit) INTO balance_before FROM jurnal_detail WHERE akun_id=asrama;
 ASSERT (SELECT status FROM pendapatan_dimuka WHERE pembayaran_id=payment)='pending';
 PERFORM batalkan_pembayaran_atomik(payment,'Uji celah PD pending','2027-04-02',NULL);
 ASSERT (SELECT sum(kredit-debit) FROM jurnal_detail WHERE akun_id=asrama)=balance_before+450000;
 ASSERT (SELECT status FROM tagihan WHERE id=t.id)='belum_bayar';
 RAISE NOTICE 'PASS 6A: pembatalan PD pending setelah layanan diakui memulihkan piutang ke 4102';

 SELECT * INTO t FROM tagihan WHERE siswa_id='00000000-0000-0000-0000-000000000105' AND bulan=3;
 r:=batalkan_tagihan_atomik(t.id,'koreksi_nominal','Uji koreksi','2027-05-02',NULL,400000);
 ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_baru_id')::uuid AND akun_id=asrama)=400000;
 RAISE NOTICE 'PASS 7: koreksi nominal mempertahankan akun pendapatan kategori lama';

 failed:=false;
 BEGIN UPDATE tagihan SET spp_kategori='non_asrama' WHERE id=t.id;
 EXCEPTION WHEN OTHERS THEN failed:=true; END; ASSERT failed;
 failed:=false;
 BEGIN UPDATE pembayaran SET spp_kategori='asrama' WHERE id=(SELECT pembayaran_id FROM transaksi_midtrans_item WHERE id=item);
 EXCEPTION WHEN OTHERS THEN failed:=true; END; ASSERT failed;
 ASSERT NOT has_function_privilege('anon','public.snapshot_spp_siswa(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.akun_pendapatan_tagihan(uuid)','EXECUTE');
 RAISE NOTICE 'PASS 8: snapshot tidak dapat diedit dan helper tidak terbuka bagi browser';

 failed:=false;
 BEGIN INSERT INTO jenis_pembayaran(nama,tipe,departemen_id) SELECT 'SPP SMP ASRAMA','bulanan',id FROM departemen WHERE kode='SMP';
 EXCEPTION WHEN unique_violation THEN failed:=true; END; ASSERT failed;
 RAISE NOTICE 'PASS 9: satu master SPP per lembaga tetap berlaku';
END;
$test$;
ROLLBACK;
