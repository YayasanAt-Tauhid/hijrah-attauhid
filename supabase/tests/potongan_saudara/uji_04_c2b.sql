-- UJI 04: sinkronisasi per bulan, akademik_nonaktifkan_siswa, pemicu perubahan siswa, pemeriksaan ulang harian.
CREATE TEMP TABLE hasil04(skenario text, ok boolean, pesan text) ON COMMIT DROP;

-- K1: kasus Thaha + Shofea: adik berstatus diterima, mulai 1 Jul 2027 -> pada Juli keduanya mendapat potongan
DO $k1$
DECLARE v_jenis uuid; v_skema uuid; v_res jsonb; n int;
  f constant uuid := '00000000-0000-0000-0005-000000000001';
  a constant uuid := '00000000-0000-0000-0005-0000000000a1';
  b constant uuid := '00000000-0000-0000-0005-0000000000a2';
BEGIN
  BEGIN
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 K1');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_mulai_aktif) VALUES (a,'UJI04 Thaha','aktif',f,NULL),(b,'UJI04 Shofea','diterima',f,'2027-07-01');
    INSERT INTO rencana_tagihan_siswa(siswa_id,jenis_id,nominal,mulai,selesai) VALUES (a,v_jenis,450000,'2027-07-01','2027-12-31'),(b,v_jenis,450000,'2027-07-01','2027-12-31');
    SET LOCAL session_replication_role = origin;

    v_res := public.sinkronkan_diskon_kakak_adik_keluarga(f,'2027-07-15');
    SELECT count(*) INTO n FROM siswa_diskon WHERE siswa_id IN (a,b) AND skema_diskon_id=v_skema AND status='disetujui' AND periode_mulai='2027-07-01';
    IF n<>2 THEN RAISE EXCEPTION 'Juli: kedua anak harus mendapat potongan (dapat %), hasil=%', n, v_res; END IF;
    INSERT INTO hasil04 VALUES ('K1 adik diterima mulai Juli dihitung aktif pada bulan Juli', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('K1 adik diterima mulai Juli dihitung aktif pada bulan Juli', false, SQLERRM);
  END;
END $k1$;

-- K2: adik baru mulai Agustus -> pada Juli kakak sendirian, tidak ada potongan
DO $k2$
DECLARE v_jenis uuid; v_skema uuid; v_res jsonb; n int;
  f constant uuid := '00000000-0000-0000-0005-000000000002';
  a constant uuid := '00000000-0000-0000-0005-0000000000b1';
  b constant uuid := '00000000-0000-0000-0005-0000000000b2';
BEGIN
  BEGIN
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 K2');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_mulai_aktif) VALUES (a,'UJI04 K2 kakak','aktif',f,NULL),(b,'UJI04 K2 adik','diterima',f,'2027-08-01');
    INSERT INTO rencana_tagihan_siswa(siswa_id,jenis_id,nominal,mulai,selesai) VALUES (a,v_jenis,450000,'2027-07-01','2027-12-31'),(b,v_jenis,450000,'2027-08-01','2027-12-31');
    SET LOCAL session_replication_role = origin;

    v_res := public.sinkronkan_diskon_kakak_adik_keluarga(f,'2027-07-15');
    SELECT count(*) INTO n FROM siswa_diskon WHERE siswa_id IN (a,b) AND skema_diskon_id=v_skema AND status IN ('diajukan','disetujui');
    IF n<>0 THEN RAISE EXCEPTION 'Juli: tidak boleh ada potongan (dapat %)', n; END IF;
    INSERT INTO hasil04 VALUES ('K2 adik mulai Agustus: Juli belum ada potongan', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('K2 adik mulai Agustus: Juli belum ada potongan', false, SQLERRM);
  END;
END $k2$;

-- K3: saudara yang sudah alumni (akhir 31 Jul 2027) masih dihitung pada bulan Juli
DO $k3$
DECLARE v_jenis uuid; v_skema uuid; v_res jsonb; n int;
  f constant uuid := '00000000-0000-0000-0005-000000000003';
  a constant uuid := '00000000-0000-0000-0005-0000000000c1';
  b constant uuid := '00000000-0000-0000-0005-0000000000c2';
BEGIN
  BEGIN
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 K3');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_akhir_aktif) VALUES (a,'UJI04 K3 alumni','alumni',f,'2027-07-31'),(b,'UJI04 K3 adik','aktif',f,NULL);
    INSERT INTO rencana_tagihan_siswa(siswa_id,jenis_id,nominal,mulai,selesai) VALUES (b,v_jenis,450000,'2027-07-01','2027-12-31');
    SET LOCAL session_replication_role = origin;

    v_res := public.sinkronkan_diskon_kakak_adik_keluarga(f,'2027-07-15');
    SELECT count(*) INTO n FROM siswa_diskon WHERE siswa_id=b AND skema_diskon_id=v_skema AND status='disetujui' AND periode_mulai='2027-07-01';
    IF n<>1 THEN RAISE EXCEPTION 'adik harus mendapat potongan Juli karena kakak masih aktif sampai 31 Jul (dapat %), hasil=%', n, v_res; END IF;
    -- Agustus: kakak sudah tidak aktif -> tidak ada potongan baru
    v_res := public.sinkronkan_diskon_kakak_adik_keluarga(f,'2027-08-15');
    SELECT count(*) INTO n FROM siswa_diskon WHERE siswa_id=b AND skema_diskon_id=v_skema AND status IN ('diajukan','disetujui') AND periode_mulai='2027-08-01';
    IF n<>0 THEN RAISE EXCEPTION 'Agustus: kakak sudah keluar, tidak boleh ada potongan (dapat %)', n; END IF;
    INSERT INTO hasil04 VALUES ('K3 alumni dihitung sampai bulan terakhirnya saja', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('K3 alumni dihitung sampai bulan terakhirnya saja', false, SQLERRM);
  END;
END $k3$;

-- N1: akademik_nonaktifkan_siswa: potongan LAIN milik siswa yang diakhiri dipangkas tanpa melanggar aturan "disetujui tidak boleh diubah"
DO $n1$
DECLARE v_admin uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); v_new uuid;
  f constant uuid := '00000000-0000-0000-0005-000000000011';
  x constant uuid := '00000000-0000-0000-0005-0000000000d1';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Keringanan Khusus';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 N1');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (x,'UJI04 N1 X','aktif',f),('00000000-0000-0000-0005-0000000000d2','UJI04 N1 Y','aktif',f),('00000000-0000-0000-0005-0000000000d3','UJI04 N1 Z','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,x,v_skema,v_jenis,'2027-01-01','2027-12-31',100000,'disetujui',now(),now(),'nominal',100000);
    SET LOCAL session_replication_role = origin;
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin)::text, true);

    PERFORM public.akademik_nonaktifkan_siswa(ARRAY[x],'alumni','2027-06-01','Uji lulus Juni 2027');

    IF (SELECT status FROM siswa_diskon WHERE id=v_row) <> 'dibatalkan' THEN RAISE EXCEPTION 'baris lama harus dibatalkan'; END IF;
    SELECT id INTO v_new FROM siswa_diskon WHERE siswa_id=x AND status='disetujui';
    IF v_new IS NULL THEN RAISE EXCEPTION 'baris awalan (Jan-Mei) tidak dibuat'; END IF;
    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE id=v_new AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31' AND nilai=100000) THEN
      RAISE EXCEPTION 'periode/nilai baris awalan salah'; END IF;
    IF (SELECT tanggal_akhir_aktif FROM siswa WHERE id=x) IS DISTINCT FROM DATE '2027-05-31' THEN
      RAISE EXCEPTION 'tanggal_akhir_aktif harus 2027-05-31'; END IF;
    INSERT INTO hasil04 VALUES ('N1 nonaktifkan: potongan lain siswa dipangkas via batal+buat baru', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('N1 nonaktifkan: potongan lain siswa dipangkas via batal+buat baru', false, SQLERRM);
  END;
END $n1$;

-- N2: akademik_nonaktifkan_siswa: sisa 1 aktif -> potongan saudara dicabut mulai bulan efektif, histori Jan-Mei utuh, tercatat di log
DO $n2$
DECLARE v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0005-000000000012';
  a constant uuid := '00000000-0000-0000-0005-0000000000e1';
  b constant uuid := '00000000-0000-0000-0005-0000000000e2';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 N2');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI04 N2 A','aktif',f),(b,'UJI04 N2 B','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_admin)::text, true);

    PERFORM public.akademik_nonaktifkan_siswa(ARRAY[a],'alumni','2027-06-01','Uji lulus Juni 2027');

    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo<'2027-06-01' AND nominal_diskon=50000 AND nominal=400000;
    IF n<>5 THEN RAISE EXCEPTION 'tagihan Jan-Mei harus tetap berpotongan (dapat %)', n; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo>='2027-06-01' AND nominal_diskon=0 AND nominal=450000 AND siswa_diskon_id IS NULL;
    IF n<>7 THEN RAISE EXCEPTION 'tagihan Jun-Des harus kembali bruto (dapat %)', n; END IF;
    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE siswa_id=b AND status='disetujui' AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31') THEN
      RAISE EXCEPTION 'baris awalan Jan-Mei tidak ada'; END IF;
    SELECT count(*) INTO n FROM log_potongan_saudara WHERE siswa_id=b AND aksi='cabut_terjadwal';
    IF n<>7 THEN RAISE EXCEPTION 'log cabut_terjadwal harus 7 baris (dapat %)', n; END IF;
    INSERT INTO hasil04 VALUES ('N2 nonaktifkan: potongan saudara dicabut mulai bulan efektif + log', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('N2 nonaktifkan: potongan saudara dicabut mulai bulan efektif + log', false, SQLERRM);
  END;
END $n2$;

-- T1: pemicu: siswa dikeluarkan dari keluarga -> potongan saudara yang tersisa dicabut
DO $t1$
DECLARE v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0005-000000000021';
  a constant uuid := '00000000-0000-0000-0005-0000000000f1';
  b constant uuid := '00000000-0000-0000-0005-0000000000f2';
BEGIN
  BEGIN
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 T1');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI04 T1 A','aktif',f),(b,'UJI04 T1 B','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    UPDATE siswa SET keluarga_id=NULL WHERE id=a;

    SELECT count(*) INTO n FROM siswa_diskon WHERE siswa_id=b AND skema_diskon_id=v_skema AND status IN ('diajukan','disetujui');
    IF n<>0 THEN RAISE EXCEPTION 'potongan adik harus dicabut (masih % baris berlaku)', n; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND nominal_diskon=0 AND nominal=450000 AND siswa_diskon_id IS NULL;
    IF n<>12 THEN RAISE EXCEPTION '12 tagihan harus kembali bruto (dapat %)', n; END IF;
    INSERT INTO hasil04 VALUES ('T1 pemicu: keluar dari keluarga mencabut potongan saudara', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('T1 pemicu: keluar dari keluarga mencabut potongan saudara', false, SQLERRM);
  END;
END $t1$;

-- T2: pemicu: status diubah langsung menjadi keluar dengan tanggal akhir 31 Mei 2027 -> potongan saudara dicabut mulai Juni
DO $t2$
DECLARE v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0005-000000000022';
  a constant uuid := '00000000-0000-0000-0005-000000000a01';
  b constant uuid := '00000000-0000-0000-0005-000000000a02';
BEGIN
  BEGIN
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 T2');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI04 T2 A','aktif',f),(b,'UJI04 T2 B','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    UPDATE siswa SET status='keluar', tanggal_akhir_aktif='2027-05-31' WHERE id=a;

    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo<'2027-06-01' AND nominal_diskon=50000 AND nominal=400000;
    IF n<>5 THEN RAISE EXCEPTION 'tagihan Jan-Mei harus tetap berpotongan (dapat %)', n; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo>='2027-06-01' AND nominal_diskon=0 AND nominal=450000 AND siswa_diskon_id IS NULL;
    IF n<>7 THEN RAISE EXCEPTION 'tagihan Jun-Des harus kembali bruto (dapat %)', n; END IF;
    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE siswa_id=b AND status='disetujui' AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31') THEN
      RAISE EXCEPTION 'baris awalan Jan-Mei tidak ada'; END IF;
    INSERT INTO hasil04 VALUES ('T2 pemicu: status keluar + tanggal akhir mencabut mulai bulan berikutnya', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('T2 pemicu: status keluar + tanggal akhir mencabut mulai bulan berikutnya', false, SQLERRM);
  END;
END $t2$;

-- T3 (negatif): keluarga 3 anak aktif, satu keluar -> potongan dua anak lain tidak disentuh
DO $t3$
DECLARE v_ta uuid; v_jenis uuid; v_skema uuid; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0005-000000000023';
  a constant uuid := '00000000-0000-0000-0005-000000000b01';
  b constant uuid := '00000000-0000-0000-0005-000000000b02';
  c constant uuid := '00000000-0000-0000-0005-000000000b03';
BEGIN
  BEGIN
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 T3');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI04 T3 A','aktif',f),(b,'UJI04 T3 B','aktif',f),(c,'UJI04 T3 C','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (r1,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000),
             (r2,c,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,r1 FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    UPDATE siswa SET status='keluar', tanggal_akhir_aktif='2027-05-31' WHERE id=a;

    SELECT count(*) INTO n FROM siswa_diskon WHERE id IN (r1,r2) AND status='disetujui' AND periode_selesai='2027-12-31';
    IF n<>2 THEN RAISE EXCEPTION 'potongan dua anak yang tersisa tidak boleh berubah (utuh=%)', n; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND nominal_diskon=50000 AND nominal=400000;
    IF n<>12 THEN RAISE EXCEPTION 'tagihan harus tetap berpotongan (dapat %)', n; END IF;
    IF EXISTS (SELECT 1 FROM log_potongan_saudara WHERE siswa_id IN (b,c)) THEN RAISE EXCEPTION 'tidak boleh ada log pencabutan'; END IF;
    INSERT INTO hasil04 VALUES ('T3 keluarga masih >=2 aktif: potongan tidak disentuh', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('T3 keluarga masih >=2 aktif: potongan tidak disentuh', false, SQLERRM);
  END;
END $t3$;

-- D1: pemeriksaan ulang harian memperbaiki kondisi yang lolos (pemicu dimatikan) dan idempoten
DO $d1$
DECLARE v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); n int; n2 int; v_res jsonb;
  f constant uuid := '00000000-0000-0000-0005-000000000031';
  a constant uuid := '00000000-0000-0000-0005-000000000c01';
  b constant uuid := '00000000-0000-0000-0005-000000000c02';
BEGIN
  BEGIN
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI04 D1');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_akhir_aktif) VALUES (a,'UJI04 D1 A','keluar',f,'2027-05-31'),(b,'UJI04 D1 B','aktif',f,NULL);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    v_res := public.tinjau_potongan_saudara_semua('2027-01-01');
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo>='2027-06-01' AND nominal_diskon=0 AND nominal=450000 AND siswa_diskon_id IS NULL;
    IF n<>7 THEN RAISE EXCEPTION 'tagihan Jun-Des harus kembali bruto (dapat %), hasil=%', n, v_res; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo<'2027-06-01' AND nominal_diskon=50000;
    IF n<>5 THEN RAISE EXCEPTION 'tagihan Jan-Mei harus utuh (dapat %)', n; END IF;
    SELECT count(*) INTO n FROM log_potongan_saudara WHERE siswa_id=b;
    v_res := public.tinjau_potongan_saudara_semua('2027-01-01');
    SELECT count(*) INTO n2 FROM log_potongan_saudara WHERE siswa_id=b;
    IF n2<>n THEN RAISE EXCEPTION 'pemeriksaan kedua tidak boleh menambah log (% -> %)', n, n2; END IF;
    INSERT INTO hasil04 VALUES ('D1 pemeriksaan harian memperbaiki kondisi lolos dan idempoten', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('D1 pemeriksaan harian memperbaiki kondisi lolos dan idempoten', false, SQLERRM);
  END;
END $d1$;

-- D2: hak akses fungsi baru hanya service_role
DO $d2$
BEGIN
  BEGIN
    IF has_function_privilege('anon','public.tinjau_potongan_saudara_semua(date)','EXECUTE')
       OR has_function_privilege('authenticated','public.tinjau_potongan_saudara_semua(date)','EXECUTE')
       OR has_function_privilege('anon','public.tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean)','EXECUTE')
       OR has_function_privilege('authenticated','public.tinjau_potongan_saudara(uuid,date,uuid,uuid,text,boolean)','EXECUTE') THEN
      RAISE EXCEPTION 'anon/authenticated tidak boleh mengeksekusi'; END IF;
    IF NOT has_function_privilege('service_role','public.tinjau_potongan_saudara_semua(date)','EXECUTE') THEN
      RAISE EXCEPTION 'service_role harus bisa mengeksekusi'; END IF;
    INSERT INTO hasil04 VALUES ('D2 hak akses fungsi tinjau hanya service_role', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil04 VALUES ('D2 hak akses fungsi tinjau hanya service_role', false, SQLERRM);
  END;
END $d2$;

DO $ringkas$
BEGIN
  IF EXISTS (SELECT 1 FROM hasil04 WHERE NOT ok) THEN
    RAISE EXCEPTION E'UJI 04 GAGAL:\n%', (SELECT string_agg(format(' - %s => %s', skenario, pesan), E'\n') FROM hasil04 WHERE NOT ok);
  END IF;
  RAISE NOTICE 'UJI 04 LULUS: % skenario', (SELECT count(*) FROM hasil04);
END $ringkas$;
