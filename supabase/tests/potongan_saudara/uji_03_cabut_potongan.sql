-- UJI 03: cabut_potongan_saudara untuk semua status tagihan + log + koreksi tagihan lunas.
CREATE TEMP TABLE hasil03(label text, ok boolean, detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.cek(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO hasil03 VALUES (p_label, COALESCE(p_ok,false), p_detail) $$;

CREATE FUNCTION pg_temp.jurnal_fx() RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO jurnal(tanggal, keterangan, status) VALUES (current_date, 'UJI03 fixture piutang', 'posted') RETURNING id $$;

-- T1: satu baris potongan Jan-Des 2027 dengan tagihan berbagai status; dicabut mulai Juni 2027
DO $t1$
DECLARE
  v_j uuid;
  v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_sd uuid := gen_random_uuid(); v_new uuid;
  v_piutang uuid; v_potongan uuid; r jsonb; n int; t record;
  f constant uuid := '00000000-0000-0000-0005-000000000001';
  b constant uuid := '00000000-0000-0000-0005-0000000000b1';
  a constant uuid := '00000000-0000-0000-0005-0000000000a1';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_buku WHERE nama='Tahun 2027';
    SELECT id, akun_potongan_id INTO v_jenis, v_potongan FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SELECT akun_id INTO v_piutang FROM pengaturan_akun WHERE kode_setting='piutang_siswa';
    SET LOCAL session_replication_role = replica;
    v_j := pg_temp.jurnal_fx();
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI03');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI03 A','aktif',f),(b,'UJI03 B','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_sd,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    -- Jan-Mei terjadwal (tetap), Jun terjadwal, Jul belum_bayar, Agu sebagian, Sep lunas, Okt dibatalkan
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id,jurnal_piutang_id)
      SELECT b,v_jenis,v_ta,m,400000,
             CASE WHEN m<=6 THEN 'terjadwal' WHEN m=7 THEN 'belum_bayar' WHEN m=8 THEN 'sebagian' WHEN m=9 THEN 'lunas' WHEN m=10 THEN 'dibatalkan' ELSE 'terjadwal' END,
             make_date(2027,m,10),450000,50000,v_sd,
             CASE WHEN m BETWEEN 7 AND 10 THEN v_j END
      FROM generate_series(1,12) m;
    INSERT INTO pembayaran(siswa_id,jenis_id,tahun_ajaran_id,bulan,jumlah,tanggal_bayar,tagihan_id)
      SELECT b,v_jenis,v_ta,m,CASE WHEN m=8 THEN 150000 ELSE 400000 END,'2027-01-05',x.id
      FROM generate_series(8,9) m JOIN tagihan x ON x.siswa_id=b AND x.bulan=m;
    SET LOCAL session_replication_role = origin;

    SELECT public.cabut_potongan_saudara(v_sd,'2027-06-01','UJI03 saudara kurang dari 2',v_admin) INTO r;

    -- terjadwal Jun, Des kembali bruto tanpa jurnal
    PERFORM pg_temp.cek('Jun terjadwal kembali bruto',
      EXISTS(SELECT 1 FROM tagihan WHERE siswa_id=b AND bulan=6 AND nominal=450000 AND nominal_diskon=0 AND siswa_diskon_id IS NULL AND status='terjadwal'));
    PERFORM pg_temp.cek('Jun terjadwal tanpa jurnal baru',
      NOT EXISTS(SELECT 1 FROM jurnal WHERE referensi LIKE 'DISKON:'||v_sd||':%'||(SELECT id FROM tagihan WHERE siswa_id=b AND bulan=6)::text));
    -- belum_bayar Jul: nominal naik + jurnal Dr piutang Cr potongan
    PERFORM pg_temp.cek('Jul belum_bayar nominal bruto, status tetap',
      EXISTS(SELECT 1 FROM tagihan WHERE siswa_id=b AND bulan=7 AND nominal=450000 AND nominal_diskon=0 AND siswa_diskon_id IS NULL AND status='belum_bayar'));
    SELECT * INTO t FROM tagihan WHERE siswa_id=b AND bulan=7;
    PERFORM pg_temp.cek('Jul jurnal koreksi seimbang 50000 (Dr piutang, Cr potongan)',
      (SELECT count(*) FROM jurnal j WHERE j.referensi='DISKON:'||v_sd||':'||t.id AND j.status='posted' AND j.total_debit=50000 AND j.total_kredit=50000)=1
      AND EXISTS(SELECT 1 FROM jurnal j JOIN jurnal_detail d ON d.jurnal_id=j.id WHERE j.referensi='DISKON:'||v_sd||':'||t.id AND d.akun_id=v_piutang AND d.debit=50000 AND d.kredit=0)
      AND EXISTS(SELECT 1 FROM jurnal j JOIN jurnal_detail d ON d.jurnal_id=j.id WHERE j.referensi='DISKON:'||v_sd||':'||t.id AND d.akun_id=COALESCE(v_potongan,(SELECT akun_id FROM pengaturan_akun WHERE kode_setting='AKUN_POTONGAN_PENDAPATAN')) AND d.kredit=50000 AND d.debit=0));
    -- sebagian Agu: nominal naik di tagihan yang sama, tetap sebagian, sisa = 450000-150000
    SELECT * INTO t FROM tagihan WHERE siswa_id=b AND bulan=8;
    PERFORM pg_temp.cek('Agu sebagian: nominal 450000, status sebagian, sisa 300000',
      t.nominal=450000 AND t.nominal_diskon=0 AND t.status='sebagian'
      AND t.nominal-(SELECT sum(jumlah) FROM pembayaran WHERE tagihan_id=t.id)=300000,
      format('nominal=%s status=%s', t.nominal, t.status));
    PERFORM pg_temp.cek('Agu jurnal koreksi ada',
      (SELECT count(*) FROM jurnal WHERE referensi='DISKON:'||v_sd||':'||t.id)=1);
    -- lunas Sep: tidak diubah; tagihan koreksi baru
    PERFORM pg_temp.cek('Sep lunas tidak diubah',
      EXISTS(SELECT 1 FROM tagihan WHERE siswa_id=b AND bulan=9 AND jenis_id=v_jenis AND status='lunas' AND nominal=400000 AND nominal_diskon=50000));
    SELECT x.* INTO t FROM tagihan x JOIN jenis_pembayaran jp ON jp.id=x.jenis_id
      WHERE x.siswa_id=b AND x.bulan=9 AND jp.nama LIKE 'Koreksi Potongan Saudara%';
    PERFORM pg_temp.cek('Sep: tagihan koreksi 50000 belum_bayar dengan jurnal piutang',
      t.id IS NOT NULL AND t.nominal=50000 AND t.status='belum_bayar' AND t.jurnal_piutang_id IS NOT NULL AND t.tahun_ajaran_id=v_ta);
    PERFORM pg_temp.cek('Sep: jurnal koreksi Dr piutang Cr potongan 50000',
      EXISTS(SELECT 1 FROM jurnal j JOIN jurnal_detail d ON d.jurnal_id=j.id WHERE j.id=t.jurnal_piutang_id AND d.akun_id=v_piutang AND d.debit=50000)
      AND EXISTS(SELECT 1 FROM jurnal j JOIN jurnal_detail d ON d.jurnal_id=j.id WHERE j.id=t.jurnal_piutang_id AND d.kredit=50000));
    -- dibatalkan Okt: tidak disentuh
    PERFORM pg_temp.cek('Okt dibatalkan tidak disentuh',
      EXISTS(SELECT 1 FROM tagihan WHERE siswa_id=b AND bulan=10 AND status='dibatalkan' AND nominal_diskon=50000)
      AND NOT EXISTS(SELECT 1 FROM log_potongan_saudara WHERE siswa_id=b AND bulan='2027-10-01'));
    -- Jan-Mei tetap berpotongan dan menunjuk baris awalan baru
    SELECT id INTO v_new FROM siswa_diskon WHERE siswa_id=b AND status='disetujui';
    PERFORM pg_temp.cek('baris awalan Jan-Mei dibuat, lama dibatalkan',
      v_new IS NOT NULL AND v_new<>v_sd
      AND EXISTS(SELECT 1 FROM siswa_diskon WHERE id=v_new AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31')
      AND (SELECT status FROM siswa_diskon WHERE id=v_sd)='dibatalkan');
    PERFORM pg_temp.cek('Jan-Mei tetap berpotongan dan menunjuk baris baru',
      (SELECT count(*) FROM tagihan WHERE siswa_id=b AND bulan<=5 AND nominal_diskon=50000 AND siswa_diskon_id=v_new)=5);
    -- log
    SELECT count(*) INTO n FROM log_potongan_saudara WHERE siswa_id=b;
    PERFORM pg_temp.cek('log: 1 baris per tagihan terkena (Jun,Jul,Agu,Sep,Nov,Des = 6)', n=6, 'dapat '||n);
    PERFORM pg_temp.cek('log aksi sesuai status',
      (SELECT string_agg(aksi, ',' ORDER BY bulan) FROM log_potongan_saudara WHERE siswa_id=b)
      = 'cabut_terjadwal,cabut_belum_bayar,cabut_sebagian,koreksi_lunas,cabut_terjadwal,cabut_terjadwal',
      (SELECT string_agg(aksi, ',' ORDER BY bulan) FROM log_potongan_saudara WHERE siswa_id=b));
    -- idempotensi: panggil lagi dengan baris lama -> tidak ada efek tambahan
    SELECT count(*) INTO n FROM jurnal WHERE referensi LIKE 'DISKON:'||v_sd||':%';
    PERFORM public.cabut_potongan_saudara(v_sd,'2027-06-01','ulang',v_admin);
    PERFORM pg_temp.cek('idempoten: panggilan ulang tidak menambah jurnal/log/koreksi',
      (SELECT count(*) FROM jurnal WHERE referensi LIKE 'DISKON:'||v_sd||':%')=n
      AND (SELECT count(*) FROM log_potongan_saudara WHERE siswa_id=b)=6
      AND (SELECT count(*) FROM tagihan x JOIN jenis_pembayaran jp ON jp.id=x.jenis_id WHERE x.siswa_id=b AND jp.nama LIKE 'Koreksi Potongan Saudara%')=1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cek('T1 dieksekusi tanpa error', false, SQLERRM);
  END;
END $t1$;

-- T2: jenis "Koreksi Potongan Saudara" tidak aktif -> tagihan lunas hanya ditandai untuk admin, tanpa error
DO $t2$
DECLARE
  v_j uuid;
  v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_sd uuid := gen_random_uuid();
  f constant uuid := '00000000-0000-0000-0005-000000000002';
  b constant uuid := '00000000-0000-0000-0005-0000000000b2';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_buku WHERE nama='Tahun 2027';
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    UPDATE jenis_pembayaran SET aktif=false WHERE nama LIKE 'Koreksi Potongan Saudara%';
    SET LOCAL session_replication_role = replica;
    v_j := pg_temp.jurnal_fx();
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI03 T2');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (b,'UJI03 B2','aktif',f),('00000000-0000-0000-0005-0000000000a2','UJI03 A2','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_sd,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id,jurnal_piutang_id)
      VALUES (b,v_jenis,v_ta,9,400000,'lunas','2027-09-10',450000,50000,v_sd,v_j);
    SET LOCAL session_replication_role = origin;
    PERFORM public.cabut_potongan_saudara(v_sd,'2027-06-01','UJI03 T2',v_admin);
    PERFORM pg_temp.cek('T2 tanpa jenis koreksi aktif: ditandai admin, tidak ada tagihan koreksi',
      EXISTS(SELECT 1 FROM log_potongan_saudara WHERE siswa_id=b AND aksi='tandai_admin')
      AND NOT EXISTS(SELECT 1 FROM tagihan x JOIN jenis_pembayaran jp ON jp.id=x.jenis_id WHERE x.siswa_id=b AND jp.nama LIKE 'Koreksi Potongan Saudara%'));
    UPDATE jenis_pembayaran SET aktif=true WHERE nama LIKE 'Koreksi Potongan Saudara%';
  EXCEPTION WHEN OTHERS THEN
    UPDATE jenis_pembayaran SET aktif=true WHERE nama LIKE 'Koreksi Potongan Saudara%';
    PERFORM pg_temp.cek('T2 dieksekusi tanpa error', false, SQLERRM);
  END;
END $t2$;

-- T3: integrasi: akademik_akhiri_siswa memakai pencabut untuk tagihan belum_bayar saudara yang tersisa
DO $t3$
DECLARE
  v_j uuid;
  v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_sd uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0005-000000000003';
  a constant uuid := '00000000-0000-0000-0005-0000000000a3';
  b constant uuid := '00000000-0000-0000-0005-0000000000b3';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_buku WHERE nama='Tahun 2027';
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    v_j := pg_temp.jurnal_fx();
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI03 T3');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI03 A3','aktif',f),(b,'UJI03 B3','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_sd,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id,jurnal_piutang_id)
      SELECT b,v_jenis,v_ta,m,400000,'belum_bayar',make_date(2027,m,10),450000,50000,v_sd,v_j FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;
    PERFORM public.akademik_akhiri_siswa(ARRAY[a],'alumni','2027-06-01',v_admin);
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND bulan>=6 AND nominal=450000 AND nominal_diskon=0 AND status='belum_bayar';
    PERFORM pg_temp.cek('T3 akhiri_siswa: tagihan belum_bayar Jun-Des saudara kembali bruto (7)', n=7, 'dapat '||n);
    SELECT count(*) INTO n FROM jurnal WHERE referensi LIKE 'DISKON:'||v_sd||':%' AND total_debit=50000;
    PERFORM pg_temp.cek('T3 akhiri_siswa: 7 jurnal koreksi diposting', n=7, 'dapat '||n);
    PERFORM pg_temp.cek('T3 Jan-Mei tetap berpotongan',
      (SELECT count(*) FROM tagihan WHERE siswa_id=b AND bulan<=5 AND nominal_diskon=50000)=5);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cek('T3 dieksekusi tanpa error', false, SQLERRM);
  END;
END $t3$;


-- T4: memangkas baris yang SUDAH disetujui tidak boleh gagal oleh validasi syarat awal (mis. koreksi tanggal akhir aktif)
DO $t4$
DECLARE
  v_jenis uuid; v_skema uuid; v_sd uuid := gen_random_uuid(); v_new uuid; v_ditolak boolean;
  f constant uuid := '00000000-0000-0000-0005-000000000004';
  a constant uuid := '00000000-0000-0000-0005-0000000000a4';
  b constant uuid := '00000000-0000-0000-0005-0000000000b4';
BEGIN
  BEGIN
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI03 T4');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_akhir_aktif) VALUES (a,'UJI03 A4','alumni',f,'2026-12-31'),(b,'UJI03 B4','aktif',f,NULL);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_sd,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    SET LOCAL session_replication_role = origin;
    v_new := public.pangkas_diskon_siswa(v_sd,'2027-03-31','UJI03 T4');
    PERFORM pg_temp.cek('T4 pangkas tidak gagal walau bulan awal kini hanya 1 aktif',
      v_new IS NOT NULL AND EXISTS(SELECT 1 FROM siswa_diskon WHERE id=v_new AND status='disetujui' AND periode_mulai='2027-01-01' AND periode_selesai='2027-03-31')
      AND (SELECT status FROM siswa_diskon WHERE id=v_sd)='dibatalkan');
    -- validasi untuk pengajuan BARU tetap berlaku sesudah pangkas (Mei 2027 hanya 1 aktif)
    v_ditolak := false;
    BEGIN
      INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status)
        VALUES (b,v_skema,v_jenis,'2027-05-01','2027-05-31',50000,'disetujui');
    EXCEPTION WHEN OTHERS THEN v_ditolak := true; END;
    PERFORM pg_temp.cek('T4 pengajuan baru untuk bulan dengan 1 aktif tetap ditolak', v_ditolak);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cek('T4 dieksekusi tanpa error', false, SQLERRM);
  END;
END $t4$;

-- T5: tahun buku tagihan lunas sudah ditutup -> koreksi tidak bisa dibuat; ditandai admin, proses TIDAK gagal
DO $t5$
DECLARE
  v_j uuid; v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_sd uuid := gen_random_uuid(); r jsonb;
  f constant uuid := '00000000-0000-0000-0005-000000000005';
  b constant uuid := '00000000-0000-0000-0005-0000000000b5';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_buku WHERE public.is_tahun_buku_pendidikan_locked(id) ORDER BY nama LIMIT 1;
    IF v_ta IS NULL THEN RAISE EXCEPTION 'uji butuh satu tahun buku yang terkunci'; END IF;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    v_j := pg_temp.jurnal_fx();
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI03 T5');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (b,'UJI03 B5','aktif',f),('00000000-0000-0000-0005-0000000000a5','UJI03 A5','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_sd,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id,jurnal_piutang_id)
      VALUES (b,v_jenis,v_ta,9,400000,'lunas','2027-09-10',450000,50000,v_sd,v_j);
    SET LOCAL session_replication_role = origin;
    r := public.cabut_potongan_saudara(v_sd,'2027-06-01','UJI03 T5',v_admin);
    PERFORM pg_temp.cek('T5 tahun buku tertutup: tidak error, ditandai admin, tanpa tagihan/jurnal koreksi',
      (r->>'ditandai_admin')::int=1
      AND EXISTS(SELECT 1 FROM log_potongan_saudara WHERE siswa_id=b AND aksi='tandai_admin' AND alasan ILIKE '%ditutup%')
      AND NOT EXISTS(SELECT 1 FROM tagihan x JOIN jenis_pembayaran jp ON jp.id=x.jenis_id WHERE x.siswa_id=b AND jp.nama LIKE 'Koreksi Potongan Saudara%')
      AND NOT EXISTS(SELECT 1 FROM jurnal WHERE referensi LIKE 'KOREKSI-SAUDARA:'||v_sd||':%'),
      r::text);
    PERFORM pg_temp.cek('T5 baris potongan tetap dipangkas',
      (SELECT status FROM siswa_diskon WHERE id=v_sd)='dibatalkan');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cek('T5 dieksekusi tanpa error', false, SQLERRM);
  END;
END $t5$;

DO $ringkas$
BEGIN
  IF EXISTS (SELECT 1 FROM hasil03 WHERE NOT ok) THEN
    RAISE EXCEPTION E'UJI 03 GAGAL (% dari % pemeriksaan):\n%',
      (SELECT count(*) FROM hasil03 WHERE NOT ok), (SELECT count(*) FROM hasil03),
      (SELECT string_agg(format(' - %s%s', label, COALESCE(' => '||detail,'')), E'\n') FROM hasil03 WHERE NOT ok);
  END IF;
  RAISE NOTICE 'UJI 03 LULUS: % pemeriksaan', (SELECT count(*) FROM hasil03);
END $ringkas$;
