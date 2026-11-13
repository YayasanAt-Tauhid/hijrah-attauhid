-- UJI 01: jumlah_saudara_aktif(keluarga, bulan) dihitung PER BULAN SPP.
-- Aturan: aktif di bulan M = terdaftar di hari mana pun pada bulan M, lintas lembaga.
DO $uji$
DECLARE
  d_sd uuid; d_smp uuid;
  f1 constant uuid := '00000000-0000-0000-0001-000000000001';
  f2 constant uuid := '00000000-0000-0000-0001-000000000002';
  f3 constant uuid := '00000000-0000-0000-0001-000000000003';
  f4 constant uuid := '00000000-0000-0000-0001-000000000004';
  f5 constant uuid := '00000000-0000-0000-0001-000000000005';
BEGIN
  SELECT id INTO d_sd  FROM departemen ORDER BY nama LIMIT 1;
  SELECT id INTO d_smp FROM departemen ORDER BY nama DESC LIMIT 1;
  IF d_sd = d_smp THEN RAISE EXCEPTION 'uji butuh 2 departemen berbeda'; END IF;

  INSERT INTO keluarga(id,nama) VALUES (f1,'UJI F1'),(f2,'UJI F2'),(f3,'UJI F3'),(f4,'UJI F4'),(f5,'UJI F5');

  -- F1: kasus Thariq/Thaha/Shofea
  INSERT INTO siswa(id,nama,status,keluarga_id,departemen_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
   ('00000000-0000-0000-0002-000000000001','UJI Thariq','alumni',  f1,d_sd,NULL,        '2027-06-30'),
   ('00000000-0000-0000-0002-000000000002','UJI Thaha', 'aktif',   f1,d_sd,NULL,        NULL),
   ('00000000-0000-0000-0002-000000000003','UJI Shofea','diterima',f1,d_sd,'2027-07-01',NULL);
  -- F2: keluar di tengah bulan
  INSERT INTO siswa(id,nama,status,keluarga_id,departemen_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
   ('00000000-0000-0000-0002-000000000004','UJI D','keluar',f2,d_sd,NULL,'2027-03-14'),
   ('00000000-0000-0000-0002-000000000005','UJI E','aktif', f2,d_sd,NULL,NULL);
  -- F3: alumni lama tanpa tanggal akhir tidak dihitung
  INSERT INTO siswa(id,nama,status,keluarga_id,departemen_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
   ('00000000-0000-0000-0002-000000000006','UJI G','alumni',f3,d_sd,NULL,NULL),
   ('00000000-0000-0000-0002-000000000007','UJI H','aktif', f3,d_sd,NULL,NULL);
  -- F4: lintas lembaga
  INSERT INTO siswa(id,nama,status,keluarga_id,departemen_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
   ('00000000-0000-0000-0002-000000000008','UJI I','aktif',f4,d_sd, NULL,NULL),
   ('00000000-0000-0000-0002-000000000009','UJI J','aktif',f4,d_smp,NULL,NULL);
  -- F5: calon (belum diterima) tidak dihitung walau tanggal mulai terisi
  INSERT INTO siswa(id,nama,status,keluarga_id,departemen_id,tanggal_mulai_aktif,tanggal_akhir_aktif) VALUES
   ('00000000-0000-0000-0002-000000000010','UJI K','aktif',f5,d_sd,NULL,NULL),
   ('00000000-0000-0000-0002-000000000011','UJI L','calon',f5,d_sd,'2027-07-01',NULL);

  CREATE TEMP TABLE hasil_uji(label text, want int, got int) ON COMMIT DROP;
  INSERT INTO hasil_uji(label,want,got) VALUES
   ('F1 Jan 2027: Thariq+Thaha (Shofea belum masuk)',  2, public.jumlah_saudara_aktif(f1,'2027-01-01')),
   ('F1 Jun 2027: Thariq masih aktif, Shofea belum',   2, public.jumlah_saudara_aktif(f1,'2027-06-01')),
   ('F1 Jul 2027: Thaha+Shofea (Thariq sudah lulus)',  2, public.jumlah_saudara_aktif(f1,'2027-07-01')),
   ('F1 Agu 2027: Thaha+Shofea',                       2, public.jumlah_saudara_aktif(f1,'2027-08-15')),
   ('F2 Mar 2027: keluar 14 Mar tetap dihitung',       2, public.jumlah_saudara_aktif(f2,'2027-03-01')),
   ('F2 Apr 2027: tinggal 1',                          1, public.jumlah_saudara_aktif(f2,'2027-04-01')),
   ('F3 alumni tanpa tanggal tidak dihitung',          1, public.jumlah_saudara_aktif(f3,'2027-01-01')),
   ('F4 lintas lembaga SD+SMP',                        2, public.jumlah_saudara_aktif(f4,'2027-01-01')),
   ('F5 calon tidak dihitung',                         1, public.jumlah_saudara_aktif(f5,'2027-08-01'));

  IF EXISTS (SELECT 1 FROM hasil_uji h WHERE h.want IS DISTINCT FROM h.got) THEN
    RAISE EXCEPTION 'UJI 01 GAGAL: %', (SELECT string_agg(format('%s (harap %s, dapat %s)',h.label,h.want,h.got),'; ') FROM hasil_uji h WHERE h.want IS DISTINCT FROM h.got);
  END IF;
  RAISE NOTICE 'UJI 01 LULUS: % skenario', (SELECT count(*) FROM hasil_uji);
END
$uji$;
