-- Fixture LOCAL saja; seluruh perubahan data uji di-rollback.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'hijrah_spp_test_period_20261006' THEN
  RAISE EXCEPTION 'Tes hanya untuk fixture lokal kategori SPP per periode';
 END IF;
END $$;
INSERT INTO public.akun_rekening(kode,nama,jenis,saldo_normal,aktif) VALUES
 ('4101','SPP Umum','pendapatan','K',true),('4102','SPP Asrama','pendapatan','K',true),('4103','SPP Non Asrama','pendapatan','K',true);
INSERT INTO public.users_profile(id,email,role,aktif) VALUES
 ('00000000-0000-0000-0000-000000000901','period-admin@test.invalid','admin',true),
 ('00000000-0000-0000-0000-000000000902','period-kasir@test.invalid','kasir',true);
INSERT INTO public.departemen(id,kode,kategori) VALUES
 ('00000000-0000-0000-0000-000000000910','SMP','unit_pendidikan');
INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES
 ('00000000-0000-0000-0000-000000000911','Siswa Periode Uji','00000000-0000-0000-0000-000000000910','aktif');
INSERT INTO public.siswa_detail(siswa_id,status_asrama)
 VALUES('00000000-0000-0000-0000-000000000911','asrama');
INSERT INTO public.jenis_pembayaran(id,nama,tipe,nominal,hari_jatuh_tempo,aktif,akun_pendapatan_id,departemen_id)
 SELECT '00000000-0000-0000-0000-000000000912','SPP SMP','bulanan',450000,10,true,id,'00000000-0000-0000-0000-000000000910'
 FROM public.akun_rekening WHERE kode='4101';
DO $test$
DECLARE
 s uuid:='00000000-0000-0000-0000-000000000911';
 j uuid:='00000000-0000-0000-0000-000000000912';
 actor uuid:='00000000-0000-0000-0000-000000000901';
 first_month date:=(date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')+interval '1 month')::date;
 t uuid; t_paid uuid; t_posted uuid; t_online uuid; t_new uuid; txn uuid; payment uuid;
 journal uuid; book uuid; asrama uuid; non_asrama uuid; p jsonb; r jsonb; g record; failed boolean;
 journal_count bigint; payment_count bigint; nominal_total numeric; n integer;
BEGIN
 SELECT id INTO asrama FROM akun_rekening WHERE kode='4102';
 SELECT id INTO non_asrama FROM akun_rekening WHERE kode='4103';
 FOR n IN 0..3 LOOP
  SELECT id INTO book FROM tahun_buku WHERE (first_month+make_interval(months=>n))::date BETWEEN tanggal_mulai AND tanggal_selesai;
  INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,tanggal_pengakuan)
   VALUES(s,j,book,extract(month FROM first_month+make_interval(months=>n)),450000,'terjadwal',
    (first_month+make_interval(months=>n)+interval '9 days')::date,
    (first_month+make_interval(months=>n))::date) RETURNING id INTO t_new;
  IF n=0 THEN t:=t_new; ELSIF n=1 THEN t_paid:=t_new; ELSIF n=2 THEN t_posted:=t_new; ELSE t_online:=t_new; END IF;
 END LOOP;
 INSERT INTO pembayaran(siswa_id,jenis_id,jumlah,tagihan_id,tanggal_bayar,bulan)
  VALUES(s,j,100000,t_paid,current_date,extract(month FROM first_month+interval '1 month')) RETURNING id INTO payment;
 UPDATE tagihan SET status='sebagian' WHERE id=t_paid;
 INSERT INTO jurnal(tanggal,keterangan,status,total_debit,total_kredit)
  VALUES(current_date,'Jurnal uji tidak boleh diubah','posted',450000,450000) RETURNING id INTO journal;
 UPDATE tagihan SET jurnal_piutang_id=journal WHERE id=t_posted;
 INSERT INTO transaksi_midtrans(status) VALUES('pending') RETURNING id INTO txn;
 INSERT INTO transaksi_midtrans_item(transaksi_id,siswa_id,jenis_id,tagihan_id,jumlah,bulan,nama_item)
  VALUES(txn,s,j,t_online,450000,extract(month FROM first_month+interval '3 months'),'SPP SMP');
 SELECT count(*) INTO journal_count FROM jurnal;
 SELECT count(*) INTO payment_count FROM pembayaran;
 SELECT sum(nominal) INTO nominal_total FROM tagihan WHERE siswa_id=s;

 p:=sesuaikan_kategori_spp_periode(s,j,first_month,(first_month+interval '5 months')::date,'non_asrama',actor);
 ASSERT (p->>'bulan_dapat_disesuaikan')::integer=3,p::text;
 ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'rows') row WHERE row->>'aksi'='terkunci')=3,p::text;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE id=t)='asrama';
 ASSERT (SELECT count(*) FROM spp_kategori_periode)=0;
 RAISE NOTICE 'PASS 1: preview read-only; pembayaran, jurnal, dan online pending terkunci';

 r:=sesuaikan_kategori_spp_periode(s,j,first_month,(first_month+interval '5 months')::date,'non_asrama',actor,true,p->>'preview_hash','Pindah non asrama sesuai wali siswa');
 ASSERT (r->>'tagihan_diubah')::integer=1,r::text;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE id=t)='non_asrama';
 ASSERT (SELECT spp_akun_pendapatan_id FROM tagihan WHERE id=t)=non_asrama;
 ASSERT (SELECT count(*) FROM spp_kategori_periode WHERE siswa_id=s)=3;
 ASSERT (SELECT count(*) FROM spp_kategori_periode_audit WHERE siswa_id=s)=1;
 ASSERT (SELECT status_asrama FROM siswa_detail WHERE siswa_id=s)='asrama';
 ASSERT (SELECT count(*) FROM pembayaran)=payment_count;
 ASSERT (SELECT count(*) FROM jurnal)=journal_count;
 ASSERT (SELECT sum(nominal) FROM tagihan WHERE siswa_id=s)=nominal_total;
 ASSERT (SELECT count(*) FROM tagihan WHERE id IN(t_paid,t_posted,t_online) AND spp_kategori='asrama')=3;
 ASSERT (SELECT spp_kategori FROM pembayaran WHERE id=payment)='asrama';
 RAISE NOTICE 'PASS 2: hanya bulan eligible berubah, audit lengkap, status siswa/nominal/pembayaran/jurnal tetap';

 SELECT id INTO book FROM tahun_buku WHERE (first_month+interval '4 months')::date BETWEEN tanggal_mulai AND tanggal_selesai;
 INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,tanggal_pengakuan)
 VALUES(s,j,book,extract(month FROM first_month+interval '4 months'),450000,'terjadwal',
  (first_month+interval '4 months 9 days')::date,(first_month+interval '4 months')::date) RETURNING id INTO t_new;
 ASSERT (SELECT spp_kategori FROM tagihan WHERE id=t_new)='non_asrama';
 ASSERT (SELECT spp_akun_pendapatan_id FROM tagihan WHERE id=t_new)=non_asrama;
 ASSERT (SELECT kategori FROM snapshot_spp_periode(j,s,(first_month+interval '1 month')::date))='asrama';
 RAISE NOTICE 'PASS 3: tagihan baru mengikuti rencana bulannya, bulan terkunci tidak diberi override';

 SELECT id INTO book FROM tahun_buku WHERE (first_month+interval '5 months')::date BETWEEN tanggal_mulai AND tanggal_selesai;
 SELECT * INTO g FROM generate_tagihan_batch(j,book,extract(month FROM first_month+interval '5 months')::integer,NULL,
  jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',NULL)),actor);
 ASSERT g.generated=1 AND cardinality(g.errors)=0,coalesce(array_to_string(g.errors,','),'generate gagal');
 ASSERT (SELECT spp_kategori FROM tagihan WHERE siswa_id=s AND bulan=extract(month FROM first_month+interval '5 months'))='non_asrama';
 RAISE NOTICE 'PASS 4: generate massal mengikuti kategori per periode';

 p:=sesuaikan_kategori_spp_periode(s,j,first_month,first_month,'asrama',actor);
 INSERT INTO pembayaran(siswa_id,jenis_id,jumlah,tagihan_id,tanggal_bayar,bulan)
  VALUES(s,j,100000,t,current_date,extract(month FROM first_month));
 failed:=false;
 BEGIN
  PERFORM sesuaikan_kategori_spp_periode(s,j,first_month,first_month,'asrama',actor,true,p->>'preview_hash','Uji pratinjau yang sudah kedaluwarsa');
 EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%Data berubah%'; END;
 ASSERT failed,'Harus menolak preview sebelum pembayaran masuk';
 ASSERT (SELECT spp_kategori FROM tagihan WHERE id=t)='non_asrama';
 RAISE NOTICE 'PASS 5: preview lama ditolak bila pembayaran baru masuk';

 failed:=false;
 BEGIN UPDATE tagihan SET spp_kategori='non_asrama',spp_akun_pendapatan_id=non_asrama WHERE id=t_paid;
 EXCEPTION WHEN OTHERS THEN failed:=true; END; ASSERT failed,'Edit langsung tagihan dibayar harus ditolak';
 failed:=false;
 BEGIN PERFORM sesuaikan_kategori_spp_periode(s,j,first_month,first_month,'asrama','00000000-0000-0000-0000-000000000902');
 EXCEPTION WHEN OTHERS THEN failed:=true; END; ASSERT failed,'Kasir harus ditolak';
 failed:=false;
 BEGIN PERFORM sesuaikan_kategori_spp_periode(s,j,(first_month-interval '1 month')::date,first_month,'asrama',actor);
 EXCEPTION WHEN OTHERS THEN failed:=true; END; ASSERT failed,'Bulan berjalan harus ditolak';
 ASSERT NOT has_function_privilege('authenticated','public.sesuaikan_kategori_spp_periode(uuid,uuid,date,date,text,uuid,boolean,text,text)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.spp_kategori_periode_audit','INSERT');
 RAISE NOTICE 'PASS 6: edit langsung, kasir, bulan berjalan, dan browser tanpa otorisasi ditolak';

 -- Uji periode tutup buku pada bulan tanpa tagihan dan duplikasi aktif.
 INSERT INTO log_tutup_buku(tahun_ajaran_id,unit) VALUES(book,'unit_pendidikan');
 p:=sesuaikan_kategori_spp_periode(s,j,(first_month+interval '6 months')::date,(first_month+interval '6 months')::date,'asrama',actor);
 ASSERT (p->>'bulan_dapat_disesuaikan')::integer=0,p::text;
 ASSERT p->'rows'->0->>'alasan'='Periode sudah ditutup buku';
 RAISE NOTICE 'PASS 7: rencana baru pada periode tutup buku ditolak';
END;
$test$;
ROLLBACK;

