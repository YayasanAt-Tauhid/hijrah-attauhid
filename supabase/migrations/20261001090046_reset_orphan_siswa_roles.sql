-- Reset role legacy yang dulu otomatis menjadi 'siswa' walau akun tidak
-- terhubung ke data siswa, pegawai, atau relasi orang tua.
--
-- Akun tersebut tidak dihapus. Dengan role NULL, pengguna dapat masuk lewat
-- Portal Orang Tua dan menyelesaikan verifikasi anak untuk menjadi role 'ortu'.
-- Guard ini sengaja ketat agar akun siswa/staff yang benar-benar terhubung
-- tidak ikut berubah.

UPDATE public.users_profile up
SET role = NULL
WHERE up.role = 'siswa'
  AND up.siswa_id IS NULL
  AND up.pegawai_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.ortu_siswa os
    WHERE os.user_id = up.id
  );
