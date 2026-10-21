-- Nama jenis seragam boleh disimpan sebelum ukuran diketahui.
-- Constraint baru tetap menolak ukuran tanpa nama dan bentuk data selain empat objek.
ALTER TABLE public.siswa_detail DROP CONSTRAINT siswa_detail_ukuran_seragam_shape;
ALTER TABLE public.siswa_detail ADD CONSTRAINT siswa_detail_ukuran_seragam_shape
CHECK (ukuran_seragam IS NULL OR (
  jsonb_typeof(ukuran_seragam) = 'array'
  AND jsonb_array_length(ukuran_seragam) = 4
  AND NOT jsonb_path_exists(ukuran_seragam, '$[*] ? (@.type() != "object" || !exists(@.jenis) || !exists(@.ukuran) || @.jenis.type() != "string" || @.ukuran.type() != "string" || (@.jenis == "" && @.ukuran != ""))')
));
