-- Tes integrasi: log akrual harian (tabel akrual_harian_log + jalankan_akrual_harian_berlog).
-- JANGAN jalankan di produksi. Fungsi akrual lama diganti stub DI DALAM transaksi lalu di-ROLLBACK.
-- Catatan: semua baris dalam satu transaksi punya now() sama, jadi "baris terbaru" diambil dari urutan fisik (ctid).
-- Perintah cron tidak diuji di sini (clone tidak punya pg_cron); diverifikasi langsung di produksi setelah migrasi.
BEGIN;
CREATE TEMP TABLE hasil(nama text, ok boolean, detail text) ON COMMIT DROP;

DO $test$
DECLARE
  v_admin uuid := 'c65713ee-137f-431a-b383-391b7e7608d5';
  r jsonb; l public.akrual_harian_log; v_n integer; v_admin_baca integer; v_acak_baca integer;
BEGIN
  INSERT INTO hasil VALUES('tabel log ada', to_regclass('public.akrual_harian_log') IS NOT NULL, '');
  INSERT INTO hasil VALUES('fungsi berlog ada', to_regprocedure('public.jalankan_akrual_harian_berlog(date,uuid,integer,text)') IS NOT NULL, '');
  IF to_regclass('public.akrual_harian_log') IS NULL OR to_regprocedure('public.jalankan_akrual_harian_berlog(date,uuid,integer,text)') IS NULL THEN RETURN; END IF;

  -- a) hasil dengan 2 galat: dicatat, dan hasil asli diteruskan apa adanya
  CREATE OR REPLACE FUNCTION public.jalankan_akrual_jatuh_tempo(p_sampai_tanggal date DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS $stub$ SELECT jsonb_build_object('sampai_tanggal', current_date, 'piutang_diposting', 3, 'piutang_nominal', 1500000,
    'pendapatan_diakui', 2, 'pendapatan_nominal', 400000, 'errors', jsonb_build_array('Tagihan X: akun belum diset', 'Tagihan Y: SPP belum jurnal')) $stub$;
  SELECT count(*) INTO v_n FROM public.akrual_harian_log;
  r := public.jalankan_akrual_harian_berlog();
  SELECT * INTO l FROM public.akrual_harian_log ORDER BY ctid DESC LIMIT 1;
  INSERT INTO hasil VALUES('hasil asli diteruskan', r->>'piutang_diposting'='3' AND jsonb_array_length(r->'errors')=2, r::text);
  INSERT INTO hasil VALUES('log: angka & galat tercatat', (SELECT count(*) FROM public.akrual_harian_log)=v_n+1 AND l.piutang_diposting=3 AND l.piutang_nominal=1500000
    AND l.pendapatan_diakui=2 AND l.pendapatan_nominal=400000 AND l.jumlah_galat=2 AND jsonb_array_length(l.galat)=2 AND l.galat->>0='Tagihan X: akun belum diset'
    AND NOT l.gagal_total AND NOT l.galat_terpotong AND l.sumber='cron', to_jsonb(l)::text);

  -- b) tanpa galat
  CREATE OR REPLACE FUNCTION public.jalankan_akrual_jatuh_tempo(p_sampai_tanggal date DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS $stub$ SELECT jsonb_build_object('sampai_tanggal', current_date, 'piutang_diposting', 0, 'piutang_nominal', 0,
    'pendapatan_diakui', 0, 'pendapatan_nominal', 0, 'errors', '[]'::jsonb) $stub$;
  PERFORM public.jalankan_akrual_harian_berlog();
  SELECT * INTO l FROM public.akrual_harian_log ORDER BY ctid DESC LIMIT 1;
  INSERT INTO hasil VALUES('log: tanpa galat', l.jumlah_galat=0 AND l.galat='[]'::jsonb AND NOT l.gagal_total, to_jsonb(l)::text);

  -- c) 250 galat: jumlah asli dicatat, isi dipotong 200
  CREATE OR REPLACE FUNCTION public.jalankan_akrual_jatuh_tempo(p_sampai_tanggal date DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS $stub$ SELECT jsonb_build_object('sampai_tanggal', current_date, 'piutang_diposting', 0, 'piutang_nominal', 0,
    'pendapatan_diakui', 0, 'pendapatan_nominal', 0, 'errors', (SELECT jsonb_agg('galat ' || g) FROM generate_series(1,250) g)) $stub$;
  PERFORM public.jalankan_akrual_harian_berlog();
  SELECT * INTO l FROM public.akrual_harian_log ORDER BY ctid DESC LIMIT 1;
  INSERT INTO hasil VALUES('log: galat dipotong 200, jumlah asli tetap 250', l.jumlah_galat=250 AND jsonb_array_length(l.galat)=200 AND l.galat_terpotong, 'jumlah='||l.jumlah_galat||' isi='||jsonb_array_length(l.galat));

  -- d) fungsi akrual gagal total: tidak ikut gagal, kegagalan dicatat
  CREATE OR REPLACE FUNCTION public.jalankan_akrual_jatuh_tempo(p_sampai_tanggal date DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE plpgsql AS $stub$ BEGIN RAISE EXCEPTION 'Akun piutang siswa belum dikonfigurasi di Pengaturan Akun'; END $stub$;
  r := public.jalankan_akrual_harian_berlog();
  SELECT * INTO l FROM public.akrual_harian_log ORDER BY ctid DESC LIMIT 1;
  INSERT INTO hasil VALUES('kegagalan total dicatat dan tidak dilempar', (r->>'gagal_total')::boolean AND l.gagal_total AND l.jumlah_galat=1
    AND l.pesan_gagal LIKE '%Akun piutang siswa%' AND l.galat->>0 LIKE '%Akun piutang siswa%', r::text);

  -- e) tidak dapat diubah / dihapus
  BEGIN UPDATE public.akrual_harian_log SET jumlah_galat=0;
    INSERT INTO hasil VALUES('log tidak bisa diubah', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('log tidak bisa diubah', true, SQLERRM); END;
  BEGIN DELETE FROM public.akrual_harian_log;
    INSERT INTO hasil VALUES('log tidak bisa dihapus', false, 'lolos');
  EXCEPTION WHEN OTHERS THEN INSERT INTO hasil VALUES('log tidak bisa dihapus', true, SQLERRM); END;

  -- f) hak akses
  INSERT INTO hasil VALUES('anon & authenticated tidak bisa memanggil fungsi',
    NOT has_function_privilege('anon','public.jalankan_akrual_harian_berlog(date,uuid,integer,text)','execute')
    AND NOT has_function_privilege('authenticated','public.jalankan_akrual_harian_berlog(date,uuid,integer,text)','execute'), '');
  INSERT INTO hasil VALUES('service_role boleh memanggil fungsi', has_function_privilege('service_role','public.jalankan_akrual_harian_berlog(date,uuid,integer,text)','execute'), '');
  INSERT INTO hasil VALUES('authenticated tidak bisa menulis log, anon tidak bisa membaca',
    NOT has_table_privilege('authenticated','public.akrual_harian_log','insert') AND NOT has_table_privilege('anon','public.akrual_harian_log','select'), '');

  -- g) RLS: staf keuangan membaca, pengguna lain tidak melihat apa pun
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_admin_baca FROM public.akrual_harian_log;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SELECT count(*) INTO v_acak_baca FROM public.akrual_harian_log;
  EXECUTE 'RESET ROLE';
  INSERT INTO hasil VALUES('RLS: admin membaca, pengguna acak tidak', v_admin_baca>=4 AND v_acak_baca=0, format('admin=%s acak=%s', v_admin_baca, v_acak_baca));
END
$test$;

SELECT nama, CASE WHEN ok THEN 'LULUS' ELSE 'GAGAL' END AS hasil, detail FROM hasil;
ROLLBACK;
