-- Lengkapi data PMB publik agar setara dengan formulir pendaftaran lama
-- dan simpan dokumen sensitif di bucket privat.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS tahun_ajaran_id uuid REFERENCES public.tahun_ajaran(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nik text,
  ADD COLUMN IF NOT EXISTS no_kk text,
  ADD COLUMN IF NOT EXISTS kategori text,
  ADD COLUMN IF NOT EXISTS anak_ke integer,
  ADD COLUMN IF NOT EXISTS jumlah_bersaudara integer,
  ADD COLUMN IF NOT EXISTS tinggi_badan_cm numeric(6,2),
  ADD COLUMN IF NOT EXISTS berat_badan_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS lingkar_kepala_cm numeric(6,2),
  ADD COLUMN IF NOT EXISTS ukuran_baju text,
  ADD COLUMN IF NOT EXISTS penyakit_pernah_diderita text,
  ADD COLUMN IF NOT EXISTS jarak_rumah_km numeric(8,2),
  ADD COLUMN IF NOT EXISTS waktu_perjalanan_menit integer,
  ADD COLUMN IF NOT EXISTS transportasi text,
  ADD COLUMN IF NOT EXISTS nik_ayah text,
  ADD COLUMN IF NOT EXISTS tempat_lahir_ayah text,
  ADD COLUMN IF NOT EXISTS tanggal_lahir_ayah date,
  ADD COLUMN IF NOT EXISTS pendidikan_ayah text,
  ADD COLUMN IF NOT EXISTS penghasilan_ayah numeric(15,2),
  ADD COLUMN IF NOT EXISTS telepon_ayah text,
  ADD COLUMN IF NOT EXISTS alamat_ayah text,
  ADD COLUMN IF NOT EXISTS nik_ibu text,
  ADD COLUMN IF NOT EXISTS tempat_lahir_ibu text,
  ADD COLUMN IF NOT EXISTS tanggal_lahir_ibu date,
  ADD COLUMN IF NOT EXISTS pendidikan_ibu text,
  ADD COLUMN IF NOT EXISTS penghasilan_ibu numeric(15,2),
  ADD COLUMN IF NOT EXISTS telepon_ibu text,
  ADD COLUMN IF NOT EXISTS alamat_ibu text,
  ADD COLUMN IF NOT EXISTS alamat_sekolah_asal text,
  ADD COLUMN IF NOT EXISTS kabupaten_sekolah_asal text,
  ADD COLUMN IF NOT EXISTS kecamatan_sekolah_asal text,
  ADD COLUMN IF NOT EXISTS kelurahan_sekolah_asal text,
  ADD COLUMN IF NOT EXISTS kemampuan_iqro text,
  ADD COLUMN IF NOT EXISTS membaca_latin text,
  ADD COLUMN IF NOT EXISTS menulis_latin text,
  ADD COLUMN IF NOT EXISTS hafalan_quran text,
  ADD COLUMN IF NOT EXISTS dokumen_kk_path text,
  ADD COLUMN IF NOT EXISTS dokumen_akta_path text,
  ADD COLUMN IF NOT EXISTS dokumen_rapor_path text,
  ADD COLUMN IF NOT EXISTS dokumen_ijazah_path text;

-- Dokumen PMB berisi data pribadi (KK/akta/rapor/ijazah), sehingga bucket
-- sengaja private. Browser memperoleh signed upload token dari server PMB;
-- tidak ada policy INSERT/SELECT publik pada storage.objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pmb-dokumen',
  'pmb-dokumen',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN public.siswa_detail.dokumen_kk_path IS 'Path privat Storage untuk Kartu Keluarga PMB';
COMMENT ON COLUMN public.siswa_detail.dokumen_akta_path IS 'Path privat Storage untuk Akta Kelahiran PMB';
COMMENT ON COLUMN public.siswa_detail.dokumen_rapor_path IS 'Path privat Storage untuk Rapor PMB';
COMMENT ON COLUMN public.siswa_detail.dokumen_ijazah_path IS 'Path privat Storage untuk Ijazah/SKHUN PMB';