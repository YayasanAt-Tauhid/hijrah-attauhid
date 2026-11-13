-- UJI 02: akademik_akhiri_siswa + validasi potongan kakak-adik (per bulan, histori diskon utuh).
CREATE TEMP TABLE hasil02(skenario text, ok boolean, pesan text) ON COMMIT DROP;

-- S1: siswa yang keluar punya potongan LAIN yang sudah disetujui dan melewati tanggal efektif
DO $s1$
DECLARE v_admin uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); v_new uuid;
  f constant uuid := '00000000-0000-0000-0004-000000000001';
  x constant uuid := '00000000-0000-0000-0004-0000000000a1';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Keringanan Khusus';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI02 S1');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES
      (x,'UJI02 X','aktif',f),
      ('00000000-0000-0000-0004-0000000000a2','UJI02 Y','aktif',f),
      ('00000000-0000-0000-0004-0000000000a3','UJI02 Z','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,x,v_skema,v_jenis,'2027-01-01','2027-12-31',100000,'disetujui',now(),now(),'nominal',100000);
    SET LOCAL session_replication_role = origin;

    PERFORM public.akademik_akhiri_siswa(ARRAY[x],'alumni','2027-06-01',v_admin);

    IF (SELECT status FROM siswa_diskon WHERE id=v_row) <> 'dibatalkan' THEN RAISE EXCEPTION 'baris lama harus dibatalkan'; END IF;
    SELECT id INTO v_new FROM siswa_diskon WHERE siswa_id=x AND status='disetujui';
    IF v_new IS NULL THEN RAISE EXCEPTION 'baris awalan (Jan-Mei) tidak dibuat'; END IF;
    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE id=v_new AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31' AND nilai=100000) THEN
      RAISE EXCEPTION 'periode/nilai baris awalan salah'; END IF;
    INSERT INTO hasil02 VALUES ('S1 potongan lain milik siswa keluar dipangkas via batal+buat baru', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil02 VALUES ('S1 potongan lain milik siswa keluar dipangkas via batal+buat baru', false, SQLERRM);
  END;
END $s1$;

-- S2: dua bersaudara, satu lulus 1 Jun 2027 -> sisa 1 aktif -> potongan saudara berhenti mulai Jun
DO $s2$
DECLARE v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); v_new uuid; n int;
  f constant uuid := '00000000-0000-0000-0004-000000000002';
  a constant uuid := '00000000-0000-0000-0004-0000000000b1';
  b constant uuid := '00000000-0000-0000-0004-0000000000b2';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI02 S2');
    INSERT INTO siswa(id,nama,status,keluarga_id) VALUES (a,'UJI02 A','aktif',f),(b,'UJI02 B','aktif',f);
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2027-12-31',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    PERFORM public.akademik_akhiri_siswa(ARRAY[a],'alumni','2027-06-01',v_admin);

    SELECT id INTO v_new FROM siswa_diskon WHERE siswa_id=b AND status='disetujui';
    IF v_new IS NULL OR v_new = v_row THEN RAISE EXCEPTION 'baris awalan baru tidak dibuat'; END IF;
    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE id=v_new AND periode_mulai='2027-01-01' AND periode_selesai='2027-05-31') THEN
      RAISE EXCEPTION 'periode baris baru harus Jan-Mei 2027'; END IF;
    IF (SELECT status FROM siswa_diskon WHERE id=v_row) <> 'dibatalkan' THEN RAISE EXCEPTION 'baris lama harus dibatalkan'; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo<'2027-06-01' AND nominal_diskon=50000 AND nominal=400000 AND siswa_diskon_id=v_new;
    IF n<>5 THEN RAISE EXCEPTION 'tagihan Jan-Mei harus tetap berpotongan dan menunjuk baris baru (dapat %)', n; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND jatuh_tempo>='2027-06-01' AND nominal_diskon=0 AND nominal=450000 AND siswa_diskon_id IS NULL;
    IF n<>7 THEN RAISE EXCEPTION 'tagihan Jun-Des harus kembali bruto (dapat %)', n; END IF;
    IF (SELECT tanggal_akhir_aktif FROM siswa WHERE id=a) IS DISTINCT FROM DATE '2027-05-31' THEN
      RAISE EXCEPTION 'tanggal_akhir_aktif siswa yang diakhiri harus 2027-05-31'; END IF;
    INSERT INTO hasil02 VALUES ('S2 sisa 1 aktif: potongan saudara berhenti mulai bulan efektif', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil02 VALUES ('S2 sisa 1 aktif: potongan saudara berhenti mulai bulan efektif', false, SQLERRM);
  END;
END $s2$;

-- S3: kasus Thariq/Thaha/Shofea: kakak lulus 1 Jul 2027, calon adik mulai 1 Jul 2027 -> potongan Thaha TIDAK terputus
DO $s3$
DECLARE v_admin uuid; v_ta uuid; v_jenis uuid; v_skema uuid; v_row uuid := gen_random_uuid(); n int;
  f constant uuid := '00000000-0000-0000-0004-000000000003';
  a constant uuid := '00000000-0000-0000-0004-0000000000c1';
  b constant uuid := '00000000-0000-0000-0004-0000000000c2';
  c constant uuid := '00000000-0000-0000-0004-0000000000c3';
BEGIN
  BEGIN
    SELECT id INTO v_admin FROM auth.users WHERE public.has_role(id,'admin') LIMIT 1;
    SELECT id INTO v_ta FROM tahun_ajaran ORDER BY nama LIMIT 1;
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    SET LOCAL session_replication_role = replica;
    INSERT INTO keluarga(id,nama) VALUES (f,'UJI02 S3');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_mulai_aktif) VALUES
      (a,'UJI02 Kakak','aktif',f,NULL),(b,'UJI02 Tengah','aktif',f,NULL),(c,'UJI02 Calon','diterima',f,'2027-07-01');
    INSERT INTO siswa_diskon(id,siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status,diputuskan_at,diterapkan_at,tipe_snapshot,nilai_snapshot)
      VALUES (v_row,b,v_skema,v_jenis,'2027-01-01','2029-06-30',50000,'disetujui',now(),now(),'nominal',50000);
    INSERT INTO tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status,jatuh_tempo,nominal_bruto,nominal_diskon,siswa_diskon_id)
      SELECT b,v_jenis,v_ta,m,400000,'terjadwal',make_date(2027,m,10),450000,50000,v_row FROM generate_series(1,12) m;
    SET LOCAL session_replication_role = origin;

    PERFORM public.akademik_akhiri_siswa(ARRAY[a],'alumni','2027-07-01',v_admin);

    IF NOT EXISTS (SELECT 1 FROM siswa_diskon WHERE id=v_row AND status='disetujui' AND periode_mulai='2027-01-01' AND periode_selesai='2029-06-30') THEN
      RAISE EXCEPTION 'baris potongan Thaha harus utuh (masih ada 2 aktif sejak Juli: Thaha+Shofea)'; END IF;
    SELECT count(*) INTO n FROM tagihan WHERE siswa_id=b AND nominal_diskon=50000 AND siswa_diskon_id=v_row;
    IF n<>12 THEN RAISE EXCEPTION 'semua 12 tagihan harus tetap berpotongan (dapat %)', n; END IF;
    INSERT INTO hasil02 VALUES ('S3 kakak lulus Jun + calon adik masuk Jul: potongan tidak terputus', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil02 VALUES ('S3 kakak lulus Jun + calon adik masuk Jul: potongan tidak terputus', false, SQLERRM);
  END;
END $s3$;

-- S4: validasi baris potongan kakak-adik dihitung per bulan awal periode
DO $s4$
DECLARE v_jenis uuid; v_skema uuid; v_ditolak boolean;
  fa constant uuid := '00000000-0000-0000-0004-000000000004';
  fb constant uuid := '00000000-0000-0000-0004-000000000005';
  d  constant uuid := '00000000-0000-0000-0004-0000000000d1';
  e  constant uuid := '00000000-0000-0000-0004-0000000000d2';
  b  constant uuid := '00000000-0000-0000-0004-0000000000d3';
  c  constant uuid := '00000000-0000-0000-0004-0000000000d4';
BEGIN
  BEGIN
    SELECT id INTO v_jenis FROM jenis_pembayaran WHERE nama ILIKE 'SPP%' AND tipe='bulanan' AND aktif ORDER BY nama LIMIT 1;
    SELECT id INTO v_skema FROM skema_diskon WHERE nama='Potongan Kakak-Adik';
    INSERT INTO keluarga(id,nama) VALUES (fa,'UJI02 S4a'),(fb,'UJI02 S4b');
    INSERT INTO siswa(id,nama,status,keluarga_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
      (d,'UJI02 D','aktif',fa,NULL,NULL),(e,'UJI02 E','alumni',fa,NULL,'2027-01-31'),
      (b,'UJI02 B','aktif',fb,NULL,NULL),(c,'UJI02 C','diterima',fb,'2027-07-01',NULL);

    -- (a) Maret 2027 hanya D aktif -> harus ditolak
    v_ditolak := false;
    BEGIN INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status)
          VALUES (d,v_skema,v_jenis,'2027-03-01','2027-03-31',50000,'disetujui');
    EXCEPTION WHEN OTHERS THEN v_ditolak := true; END;
    IF NOT v_ditolak THEN RAISE EXCEPTION '(a) bulan dengan 1 aktif seharusnya ditolak'; END IF;

    -- (b) Januari 2027 D dan E sama-sama aktif -> harus lolos
    INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status)
      VALUES (d,v_skema,v_jenis,'2027-01-01','2027-01-31',50000,'disetujui');

    -- (c) calon C sebelum tanggal mulai -> harus ditolak
    v_ditolak := false;
    BEGIN INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status)
          VALUES (c,v_skema,v_jenis,'2027-05-01','2027-05-31',50000,'disetujui');
    EXCEPTION WHEN OTHERS THEN v_ditolak := true; END;
    IF NOT v_ditolak THEN RAISE EXCEPTION '(c) calon sebelum bulan mulai seharusnya ditolak'; END IF;

    -- (d) calon C mulai Juli 2027 bersama B aktif -> harus lolos
    INSERT INTO siswa_diskon(siswa_id,skema_diskon_id,jenis_id,periode_mulai,periode_selesai,nilai,status)
      VALUES (c,v_skema,v_jenis,'2027-07-01','2027-07-31',50000,'disetujui');
    INSERT INTO hasil02 VALUES ('S4 validasi potongan saudara per bulan awal periode', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hasil02 VALUES ('S4 validasi potongan saudara per bulan awal periode', false, SQLERRM);
  END;
END $s4$;

DO $ringkas$
BEGIN
  IF EXISTS (SELECT 1 FROM hasil02 WHERE NOT ok) THEN
    RAISE EXCEPTION E'UJI 02 GAGAL:\n%', (SELECT string_agg(format(' - %s => %s', skenario, pesan), E'\n') FROM hasil02 WHERE NOT ok);
  END IF;
  RAISE NOTICE 'UJI 02 LULUS: % skenario', (SELECT count(*) FROM hasil02);
END $ringkas$;
