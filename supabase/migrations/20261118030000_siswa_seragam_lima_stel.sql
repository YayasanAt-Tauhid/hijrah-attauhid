-- Seragam menjadi lima stel untuk semua lembaga (permintaan pengguna 18 November 2026).
-- Data lama dengan empat stel tetap valid dan tidak diubah (tanpa backfill); form menampilkan stel kelima kosong.
-- Aturan lain tidak berubah: nama boleh disimpan tanpa ukuran, ukuran tanpa nama tetap ditolak.
ALTER TABLE public.siswa_detail DROP CONSTRAINT siswa_detail_ukuran_seragam_shape;
ALTER TABLE public.siswa_detail ADD CONSTRAINT siswa_detail_ukuran_seragam_shape
CHECK (ukuran_seragam IS NULL OR (
  jsonb_typeof(ukuran_seragam) = 'array'
  AND jsonb_array_length(ukuran_seragam) IN (4, 5)
  AND NOT jsonb_path_exists(ukuran_seragam, '$[*] ? (@.type() != "object" || !exists(@.jenis) || !exists(@.ukuran) || @.jenis.type() != "string" || @.ukuran.type() != "string" || (@.jenis == "" && @.ukuran != ""))')
));
COMMENT ON COLUMN public.siswa_detail.ukuran_seragam IS 'Lima stel (data lama boleh empat): array objek jenis dan ukuran. Null berarti belum diisi.';
