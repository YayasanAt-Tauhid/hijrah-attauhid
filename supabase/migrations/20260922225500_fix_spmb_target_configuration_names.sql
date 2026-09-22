-- Koreksi nama target SPMB agar sama dengan data kanonik yang sudah ada:
-- tahun_ajaran.nama = 'Tahun Ajaran 2027/2028'
-- angkatan.nama = '2027'
--
-- Migrasi historis tidak diubah. Fungsi yang saat ini terpasang dipatch dengan
-- CREATE OR REPLACE dari definisi yang sama, hanya pada literal lookup target.

DO $migration$
DECLARE
  rec record;
  original_ddl text;
  patched_ddl text;
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'guard_spmb_public_registration_policy',
        'spmb_admin_register',
        'spmb_apply_first_wave_promo'
      )
  LOOP
    original_ddl := pg_get_functiondef(rec.oid);
    patched_ddl := original_ddl;

    patched_ddl := replace(
      patched_ddl,
      'WHERE nama = ''Tahun Ajaran 2027-2028''',
      'WHERE nama = ''Tahun Ajaran 2027/2028'''
    );
    patched_ddl := replace(
      patched_ddl,
      'AND ta.nama = ''Tahun Ajaran 2027-2028''',
      'AND ta.nama = ''Tahun Ajaran 2027/2028'''
    );
    patched_ddl := replace(
      patched_ddl,
      'AND nama = ''Angkatan 2027''',
      'AND nama = ''2027'''
    );

    IF patched_ddl IS DISTINCT FROM original_ddl THEN
      EXECUTE patched_ddl;
    END IF;
  END LOOP;
END
$migration$;

DO $verify$
DECLARE
  bad_functions text[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname)
  INTO bad_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname IN (
      'guard_spmb_public_registration_policy',
      'spmb_admin_register',
      'spmb_apply_first_wave_promo'
    )
    AND (
      pg_get_functiondef(p.oid) LIKE '%WHERE nama = ''Tahun Ajaran 2027-2028''%'
      OR pg_get_functiondef(p.oid) LIKE '%AND ta.nama = ''Tahun Ajaran 2027-2028''%'
      OR pg_get_functiondef(p.oid) LIKE '%AND nama = ''Angkatan 2027''%'
    );

  IF bad_functions IS NOT NULL THEN
    RAISE EXCEPTION
      'Konfigurasi target SPMB lama masih ditemukan pada fungsi: %',
      array_to_string(bad_functions, ', ');
  END IF;
END
$verify$;
