-- Perbaikan pemilik tabel di Rustbase.
--
-- Masalah: halaman Persetujuan Pembatalan (/keuangan/persetujuan-pembatalan) selalu kosong.
-- Aplikasi terhubung ke database sebagai role proj_kqylkreswang_admin, pemilik 103 dari 109 tabel
-- (pemilik tabel lolos RLS). Dua tabel dibuat oleh role rustbase dengan RLS aktif dan tanpa policy
-- sehingga bagi role aplikasi SELECT mengembalikan 0 baris tanpa galat, padahal RPC SECURITY DEFINER
-- (penulisan) tetap berhasil: pengajuan tersimpan tetapi tidak pernah terbaca.
--
-- Perbaikan: pindahkan pemilik kedua tabel ke role aplikasi, sama seperti tabel lain.
-- Akses klien tidak berubah (RLS tetap aktif, tanpa policy, tanpa GRANT ke anon/authenticated).
--
-- Sudah diterapkan manual ke produksi Rustbase (proj_kqylkreswang) pada 2026-11-23 11:30 WIB.
-- Aman dijalankan ulang; dilewati bila role atau tabelnya tidak ada (mis. lingkungan Supabase).
--
-- Rollback: ALTER TABLE public.<tabel> OWNER TO rustbase;
--
-- Migrasi baru di Rustbase: bila dijalankan sebagai role rustbase, akhiri dengan
-- ALTER TABLE ... OWNER TO proj_kqylkreswang_admin agar tabel tidak terbaca kosong.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proj_kqylkreswang_admin') THEN
    RETURN;
  END IF;

  IF to_regclass('public.pembatalan_pembayaran_pengajuan') IS NOT NULL THEN
    ALTER TABLE public.pembatalan_pembayaran_pengajuan OWNER TO proj_kqylkreswang_admin;
  END IF;
  IF to_regclass('public.log_potongan_saudara') IS NOT NULL THEN
    ALTER TABLE public.log_potongan_saudara OWNER TO proj_kqylkreswang_admin;
  END IF;
END
$$;
