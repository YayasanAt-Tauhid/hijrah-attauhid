-- UJI: public.ringkasan_tagihan_periode(p_tgl_awal, p_tgl_akhir, p_departemen_id)
-- Ringkasan tagihan SPP per lembaga x bulan (bulan = bulan jatuh_tempo), dasar halaman
-- "Proyeksi Tagihan SPP". Hanya membaca; tagihan dibatalkan dan jenis non-SPP tidak dihitung.
--
-- Jalankan di salinan database (BUKAN produksi), dibungkus BEGIN ... ROLLBACK, mis.:
--   { echo 'BEGIN;'; cat uji_ringkasan_tagihan_periode.sql; echo 'ROLLBACK;'; } \
--     | sudo docker exec -i rustbase-deploy-postgres-1 psql -U rustbase -X -v ON_ERROR_STOP=1 -d <db_salinan>
-- Prasyarat: skema produksi sudah ada di salinan, dan migrasi fungsi ini sudah diterapkan di sana.
-- Fixture memakai awalan UUID 00000000-0000-0000-0a0x-... dan trigger dimatikan sementara
-- (session_replication_role = replica) hanya saat mengisi fixture, karena yang diuji adalah
-- agregasinya, bukan trigger tagihan.
DO $uji$
DECLARE
  d_a  constant uuid := '00000000-0000-0000-0a01-000000000001';
  d_b  constant uuid := '00000000-0000-0000-0a01-000000000002';
  j_spp_a     constant uuid := '00000000-0000-0000-0a02-000000000001';
  j_spp_b     constant uuid := '00000000-0000-0000-0a02-000000000002';
  j_pangkal_a constant uuid := '00000000-0000-0000-0a02-000000000003';
  j_saldo_a   constant uuid := '00000000-0000-0000-0a02-000000000004';
  s1 constant uuid := '00000000-0000-0000-0a03-000000000001';
  s2 constant uuid := '00000000-0000-0000-0a03-000000000002';
  s3 constant uuid := '00000000-0000-0000-0a03-000000000003';
  s4 constant uuid := '00000000-0000-0000-0a03-000000000004';
  tb  constant uuid := '00000000-0000-0000-0a04-000000000001';
  tb2 constant uuid := '00000000-0000-0000-0a04-000000000002';
  u_admin constant uuid := '00000000-0000-0000-0a05-000000000001';
  u_keu   constant uuid := '00000000-0000-0000-0a05-000000000002';
  u_ortu  constant uuid := '00000000-0000-0000-0a05-000000000003';
  t_s1_feb constant uuid := '00000000-0000-0000-0a06-000000000001';
  t_s2_feb constant uuid := '00000000-0000-0000-0a06-000000000002';
  r text;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO departemen(id, nama, kode) VALUES
    (d_a, 'UJI PROYEKSI A', 'UJA'),
    (d_b, 'UJI PROYEKSI B', 'UJB');
  INSERT INTO tahun_buku(id, nama, tanggal_mulai, tanggal_selesai) VALUES
    (tb,  'UJI TAHUN 2027', '2027-01-01', '2027-12-31'),
    (tb2, 'UJI TAHUN 2028', '2028-01-01', '2028-12-31');
  INSERT INTO jenis_pembayaran(id, nama, tipe, departemen_id, aktif) VALUES
    (j_spp_a,     'SPP UJI A',               'bulanan', d_a, true),
    (j_spp_b,     'SPP UJI B',               'bulanan', d_b, true),
    (j_pangkal_a, 'UANG PANGKAL UJI A',      'sekali',  d_a, true),
    (j_saldo_a,   'SALDO SPP LAMA UJI A',    'sekali',  d_a, false);
  INSERT INTO siswa(id, nama, status, departemen_id) VALUES
    (s1, 'UJI S1', 'aktif', d_a), (s2, 'UJI S2', 'aktif', d_a),
    (s3, 'UJI S3', 'aktif', d_a), (s4, 'UJI S4', 'aktif', d_b);

  -- A Jan 2027: 2 tagihan SPP valid (2 siswa), 1 dibatalkan, 1 non-SPP, 1 saldo lama
  -- (skema melarang dua tagihan siswa+jenis+tahun+bulan yang sama: tagihan_unique)
  INSERT INTO tagihan(siswa_id, jenis_id, tahun_ajaran_id, bulan, status, jatuh_tempo, nominal_bruto, nominal_diskon, nominal) VALUES
    (s1, j_spp_a,     tb, 1, 'terjadwal', '2027-01-10',  400000, 50000,  350000),
    (s2, j_spp_a,     tb, 1, 'terjadwal', '2027-01-10',  400000, 0,      400000),
    (s3, j_spp_a,     tb, 1, 'dibatalkan','2027-01-10',  400000, 0,      400000),
    (s1, j_pangkal_a, tb, 1, 'terjadwal', '2027-01-10', 1000000, 0,     1000000),
    (s2, j_saldo_a,   tb, 1, 'terjadwal', '2027-01-01',  250000, 0,      250000);
  -- A Feb 2027: satu sebagian (bayar 150000), satu lunas (bayar 400000)
  INSERT INTO tagihan(id, siswa_id, jenis_id, tahun_ajaran_id, bulan, status, jatuh_tempo, nominal_bruto, nominal_diskon, nominal) VALUES
    (t_s1_feb, s1, j_spp_a, tb, 2, 'sebagian', '2027-02-10', 400000, 0, 400000),
    (t_s2_feb, s2, j_spp_a, tb, 2, 'lunas',    '2027-02-10', 400000, 0, 400000);
  INSERT INTO pembayaran(siswa_id, jenis_id, tahun_ajaran_id, bulan, jumlah, tanggal_bayar, tagihan_id, departemen_id) VALUES
    (s1, j_spp_a, tb, 2, 150000, '2027-02-05', t_s1_feb, d_a),
    (s2, j_spp_a, tb, 2, 400000, '2027-02-05', t_s2_feb, d_a);
  -- B Jan 2027
  INSERT INTO tagihan(siswa_id, jenis_id, tahun_ajaran_id, bulan, status, jatuh_tempo, nominal_bruto, nominal_diskon, nominal) VALUES
    (s4, j_spp_b, tb, 1, 'terjadwal', '2027-01-10', 500000, 0, 500000);
  -- A Jan 2028 (di luar rentang 2027)
  INSERT INTO tagihan(siswa_id, jenis_id, tahun_ajaran_id, bulan, status, jatuh_tempo, nominal_bruto, nominal_diskon, nominal) VALUES
    (s1, j_spp_a, tb2, 1, 'terjadwal', '2028-01-10', 400000, 0, 400000);

  -- pengguna uji (peran dibaca dari users_profile; auth.uid() dari klaim JWT)
  INSERT INTO auth.users(id) VALUES (u_admin), (u_keu), (u_ortu);
  INSERT INTO users_profile(id, role, aktif) VALUES
    (u_admin, 'admin', true), (u_keu, 'keuangan', true), (u_ortu, 'ortu', true);

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);

  CREATE TEMP TABLE hasil_uji(label text, want text, got text) ON COMMIT DROP;

  INSERT INTO hasil_uji(label, want, got) VALUES
   ('semua lembaga 2027: 3 baris (A Jan, A Feb, B Jan)', '3',
      (SELECT count(*)::text FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31'))),
   ('total neto 2027 = 2050000 (dibatalkan, non-SPP, saldo lama tidak dihitung)', '2050000',
      (SELECT sum(neto)::bigint::text FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31'))),
   ('A Jan: tagihan|siswa|bruto|potongan|neto|terbayar|sisa', '2|2|800000|50000|750000|0|750000',
      (SELECT format('%s|%s|%s|%s|%s|%s|%s', jumlah_tagihan, jumlah_siswa, bruto::bigint, potongan::bigint, neto::bigint, terbayar::bigint, sisa::bigint)
         FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31') WHERE departemen_id = d_a AND tahun = 2027 AND bulan = 1)),
   ('A Feb: sebagian + lunas, terbayar dari pembayaran', '2|2|800000|0|800000|550000|250000',
      (SELECT format('%s|%s|%s|%s|%s|%s|%s', jumlah_tagihan, jumlah_siswa, bruto::bigint, potongan::bigint, neto::bigint, terbayar::bigint, sisa::bigint)
         FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31') WHERE departemen_id = d_a AND tahun = 2027 AND bulan = 2)),
   ('B Jan', '1|1|500000|0|500000|0|500000',
      (SELECT format('%s|%s|%s|%s|%s|%s|%s', jumlah_tagihan, jumlah_siswa, bruto::bigint, potongan::bigint, neto::bigint, terbayar::bigint, sisa::bigint)
         FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31') WHERE departemen_id = d_b AND tahun = 2027 AND bulan = 1)),
   ('kode lembaga ikut dikembalikan', 'UJA',
      (SELECT departemen_kode FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31') WHERE departemen_id = d_a AND bulan = 1)),
   ('filter lembaga A: 2 baris', '2',
      (SELECT count(*)::text FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31', d_a))),
   ('filter lembaga A: tidak ada baris lembaga B', '0',
      (SELECT count(*)::text FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31', d_a) WHERE departemen_id = d_b)),
   ('rentang 2028: baris|tahun|bulan|neto', '1|2028|1|400000',
      (SELECT format('%s|%s|%s|%s', count(*) OVER (), tahun, bulan, neto::bigint)
         FROM public.ringkasan_tagihan_periode('2028-01-01', '2028-12-31') LIMIT 1));

  -- penjaga peran: admin dan keuangan boleh, ortu dan tanpa login ditolak
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_keu)::text, true);
  PERFORM 1 FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31');
  INSERT INTO hasil_uji VALUES ('peran keuangan boleh', 'ok', 'ok');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_ortu)::text, true);
  BEGIN
    PERFORM 1 FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31');
    r := 'ok';
  EXCEPTION WHEN raise_exception THEN r := 'ditolak';
  END;
  INSERT INTO hasil_uji VALUES ('peran ortu ditolak', 'ditolak', r);

  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM 1 FROM public.ringkasan_tagihan_periode('2027-01-01', '2027-12-31');
    r := 'ok';
  EXCEPTION WHEN raise_exception THEN r := 'ditolak';
  END;
  INSERT INTO hasil_uji VALUES ('tanpa login ditolak', 'ditolak', r);

  -- hak eksekusi: anon tidak, authenticated dan service_role boleh
  INSERT INTO hasil_uji(label, want, got) VALUES
   ('anon tidak boleh EXECUTE', 'false',
      has_function_privilege('anon', 'public.ringkasan_tagihan_periode(date,date,uuid)', 'EXECUTE')::text),
   ('authenticated boleh EXECUTE', 'true',
      has_function_privilege('authenticated', 'public.ringkasan_tagihan_periode(date,date,uuid)', 'EXECUTE')::text),
   ('service_role boleh EXECUTE', 'true',
      has_function_privilege('service_role', 'public.ringkasan_tagihan_periode(date,date,uuid)', 'EXECUTE')::text);

  IF EXISTS (SELECT 1 FROM hasil_uji h WHERE h.want IS DISTINCT FROM h.got) THEN
    RAISE EXCEPTION 'UJI RINGKASAN TAGIHAN GAGAL: %',
      (SELECT string_agg(format('%s (harap %s, dapat %s)', h.label, h.want, coalesce(h.got, 'NULL')), '; ')
         FROM hasil_uji h WHERE h.want IS DISTINCT FROM h.got);
  END IF;
  RAISE NOTICE 'UJI RINGKASAN TAGIHAN LULUS: % pemeriksaan', (SELECT count(*) FROM hasil_uji);
END
$uji$;
