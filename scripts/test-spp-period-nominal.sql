-- Fixture LOCAL saja; seluruh perubahan data uji di-rollback.
BEGIN;

DO $$
BEGIN
  IF current_database()<>'hijrah_spp_test_period_nominal_20261006' THEN
    RAISE EXCEPTION 'Tes hanya untuk fixture lokal nominal SPP per periode';
  END IF;
END $$;

INSERT INTO public.akun_rekening(kode,nama,jenis,saldo_normal,aktif) VALUES
 ('4101','SPP Umum','pendapatan','K',true),
 ('4102','SPP Asrama','pendapatan','K',true),
 ('4103','SPP Non Asrama','pendapatan','K',true),
 ('4901','Potongan SPP Uji','pendapatan','D',true);

UPDATE public.pengaturan_akun
SET akun_id=(SELECT id FROM public.akun_rekening WHERE kode='4901')
WHERE kode_setting='AKUN_POTONGAN_PENDAPATAN';

INSERT INTO public.pengaturan_akun(kode_setting,akun_id,label)
SELECT 'AKUN_POTONGAN_PENDAPATAN',id,'Akun potongan pendapatan'
FROM public.akun_rekening
WHERE kode='4901'
  AND NOT EXISTS (
    SELECT 1 FROM public.pengaturan_akun WHERE kode_setting='AKUN_POTONGAN_PENDAPATAN'
  );

INSERT INTO public.users_profile(id,email,role,aktif) VALUES
 ('00000000-0000-0000-0000-000000000901','period-admin@test.invalid','admin',true),
 ('00000000-0000-0000-0000-000000000902','period-kasir@test.invalid','kasir',true);

INSERT INTO public.departemen(id,kode,kategori) VALUES
 ('00000000-0000-0000-0000-000000000910','SMP','unit_pendidikan');

INSERT INTO public.siswa(id,nama,departemen_id,status) VALUES
 ('00000000-0000-0000-0000-000000000911','Siswa Periode Nominal Uji','00000000-0000-0000-0000-000000000910','aktif');

INSERT INTO public.siswa_detail(siswa_id,status_asrama)
VALUES('00000000-0000-0000-0000-000000000911','asrama');

INSERT INTO public.jenis_pembayaran(
  id,nama,tipe,nominal,hari_jatuh_tempo,aktif,akun_pendapatan_id,departemen_id
)
SELECT
 '00000000-0000-0000-0000-000000000912','SPP SMP','bulanan',0,10,true,id,
 '00000000-0000-0000-0000-000000000910'
FROM public.akun_rekening WHERE kode='4101';

-- Fixture lama tidak memuat tabel kebijakan diskon lengkap. Stub fungsi yang
-- SUDAH menjadi dependency generate dipakai hanya di transaksi test dan akan
-- ikut ROLLBACK. Tujuannya menguji bahwa perubahan bruto menghitung ulang
-- diskon/netto, bukan menguji mesin kebijakan diskon itu sendiri.
CREATE OR REPLACE FUNCTION public.hitung_diskon_tagihan(
  p_siswa_id uuid,p_jenis_id uuid,p_periode_id uuid,p_bulan integer,p_nominal_bruto numeric
) RETURNS TABLE(nominal_diskon numeric,siswa_diskon_id uuid)
LANGUAGE sql STABLE
AS $stub$
  SELECT CASE WHEN p_nominal_bruto>0 THEN 100000::numeric ELSE 0::numeric END,
         '00000000-0000-0000-0000-000000000914'::uuid
$stub$;

-- Fixture period lama juga membawa get_tarif_siswa versi sebelum hardening
-- search_path. Samakan perilaku minimum yang dibutuhkan test dengan production:
-- tarif siswa+tahun buku aktif, tanpa fallback ke nominal master.
CREATE OR REPLACE FUNCTION public.get_tarif_siswa(
  p_jenis_id uuid,p_siswa_id uuid,p_kelas_id uuid DEFAULT NULL,
  p_tahun_ajaran_id uuid DEFAULT NULL,p_angkatan_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE
SET search_path=''
AS $tarif$
  SELECT t.nominal
  FROM public.tarif_tagihan t
  WHERE t.jenis_id=p_jenis_id
    AND t.siswa_id=p_siswa_id
    AND t.kelas_id IS NULL
    AND t.tahun_ajaran_id=p_tahun_ajaran_id
    AND COALESCE(t.aktif,false)
  LIMIT 1
$tarif$;

DO $test$
DECLARE
  s uuid:='00000000-0000-0000-0000-000000000911';
  j uuid:='00000000-0000-0000-0000-000000000912';
  actor uuid:='00000000-0000-0000-0000-000000000901';
  kasir uuid:='00000000-0000-0000-0000-000000000902';
  diskon_id uuid:='00000000-0000-0000-0000-000000000914';
  first_month date:=(date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')+interval '1 month')::date;
  t uuid;
  t_paid uuid;
  t_posted uuid;
  t_online uuid;
  t_new uuid;
  txn uuid;
  payment uuid;
  journal uuid;
  book uuid;
  asrama uuid;
  non_asrama uuid;
  p jsonb;
  r jsonb;
  p_same jsonb;
  p_amount_only jsonb;
  g record;
  failed boolean;
  journal_count bigint;
  payment_count bigint;
  nominal_total_before numeric;
  nominal_total_after numeric;
  n integer;
  target_gross numeric:=1300000;
  target_discount numeric:=100000;
  target_net numeric:=1200000;
BEGIN
  SELECT id INTO asrama FROM public.akun_rekening WHERE kode='4102';
  SELECT id INTO non_asrama FROM public.akun_rekening WHERE kode='4103';

  -- Empat tagihan awal: satu eligible, tiga sengaja dibuat terkunci.
  FOR n IN 0..3 LOOP
    SELECT id INTO STRICT book
    FROM public.tahun_buku
    WHERE (first_month+make_interval(months=>n))::date BETWEEN tanggal_mulai AND tanggal_selesai
    LIMIT 1;

    INSERT INTO public.tarif_tagihan(
      jenis_id,siswa_id,kelas_id,tahun_ajaran_id,angkatan_id,nominal,aktif,keterangan
    ) VALUES (
      j,s,NULL,book,NULL,450000,true,'Tarif fixture sebelum pindah kategori'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.tagihan(
      siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,nominal_bruto,nominal_diskon,siswa_diskon_id,
      status,jatuh_tempo,tanggal_pengakuan
    ) VALUES (
      s,j,book,extract(month FROM first_month+make_interval(months=>n)),
      350000,450000,100000,diskon_id,'terjadwal',
      (first_month+make_interval(months=>n)+interval '9 days')::date,
      (first_month+make_interval(months=>n))::date
    ) RETURNING id INTO t_new;

    IF n=0 THEN
      t:=t_new;
    ELSIF n=1 THEN
      t_paid:=t_new;
    ELSIF n=2 THEN
      t_posted:=t_new;
    ELSE
      t_online:=t_new;
    END IF;
  END LOOP;

  INSERT INTO public.pembayaran(siswa_id,jenis_id,jumlah,tagihan_id,tanggal_bayar,bulan)
  VALUES(s,j,100000,t_paid,current_date,extract(month FROM first_month+interval '1 month'))
  RETURNING id INTO payment;
  UPDATE public.tagihan SET status='sebagian' WHERE id=t_paid;

  INSERT INTO public.jurnal(tanggal,keterangan,status,total_debit,total_kredit)
  VALUES(current_date,'Jurnal uji tidak boleh diubah','posted',350000,350000)
  RETURNING id INTO journal;
  UPDATE public.tagihan SET jurnal_piutang_id=journal WHERE id=t_posted;

  INSERT INTO public.transaksi_midtrans(status) VALUES('pending') RETURNING id INTO txn;
  INSERT INTO public.transaksi_midtrans_item(
    transaksi_id,siswa_id,jenis_id,tagihan_id,jumlah,bulan,nama_item
  ) VALUES(
    txn,s,j,t_online,350000,extract(month FROM first_month+interval '3 months'),'SPP SMP'
  );

  SELECT count(*) INTO journal_count FROM public.jurnal;
  SELECT count(*) INTO payment_count FROM public.pembayaran;
  SELECT sum(nominal) INTO nominal_total_before FROM public.tagihan WHERE siswa_id=s;

  p:=public.sesuaikan_kategori_spp_periode(
    s,j,first_month,(first_month+interval '5 months')::date,
    'non_asrama',target_gross,actor
  );

  ASSERT (p->>'bulan_dapat_disesuaikan')::integer=3,p::text;
  ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'rows') row WHERE row->>'aksi'='terkunci')=3,p::text;
  ASSERT (SELECT count(*) FROM jsonb_array_elements(p->'rows') row
          WHERE row->>'aksi'='ubah_tagihan'
            AND (row->>'nominal_bruto_lama')::numeric=450000
            AND (row->>'nominal_bruto_baru')::numeric=target_gross
            AND (row->>'nominal_diskon_baru')::numeric=target_discount
            AND (row->>'nominal_netto_baru')::numeric=target_net)=1,p::text;
  ASSERT (SELECT spp_kategori FROM public.tagihan WHERE id=t)='asrama';
  ASSERT (SELECT nominal FROM public.tagihan WHERE id=t)=350000;
  ASSERT (SELECT count(*) FROM public.spp_kategori_periode)=0;
  RAISE NOTICE 'PASS 1: preview read-only; bruto/diskon/netto baru terlihat; pembayaran/jurnal/online aktif terkunci';

  r:=public.sesuaikan_kategori_spp_periode(
    s,j,first_month,(first_month+interval '5 months')::date,
    'non_asrama',target_gross,actor,true,p->>'preview_hash',
    'Pindah non asrama dan sesuaikan tarif sesuai konfirmasi wali siswa'
  );

  ASSERT (r->>'tagihan_diubah')::integer=1,r::text;
  ASSERT (SELECT spp_kategori FROM public.tagihan WHERE id=t)='non_asrama';
  ASSERT (SELECT spp_akun_pendapatan_id FROM public.tagihan WHERE id=t)=non_asrama;
  ASSERT (SELECT nominal_bruto FROM public.tagihan WHERE id=t)=target_gross;
  ASSERT (SELECT nominal_diskon FROM public.tagihan WHERE id=t)=target_discount;
  ASSERT (SELECT nominal FROM public.tagihan WHERE id=t)=target_net;
  ASSERT (SELECT siswa_diskon_id FROM public.tagihan WHERE id=t)=diskon_id;
  ASSERT (SELECT count(*) FROM public.spp_kategori_periode WHERE siswa_id=s)=3;
  ASSERT (SELECT count(*) FROM public.spp_kategori_periode WHERE siswa_id=s AND nominal_bruto=target_gross)=3;
  ASSERT (SELECT count(*) FROM public.spp_kategori_periode_audit WHERE siswa_id=s AND nominal_bruto=target_gross)=1;
  ASSERT (SELECT status_asrama FROM public.siswa_detail WHERE siswa_id=s)='asrama';
  ASSERT (SELECT count(*) FROM public.pembayaran)=payment_count;
  ASSERT (SELECT count(*) FROM public.jurnal)=journal_count;
  ASSERT (SELECT count(*) FROM public.tagihan
          WHERE id IN(t_paid,t_posted,t_online)
            AND spp_kategori='asrama'
            AND nominal_bruto=450000
            AND nominal_diskon=100000
            AND nominal=350000)=3;
  ASSERT (SELECT spp_kategori FROM public.pembayaran WHERE id=payment)='asrama';

  SELECT sum(nominal) INTO nominal_total_after FROM public.tagihan WHERE siswa_id=s;
  ASSERT nominal_total_after-nominal_total_before=850000;

  ASSERT EXISTS(
    SELECT 1
    FROM public.spp_kategori_periode_audit a
    CROSS JOIN LATERAL jsonb_array_elements(a.perubahan) e
    WHERE a.siswa_id=s AND e->>'tagihan_id'=t::text
      AND (e->>'nominal_bruto_lama')::numeric=450000
      AND (e->>'nominal_bruto_baru')::numeric=target_gross
      AND (e->>'nominal_diskon_lama')::numeric=100000
      AND (e->>'nominal_diskon_baru')::numeric=target_discount
      AND (e->>'nominal_netto_lama')::numeric=350000
      AND (e->>'nominal_netto_baru')::numeric=target_net
  );
  RAISE NOTICE 'PASS 2: apply hanya mengubah tagihan eligible; bruto/diskon/netto konsisten dan audit lengkap';

  -- Idempotensi: target yang sama tidak boleh dianggap perubahan baru.
  p_same:=public.sesuaikan_kategori_spp_periode(
    s,j,first_month,(first_month+interval '5 months')::date,
    'non_asrama',target_gross,actor
  );
  ASSERT (p_same->>'bulan_dapat_disesuaikan')::integer=0,p_same::text;
  ASSERT (SELECT count(*) FROM jsonb_array_elements(p_same->'rows') row WHERE row->>'aksi'='sudah_sesuai')=3,p_same::text;
  RAISE NOTICE 'PASS 3: preview idempotent; kategori+nominal yang sama tidak ditulis ulang';

  -- Kategori sama namun nominal berbeda tetap merupakan perubahan yang sah.
  p_amount_only:=public.sesuaikan_kategori_spp_periode(
    s,j,first_month,first_month,'non_asrama',1250000,actor
  );
  ASSERT (p_amount_only->>'bulan_dapat_disesuaikan')::integer=1,p_amount_only::text;
  ASSERT p_amount_only->'rows'->0->>'aksi'='ubah_tagihan',p_amount_only::text;
  ASSERT (p_amount_only->'rows'->0->>'nominal_netto_baru')::numeric=1150000,p_amount_only::text;
  RAISE NOTICE 'PASS 4: kategori sama tetap bisa mengubah nominal bruto dan menghitung ulang diskon/netto';

  -- Tagihan baru manual pada bulan rencana harus menerima bruto override.
  SELECT id INTO STRICT book
  FROM public.tahun_buku
  WHERE (first_month+interval '4 months')::date BETWEEN tanggal_mulai AND tanggal_selesai
  LIMIT 1;

  INSERT INTO public.tarif_tagihan(
    jenis_id,siswa_id,kelas_id,tahun_ajaran_id,angkatan_id,nominal,aktif,keterangan
  ) VALUES(j,s,NULL,book,NULL,450000,true,'Tarif fallback fixture')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tagihan(
    siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,nominal_bruto,nominal_diskon,siswa_diskon_id,
    status,jatuh_tempo,tanggal_pengakuan
  ) VALUES(
    s,j,book,extract(month FROM first_month+interval '4 months'),
    target_net,target_gross,target_discount,diskon_id,'terjadwal',
    (first_month+interval '4 months 9 days')::date,
    (first_month+interval '4 months')::date
  ) RETURNING id INTO t_new;

  ASSERT (SELECT spp_kategori FROM public.tagihan WHERE id=t_new)='non_asrama';
  ASSERT (SELECT spp_akun_pendapatan_id FROM public.tagihan WHERE id=t_new)=non_asrama;
  ASSERT public.nominal_spp_periode(j,s,(first_month+interval '4 months')::date)=target_gross;
  ASSERT (SELECT kategori FROM public.snapshot_spp_periode(j,s,(first_month+interval '1 month')::date))='asrama';
  RAISE NOTICE 'PASS 5: insert tagihan baru memakai kategori+bruto rencana; bulan terkunci tidak mendapat override';

  -- Generate massal pada bulan rencana: bruto override, diskon dihitung lagi, tanpa duplikat.
  SELECT id INTO STRICT book
  FROM public.tahun_buku
  WHERE (first_month+interval '5 months')::date BETWEEN tanggal_mulai AND tanggal_selesai
  LIMIT 1;

  INSERT INTO public.tarif_tagihan(
    jenis_id,siswa_id,kelas_id,tahun_ajaran_id,angkatan_id,nominal,aktif,keterangan
  ) VALUES(j,s,NULL,book,NULL,450000,true,'Tarif fallback fixture')
  ON CONFLICT DO NOTHING;

  SELECT * INTO g
  FROM public.generate_tagihan_batch(
    j,book,extract(month FROM first_month+interval '5 months')::integer,NULL,
    jsonb_build_array(jsonb_build_object('siswa_id',s,'kelas_id',NULL)),actor
  );

  ASSERT g.generated=1 AND cardinality(g.errors)=0,coalesce(array_to_string(g.errors,','),'generate gagal');
  ASSERT (
    SELECT count(*) FROM public.tagihan
    WHERE siswa_id=s AND jenis_id=j AND tahun_ajaran_id=book
      AND bulan=extract(month FROM first_month+interval '5 months')
  )=1;
  ASSERT (
    SELECT spp_kategori='non_asrama'
       AND spp_akun_pendapatan_id=non_asrama
       AND nominal_bruto=target_gross
       AND nominal_diskon=target_discount
       AND nominal=target_net
    FROM public.tagihan
    WHERE siswa_id=s AND jenis_id=j AND tahun_ajaran_id=book
      AND bulan=extract(month FROM first_month+interval '5 months')
  );
  RAISE NOTICE 'PASS 6: generate memakai snapshot bruto per bulan, hitung diskon/netto, dan tidak membuat duplikat';

  -- Preview stale harus gagal bila setelah preview ada pembayaran baru.
  p:=public.sesuaikan_kategori_spp_periode(
    s,j,first_month,first_month,'asrama',450000,actor
  );

  INSERT INTO public.pembayaran(siswa_id,jenis_id,jumlah,tagihan_id,tanggal_bayar,bulan)
  VALUES(s,j,100000,t,current_date,extract(month FROM first_month));

  failed:=false;
  BEGIN
    PERFORM public.sesuaikan_kategori_spp_periode(
      s,j,first_month,first_month,'asrama',450000,actor,true,p->>'preview_hash',
      'Uji pratinjau yang sudah kedaluwarsa setelah pembayaran baru'
    );
  EXCEPTION WHEN OTHERS THEN
    failed:=SQLERRM LIKE '%Data berubah%';
  END;
  ASSERT failed,'Harus menolak preview sebelum pembayaran masuk';
  ASSERT (SELECT spp_kategori FROM public.tagihan WHERE id=t)='non_asrama';
  ASSERT (SELECT nominal_bruto FROM public.tagihan WHERE id=t)=target_gross;
  RAISE NOTICE 'PASS 7: preview lama ditolak bila kondisi transaksi berubah';

  -- Guard langsung, role, bulan berjalan, dan hak browser.
  failed:=false;
  BEGIN
    UPDATE public.tagihan
    SET nominal_bruto=500000
    WHERE id=t_paid;
  EXCEPTION WHEN OTHERS THEN
    failed:=true;
  END;
  ASSERT failed,'Edit langsung nominal bruto harus ditolak';

  failed:=false;
  BEGIN
    PERFORM public.sesuaikan_kategori_spp_periode(
      s,j,first_month,first_month,'asrama',450000,kasir
    );
  EXCEPTION WHEN OTHERS THEN
    failed:=true;
  END;
  ASSERT failed,'Kasir harus ditolak';

  failed:=false;
  BEGIN
    PERFORM public.sesuaikan_kategori_spp_periode(
      s,j,(first_month-interval '1 month')::date,first_month,'asrama',450000,actor
    );
  EXCEPTION WHEN OTHERS THEN
    failed:=true;
  END;
  ASSERT failed,'Bulan berjalan harus ditolak';

  ASSERT NOT has_function_privilege(
    'authenticated',
    'public.sesuaikan_kategori_spp_periode(uuid,uuid,date,date,text,numeric,uuid,boolean,text,text)',
    'EXECUTE'
  );
  ASSERT NOT has_table_privilege('authenticated','public.spp_kategori_periode_audit','INSERT');
  RAISE NOTICE 'PASS 8: edit langsung, kasir, bulan berjalan, dan browser tanpa otorisasi ditolak';

  -- Tutup buku mengunci rencana baru.
  SELECT id INTO STRICT book
  FROM public.tahun_buku
  WHERE (first_month+interval '6 months')::date BETWEEN tanggal_mulai AND tanggal_selesai
  LIMIT 1;

  INSERT INTO public.log_tutup_buku(tahun_ajaran_id,unit)
  VALUES(book,'unit_pendidikan');

  p:=public.sesuaikan_kategori_spp_periode(
    s,j,(first_month+interval '6 months')::date,(first_month+interval '6 months')::date,
    'asrama',450000,actor
  );
  ASSERT (p->>'bulan_dapat_disesuaikan')::integer=0,p::text;
  ASSERT p->'rows'->0->>'alasan'='Periode sudah ditutup buku';
  RAISE NOTICE 'PASS 9: periode tutup buku tetap terkunci';
END;
$test$;

ROLLBACK;
