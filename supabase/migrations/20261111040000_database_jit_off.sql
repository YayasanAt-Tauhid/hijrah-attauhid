-- Matikan JIT (just-in-time compilation) Postgres pada database aplikasi.
--
-- Latar belakang (11 Nov 2026): Dashboard (total siswa) dan /akademik/siswa
-- lambat. Aturan akses (RLS) tabel siswa membuat planner memperkirakan biaya
-- query ~1,7 juta (batas jit_above_cost 100.000), sehingga JIT menyala. Diukur
-- di produksi sebagai admin: hitung siswa aktif 2.585 ms, ~2.430 ms di antaranya
-- kompilasi JIT; dengan jit=off hanya ~111-123 ms. Query yang menggabungkan tabel
-- lain dengan siswa mewarisi perkiraan biaya itu, jadi halaman lain ikut terdampak.
-- JIT hampir tidak berguna untuk beban aplikasi (banyak query pendek, RLS per baris).
--
-- Pengaturan tersimpan di database (pg_db_role_setting), bukan di berkas konfigurasi,
-- jadi bisa hilang bila database dipindah/dipulihkan tanpa pengaturan database
-- (mis. pg_dump tanpa --create, atau pindah VPS). Berkas ini mencatatnya agar bisa
-- dipasang ulang. Idempotent dan hanya menambah kunci jit; kunci lain (mis.
-- search_path) tidak disentuh. Berlaku untuk KONEKSI BARU; koneksi pool yang sudah
-- terbuka perlu disambung ulang.
--
-- Tidak ada data yang diubah. SUDAH diterapkan manual ke produksi Rustbase
-- (proj_kqylkreswang) pada 11 Nov 2026 atas persetujuan pemilik.
-- Batalkan: ALTER DATABASE <nama_db> RESET jit;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
END
$$;
