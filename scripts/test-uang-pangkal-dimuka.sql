-- Regression finansial. HANYA database fixture lokal; seluruh skenario di-rollback.
-- Fixture: kolom/default produksi, RPC asli; helper tarif/diskon/auth stub terkontrol.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'hijrah_uang_pangkal_test_%' THEN
    RAISE EXCEPTION 'Tes hanya boleh berjalan pada database fixture lokal';
  END IF;
END $$;
DO $test$
DECLARE
  book26 uuid := '00000000-0000-0000-0000-000000002026';
  book27 uuid := '00000000-0000-0000-0000-000000002027';
  academic27 uuid := '00000000-0000-0000-0000-000000102027';
  s1 uuid := '00000000-0000-0000-0000-000000000001';
  s2 uuid := '00000000-0000-0000-0000-000000000002';
  s4 uuid := '00000000-0000-0000-0000-000000000004';
  s5 uuid := '00000000-0000-0000-0000-000000000005';
  s6 uuid := '00000000-0000-0000-0000-000000000006';
  jenis uuid; kas uuid; bank uuid; liability uuid; revenue uuid; receivable uuid;
  g record; t1 tagihan; t2 tagihan; t6 tagihan; p pembayaran; pd pendapatan_dimuka;
  item uuid; r jsonb; result record; count_before integer; rejected boolean;
BEGIN
  SELECT id INTO jenis FROM jenis_pembayaran WHERE nama='UANG PANGKAL TK';
  SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
  SELECT id INTO bank FROM akun_rekening WHERE kode='1102';
  SELECT id INTO liability FROM akun_rekening WHERE kode='2106';
  SELECT id INTO revenue FROM akun_rekening WHERE kode='4307';
  SELECT id INTO receivable FROM akun_rekening WHERE kode='1300';
  ASSERT (SELECT count(*) FROM jenis_pembayaran WHERE nama LIKE 'UANG PANGKAL %' AND perlu_dimuka AND akun_dimuka_id=liability)=5;
  ASSERT NOT (SELECT perlu_dimuka FROM jenis_pembayaran WHERE nama='SALDO UANG PANGKAL LAMA SD');
  ASSERT NOT has_function_privilege('anon','public.akui_pendapatan_dimuka_atomik(uuid,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.akui_pendapatan_dimuka_atomik(uuid,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.akui_pendapatan_dimuka_atomik(uuid,uuid)','EXECUTE');
  RAISE NOTICE 'PASS 1: konfigurasi 5 jenis, legacy tetap, RPC bukan API publik';

  SELECT * INTO g FROM generate_tagihan_batch(jenis,book27,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s1,'kelas_id',null,'tahun_akademik_id',academic27)),null);
  ASSERT g.generated=1 AND g.scheduled=1 AND cardinality(g.errors)=0;
  SELECT * INTO t1 FROM tagihan WHERE siswa_id=s1;
  ASSERT t1.tahun_ajaran_id=book27 AND t1.tahun_akademik_id=academic27;
  ASSERT t1.jatuh_tempo='2027-07-01' AND t1.jurnal_piutang_id IS NULL;
  RAISE NOTICE 'PASS 2: TA 2027/2028 disimpan eksplisit, jatuh tempo Juli bukan Januari';

  r := proses_pembayaran_atomik(s1,jenis,null,4200000,'2026-10-01','Uji',null,
    book26,true,t1.id,kas,liability,'Pendapatan Dimuka','JD',null,'UANG PANGKAL TK');
  SELECT * INTO p FROM pembayaran WHERE id=(r->>'pembayaran_id')::uuid;
  SELECT * INTO pd FROM pendapatan_dimuka WHERE pembayaran_id=p.id;
  ASSERT p.tahun_ajaran_id=book26 AND p.tagihan_id=t1.id AND p.tanggal_bayar='2026-10-01';
  ASSERT (SELECT tanggal FROM jurnal WHERE id=p.jurnal_id)='2026-10-01';
  ASSERT pd.tahun_ajaran_pembayaran_id=book26 AND pd.tahun_ajaran_target_id=book27 AND pd.status='pending';
  ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=liability)=4200000;
  ASSERT COALESCE((SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=revenue),0)=0;
  RAISE NOTICE 'PASS 3: kasir D kas 2026 / K kewajiban, target tetap 2027';

  SELECT * INTO g FROM generate_tagihan_batch(jenis,book27,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s2,'kelas_id',null,'tahun_akademik_id',academic27)),null);
  SELECT * INTO t2 FROM tagihan WHERE siswa_id=s2;
  INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item,tagihan_id)
    VALUES(gen_random_uuid(),s2,jenis,0,4200000,'Uji',t2.id) RETURNING id INTO item;
  r := proses_pembayaran_midtrans_atomik(item,s2,jenis,0,4200000,'2026-10-01',null,
    book27,'TEST-2026-ADVANCE','qris',bank,revenue,'UANG PANGKAL TK');
  SELECT * INTO p FROM pembayaran WHERE id=(r->>'pembayaran_id')::uuid;
  ASSERT p.tahun_ajaran_id=book26 AND p.tagihan_id=t2.id;
  ASSERT (r->>'diterima_dimuka')::boolean;
  ASSERT COALESCE((SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=revenue),0)=0;
  RAISE NOTICE 'PASS 4: online/Midtrans juga masuk Tahun Buku 2026 dan kewajiban';

  SELECT count(*) INTO count_before FROM jurnal;
  rejected := false;
  BEGIN PERFORM akui_pendapatan_dimuka_atomik(pd.id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Pendapatan belum dapat diakui%' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected AND (SELECT count(*) FROM jurnal)=count_before;
  SELECT * INTO result FROM akui_pendapatan_dimuka_jatuh_tempo('2027-12-31',null,5000);
  ASSERT result.diakui=0 AND (SELECT count(*) FROM jurnal)=count_before;
  RAISE NOTICE 'PASS 5: manual dan batch bertanggal masa depan tidak bisa mengakui dini';

  -- Simulasikan waktu pengakuan tiba di fixture, bukan mengubah jam server.
  UPDATE tagihan SET jatuh_tempo=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=t1.id;
  r := akui_pendapatan_dimuka_atomik(pd.id);
  ASSERT (r->>'diakui')::boolean;
  ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE akun_id=liability)=4200000;
  ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE akun_id=revenue)=4200000;
  SELECT count(*) INTO count_before FROM jurnal;
  r := akui_pendapatan_dimuka_atomik(pd.id);
  ASSERT NOT (r->>'diakui')::boolean AND (SELECT count(*) FROM jurnal)=count_before;
  RAISE NOTICE 'PASS 6: saat waktunya, D kewajiban/K pendapatan tepat sekali';

  -- Akun konfigurasi boleh berubah setelah penerimaan; pengakuan memakai jurnal asal.
  UPDATE jenis_pembayaran SET akun_dimuka_id=receivable WHERE id=jenis;
  SELECT pd2.* INTO pd FROM pendapatan_dimuka pd2 JOIN pembayaran p2 ON p2.id=pd2.pembayaran_id WHERE p2.siswa_id=s2;
  UPDATE tagihan SET jatuh_tempo=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=t2.id;
  r := akui_pendapatan_dimuka_atomik(pd.id);
  ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE akun_id=liability)=8400000;
  UPDATE jenis_pembayaran SET akun_dimuka_id=liability WHERE id=jenis;
  RAISE NOTICE 'PASS 7: perubahan konfigurasi tidak meninggalkan saldo kewajiban lama';

  -- Caller lama tetap bekerja bila TA dalam tahun target tidak ambigu.
  SELECT * INTO g FROM generate_tagihan_batch(jenis,book27,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s4,'kelas_id',null)),null);
  ASSERT g.generated=1 AND cardinality(g.errors)=0;
  ASSERT (SELECT tahun_akademik_id FROM tagihan WHERE siswa_id=s4)=academic27;
  SELECT * INTO g FROM generate_tagihan_batch(jenis,book26,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s5,'kelas_id',null,'tahun_akademik_id',academic27)),null);
  ASSERT g.generated=0 AND cardinality(g.errors)=1;
  RAISE NOTICE 'PASS 8: kompatibilitas caller lama dan penolakan tahun akademik/tahun buku salah';

  SELECT * INTO g FROM generate_tagihan_batch(jenis,book26,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s6,'kelas_id',null)),null);
  SELECT * INTO t6 FROM tagihan WHERE siswa_id=s6;
  ASSERT t6.status='belum_bayar' AND t6.jurnal_piutang_id IS NOT NULL;
  r := proses_pembayaran_atomik(s6,jenis,null,1000000,'2026-10-01','Uji piutang lama',null,
    book26,false,t6.id,kas,receivable,'Piutang','JP',null,'UANG PANGKAL TK');
  ASSERT (SELECT status FROM tagihan WHERE id=t6.id)='sebagian';
  ASSERT NOT EXISTS(SELECT 1 FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid);
  ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=receivable)=1000000;
  RAISE NOTICE 'PASS 9: cicilan tagihan lama tetap melunasi piutang';

  rejected := false;
  BEGIN
    PERFORM proses_pembayaran_atomik(s5,jenis,null,1000000,'2026-10-01','Uji tanpa tagihan',null,
      book26,true,null,kas,liability,'Dimuka','JD',null,'UANG PANGKAL TK');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Buat dan pilih tagihan uang pangkal%' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected;
  ASSERT NOT EXISTS(SELECT jurnal_id FROM jurnal_detail GROUP BY jurnal_id HAVING sum(debit)<>sum(kredit));
  ASSERT NOT EXISTS(SELECT j.id FROM jurnal j LEFT JOIN jurnal_detail d ON d.jurnal_id=j.id
    GROUP BY j.id,j.total_debit,j.total_kredit HAVING j.total_debit<>COALESCE(sum(d.debit),0) OR j.total_kredit<>COALESCE(sum(d.kredit),0));
  RAISE NOTICE 'PASS 10: uang pangkal tanpa target ditolak; semua jurnal balance';
  -- Dua TA pada tahun sama tidak boleh ditebak. Wrapper meneruskan TA terpilih.
  INSERT INTO tahun_ajaran(nama,tanggal_mulai,tanggal_selesai,aktif)
    VALUES('TA alternatif','2027-08-01','2028-07-31',false);
  SELECT * INTO g FROM generate_tagihan_batch(jenis,book27,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s5,'kelas_id',null)),null);
  ASSERT g.generated=0 AND cardinality(g.errors)=1;
  PERFORM set_config('test.uid','00000000-0000-0000-0000-000000000099',true);
  r := simpan_tarif_dan_generate_atomik('[]'::jsonb,academic27,jenis,
    jsonb_build_array(jsonb_build_object('tahun_buku_id',book27,'bulan_list',jsonb_build_array(null))),
    null,null,s5,null,null);
  ASSERT (r->>'generated')::integer=1;
  ASSERT (SELECT tahun_akademik_id FROM tagihan WHERE siswa_id=s5)=academic27;
  ASSERT (SELECT jatuh_tempo FROM tagihan WHERE siswa_id=s5)='2027-07-01';
  RAISE NOTICE 'PASS 12: TA ambigu ditolak; wrapper SPMB/Tarif tetap memakai TA eksplisit';
  INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,bulan,jumlah,nama_item)
    VALUES(gen_random_uuid(),'00000000-0000-0000-0000-000000000003',jenis,0,4200000,'Tanpa Target')
    RETURNING id INTO item;
  rejected := false;
  BEGIN
    PERFORM proses_pembayaran_midtrans_atomik(item,'00000000-0000-0000-0000-000000000003',
      jenis,0,4200000,'2026-10-01',null,book27,'TEST-NO-TARGET','qris',bank,revenue,'UANG PANGKAL TK');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Buat dan pilih tagihan uang pangkal%' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected;
  RAISE NOTICE 'PASS 13: online tanpa tagihan target ditolak';
  SELECT count(*) INTO count_before FROM jurnal;
  r := jalankan_akrual_jatuh_tempo('2027-12-31',null,5000);
  ASSERT (r->>'piutang_diposting')::integer=0 AND (r->>'pendapatan_diakui')::integer=0;
  ASSERT (SELECT count(*) FROM jurnal)=count_before;
  RAISE NOTICE 'PASS 14: akrual gabungan tidak membukukan tagihan masa depan';
  -- Catatan impor lama tanpa jurnal asal harus ditahan, bukan mengarang kewajiban.
  SELECT * INTO p FROM pembayaran WHERE siswa_id=s6 LIMIT 1;
  UPDATE pembayaran SET jurnal_id=null WHERE id=p.id;
  INSERT INTO pendapatan_dimuka(pembayaran_id,siswa_id,jenis_id,tahun_ajaran_pembayaran_id,
    tahun_ajaran_target_id,jumlah,status) VALUES(p.id,s6,jenis,book26,book26,p.jumlah,'pending')
    RETURNING * INTO pd;
  SELECT count(*) INTO count_before FROM jurnal;
  rejected := false;
  BEGIN PERFORM akui_pendapatan_dimuka_atomik(pd.id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Jurnal penerimaan tidak memiliki%' THEN RAISE; END IF;
    rejected := true;
  END;
  ASSERT rejected AND (SELECT count(*) FROM jurnal)=count_before;
  RAISE NOTICE 'PASS 15: data lama tanpa jurnal penerimaan ditolak tanpa efek jurnal';



END;
$test$;

-- Potongan 10% pada tagihan terjadwal yang dibayar penuh: pengakuan bruto.
CREATE OR REPLACE FUNCTION hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric)
 RETURNS TABLE(nominal_diskon numeric,siswa_diskon_id uuid) LANGUAGE sql AS $$ SELECT 420000::numeric,null::uuid $$;
DO $discount$
DECLARE
  s uuid := '00000000-0000-0000-0000-000000000003';
  book26 uuid := '00000000-0000-0000-0000-000000002026';
  book27 uuid := '00000000-0000-0000-0000-000000002027';
  jenis uuid; kas uuid; liability uuid; revenue uuid; potongan uuid; t tagihan; r jsonb; pdid uuid; g record;
BEGIN
  SELECT id INTO jenis FROM jenis_pembayaran WHERE nama='UANG PANGKAL TK';
  SELECT id INTO kas FROM akun_rekening WHERE kode='1101';
  SELECT id INTO liability FROM akun_rekening WHERE kode='2106';
  SELECT id INTO revenue FROM akun_rekening WHERE kode='4307';
  SELECT id INTO potongan FROM akun_rekening WHERE kode='4602';
  SELECT * INTO g FROM generate_tagihan_batch(jenis,book27,null,null,
    jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',null,'tahun_akademik_id','00000000-0000-0000-0000-000000102027')),null);
  SELECT * INTO t FROM tagihan WHERE siswa_id=s;
  ASSERT t.nominal=3780000 AND t.nominal_bruto=4200000 AND t.nominal_diskon=420000;
  r := proses_pembayaran_atomik(s,jenis,null,t.nominal,'2026-10-01','Uji diskon',null,
    book26,true,t.id,kas,liability,'Dimuka','JD',null,'UANG PANGKAL TK');
  SELECT id INTO pdid FROM pendapatan_dimuka WHERE pembayaran_id=(r->>'pembayaran_id')::uuid;
  UPDATE tagihan SET jatuh_tempo=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id=t.id;
  r := akui_pendapatan_dimuka_atomik(pdid);
  ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=liability)=3780000;
  ASSERT (SELECT sum(debit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=potongan)=420000;
  ASSERT (SELECT sum(kredit) FROM jurnal_detail WHERE jurnal_id=(r->>'jurnal_id')::uuid AND akun_id=revenue)=4200000;
  RAISE NOTICE 'PASS 11: pengakuan potongan 10 persen balance dan tetap bruto/netto';
END;
$discount$;
ROLLBACK;
