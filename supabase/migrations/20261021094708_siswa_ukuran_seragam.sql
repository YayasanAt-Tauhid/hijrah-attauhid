-- Empat stel independen; ukuran_baju lama tetap dipertahankan.
ALTER TABLE public.siswa_detail ADD COLUMN ukuran_seragam jsonb;
ALTER TABLE public.siswa_detail ADD CONSTRAINT siswa_detail_ukuran_seragam_shape
CHECK (ukuran_seragam IS NULL OR (
  jsonb_typeof(ukuran_seragam) = 'array'
  AND jsonb_array_length(ukuran_seragam) = 4
  AND NOT jsonb_path_exists(ukuran_seragam, '$[*] ? (@.type() != "object" || !exists(@.jenis) || !exists(@.ukuran) || @.jenis.type() != "string" || @.ukuran.type() != "string" || (@.jenis == "" && @.ukuran != "") || (@.jenis != "" && @.ukuran == ""))')
));
COMMENT ON COLUMN public.siswa_detail.ukuran_seragam IS 'Empat stel: array objek jenis dan ukuran dari katalog seragam. Null berarti belum diisi.';
