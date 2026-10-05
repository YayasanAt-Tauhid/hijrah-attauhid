-- Restore SECURITY DEFINER hardening that regressed after later migrations.
-- Scope:
-- 1) no SECURITY DEFINER function in this audited set is callable by anon;
-- 2) trigger/internal-only functions are not directly callable by browser roles;
-- 3) authenticated RLS/client helpers stay available after login;
-- 4) service_role remains available for server-side flows.
--
-- No function body or application data is changed.

-- users_profile policies were previously hardened to authenticated but have
-- regressed to PUBLIC. Restore the intended role scope first so has_role()
-- does not need anonymous EXECUTE for these policies.
ALTER POLICY "Admin can update profiles"
  ON public.users_profile TO authenticated;
ALTER POLICY "Admin can view all profiles"
  ON public.users_profile TO authenticated;
ALTER POLICY "Users can view own profile"
  ON public.users_profile TO authenticated;

DO $$
DECLARE
  f record;
  internal_names text[] := ARRAY[
    'fn_blokir_periode_tutup',
    'guard_tagihan_insert_tahun_buku_locked',
    'guard_tarif_tagihan_tahun_buku_locked',
    'prepare_nonaktif_override_tarif',
    'spmb_invalidate_on_detail_change',
    'spmb_invalidate_on_siswa_change',
    'spmb_seed_target_fields',
    'spmb_sync_registration_status_from_siswa',
    'spmb_validate_wave_schedule',
    'validasi_tarif_siswa_tahun_masuk',
    'migrate_jurnal_batch',
    'get_siswa_tahun_masuk'
  ];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND p.proname = ANY(internal_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END
$$;

DO $$
DECLARE
  f record;
  authenticated_names text[] := ARRAY[
    'buku_besar_mutasi',
    'buku_besar_saldo_awal',
    'daftarkan_push_token',
    'generate_nomor_jurnal',
    'get_detail_jurnal_kas',
    'get_detail_jurnal_kas_range',
    'get_my_pegawai_id',
    'get_my_siswa_id',
    'get_tarif_siswa',
    'get_user_role',
    'guru_teaches_class',
    'guru_teaches_mapel',
    'has_role',
    'hitung_jatuh_tempo_tagihan',
    'hitung_mutasi_akun',
    'hitung_mutasi_akun_range',
    'hitung_saldo_akun_per_kategori',
    'is_admin_or_kepala',
    'is_ortu_of',
    'is_own_pegawai',
    'is_own_siswa',
    'is_penyetuju_diskon',
    'is_tahun_buku_pendidikan_locked',
    'is_unit_locked_for_transaksi',
    'is_unit_pendidikan_ditutup',
    'isi_saldo_awal_isak35'
  ];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND p.proname = ANY(authenticated_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.signature);
  END LOOP;
END
$$;
