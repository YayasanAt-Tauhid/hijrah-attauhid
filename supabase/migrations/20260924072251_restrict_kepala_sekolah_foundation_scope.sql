-- Kepala Sekolah berfokus pada domain akademik lembaganya.
-- Keuangan dan kepegawaian operasional dikelola di tingkat yayasan.
--
-- Strategi:
-- 1. Policy RESTRICTIVE menjadi pagar tambahan pada seluruh tabel keuangan/HR.
--    Policy permissive lama tidak dapat melewati pagar ini.
-- 2. Cabut policy eksplisit Kepala Sekolah pada pembayaran/presensi pegawai.
-- 3. Pertahankan SELECT tabel pegawai untuk kebutuhan akademik (nama guru/jadwal),
--    tetapi cabut hak update profil pegawai.
-- 4. Hardening SECURITY DEFINER finance RPC yang melewati RLS.

DROP POLICY IF EXISTS "kepsek_pembayaran_select" ON public.pembayaran;
DROP POLICY IF EXISTS "kepsek_presensi_pegawai_all" ON public.presensi_pegawai;
DROP POLICY IF EXISTS "kepsek_pegawai_update_own" ON public.pegawai;

DO $$
DECLARE
  t text;
  finance_tables text[] := ARRAY[
    'akun_rekening',
    'aset_tetap',
    'audit_keuangan',
    'jenis_pembayaran',
    'jenis_pembayaran_angkatan',
    'jenis_pengeluaran',
    'jurnal',
    'jurnal_detail',
    'kas_kecil_setting',
    'konfigurasi_pmb',
    'log_tutup_buku',
    'pembayaran',
    'pendapatan_dimuka',
    'pengaturan_akun',
    'pengeluaran',
    'penyisihan_piutang',
    'program_dana',
    'replenishment_kas_kecil',
    'saldo_awal_isak35',
    'saldo_awal_usaha',
    'siswa_diskon',
    'siswa_tahun_masuk_departemen',
    'skema_diskon',
    'tabungan_pegawai',
    'tabungan_siswa',
    'tagihan',
    'tahun_buku',
    'tarif_tagihan',
    'transaksi_kas_kecil',
    'transaksi_midtrans',
    'transaksi_midtrans_item',
    'transaksi_tabungan',
    'transaksi_tabungan_pegawai',
    'write_off_piutang'
  ];
BEGIN
  FOREACH t IN ARRAY finance_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS deny_kepala_sekolah_finance ON public.%I',
        t
      );
      EXECUTE format(
        'CREATE POLICY deny_kepala_sekolah_finance ON public.%I AS RESTRICTIVE
         FOR ALL TO authenticated
         USING (NOT public.has_role(auth.uid(), ''kepala_sekolah''))
         WITH CHECK (NOT public.has_role(auth.uid(), ''kepala_sekolah''))',
        t
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  t text;
  hr_tables text[] := ARRAY[
    'presensi_pegawai',
    'keluarga_pegawai',
    'riwayat_diklat',
    'riwayat_gaji',
    'riwayat_golongan',
    'riwayat_jabatan',
    'riwayat_pendidikan',
    'sertifikasi_guru'
  ];
BEGIN
  FOREACH t IN ARRAY hr_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS deny_kepala_sekolah_hr ON public.%I',
        t
      );
      EXECUTE format(
        'CREATE POLICY deny_kepala_sekolah_hr ON public.%I AS RESTRICTIVE
         FOR ALL TO authenticated
         USING (NOT public.has_role(auth.uid(), ''kepala_sekolah''))
         WITH CHECK (NOT public.has_role(auth.uid(), ''kepala_sekolah''))',
        t
      );
    END IF;
  END LOOP;
END
$$;

-- Finance RPC berikut SECURITY DEFINER sehingga harus dikunci di fungsi juga,
-- karena SECURITY DEFINER dapat melewati RLS.
DO $$
DECLARE
  f record;
  original_def text;
  hardened_def text;
  finance_functions text[] := ARRAY[
    'buku_besar_mutasi',
    'buku_besar_saldo_awal',
    'get_detail_jurnal_kas',
    'get_detail_jurnal_kas_range',
    'hitung_mutasi_akun',
    'hitung_mutasi_akun_range',
    'hitung_saldo_akun_per_kategori',
    'isi_saldo_awal_isak35',
    'nonaktifkan_override_tarif',
    'saran_kelompok_keluarga',
    'simpan_tarif_dan_generate_atomik'
  ];
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY(finance_functions)
  LOOP
    original_def := pg_get_functiondef(f.oid);
    hardened_def := original_def;

    hardened_def := replace(
      hardened_def,
      'public.is_admin_or_kepala(auth.uid())',
      'public.has_role(auth.uid(), ''admin'')'
    );
    hardened_def := replace(
      hardened_def,
      'is_admin_or_kepala(auth.uid())',
      'public.has_role(auth.uid(), ''admin'')'
    );
    hardened_def := replace(
      hardened_def,
      'public.is_admin_or_kepala(v_uid)',
      'public.has_role(v_uid, ''admin'')'
    );
    hardened_def := replace(
      hardened_def,
      'is_admin_or_kepala(v_uid)',
      'public.has_role(v_uid, ''admin'')'
    );

    IF hardened_def = original_def THEN
      RAISE EXCEPTION
        'Finance function %.% tidak mengandung guard Kepala Sekolah yang diharapkan',
        f.proname, f.args;
    END IF;

    EXECUTE hardened_def;
  END LOOP;
END
$$;

COMMENT ON POLICY deny_kepala_sekolah_finance ON public.pembayaran IS
  'Pagar global: Kepala Sekolah tidak memiliki akses operasional ke domain keuangan yayasan.';
COMMENT ON POLICY deny_kepala_sekolah_hr ON public.presensi_pegawai IS
  'Pagar global: Kepala Sekolah tidak mengelola domain kepegawaian yayasan.';
