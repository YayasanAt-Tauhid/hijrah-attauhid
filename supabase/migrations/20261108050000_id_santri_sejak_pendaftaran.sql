-- ID Santri dibuat sejak PENDAFTARAN SPMB (status 'calon'), bukan hanya saat Lulus.
--
-- Latar belakang: trigger trg_siswa_assign_id_santri (20261106103500) hanya jalan
-- saat NIS pertama kali terisi, sehingga calon baru mendapat ID ketika Lulus.
-- Keputusan pemilik data (8 Nov 2026): ID harus ada sejak mendaftar karena akan
-- dipakai pihak ketiga. Format tetap YY.KK.NNN; ID dibuat sekali, tidak berubah
-- bila santri pindah lembaga, dan tidak pernah ditimpa. Nomor yang terpakai oleh
-- calon yang tidak jadi lulus dibiarkan bolong (disetujui).
--
-- Saat pendaftaran, baris siswa sudah memuat departemen_id dan angkatan_id
-- ("Angkatan YYYY"), sehingga generator menurunkan tahun dari nama angkatan.
-- Generator id_santri_generate TIDAK diubah: lembaga/tahun tak dikenal tetap
-- menghasilkan NULL tanpa menggagalkan penyimpanan.
--
-- Migrasi ini hanya mengganti trigger. Tidak ada data yang diubah.
-- Pengisian ID untuk calon yang SUDAH mendaftar adalah langkah data terpisah
-- dan butuh konfirmasi pemilik data. BELUM diterapkan ke produksi.

DROP TRIGGER IF EXISTS trg_siswa_assign_id_santri ON public.siswa;
CREATE TRIGGER trg_siswa_assign_id_santri
  BEFORE INSERT OR UPDATE OF nis, status ON public.siswa
  FOR EACH ROW
  WHEN (
    NEW.id_santri_pihak3 IS NULL
    AND (
      NEW.status = 'calon'
      OR (NEW.nis IS NOT NULL AND btrim(NEW.nis) <> '')
    )
  )
  EXECUTE FUNCTION public.siswa_assign_id_santri();

COMMENT ON COLUMN public.siswa.id_santri_pihak3 IS
  'ID Santri (YY.KK.NNN). Dibuat otomatis oleh aplikasi saat pendaftaran (calon) atau saat NIS pertama terisi; data lama berasal dari SiPaksa. Nama kolom historis.';
