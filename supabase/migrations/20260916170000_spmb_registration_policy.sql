-- SPMB 2027/2028: satukan kebijakan pendaftaran admin/publik dan lindungi promo di backend.
-- Batas waktu disimpan sebagai timestamptz UTC yang ekuivalen dengan Asia/Jakarta.

CREATE OR REPLACE FUNCTION public.spmb_is_first_wave_free(p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_created_at >= timestamptz '2026-09-20 17:00:00+00'
     AND p_created_at <  timestamptz '2026-10-23 17:00:00+00'
$$;

REVOKE ALL ON FUNCTION public.spmb_is_first_wave_free(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spmb_is_first_wave_free(timestamptz) TO authenticated, service_role;

-- Tidak mengubah data lama. Index hanya melindungi NIK valid 16 digit sehingga
-- record legacy yang dahulu tersimpan dengan format/length tidak valid tetap dapat dibaca.
CREATE UNIQUE INDEX IF NOT EXISTS siswa_detail_nik_16_unique
ON public.siswa_detail ((regexp_replace(nik, '[^0-9]', '', 'g')))
WHERE nik IS NOT NULL
  AND length(regexp_replace(nik, '[^0-9]', '', 'g')) = 16;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_registration_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  target_year uuid;
  target_cohort uuid;
  normalized_nik text;
BEGIN
  -- Hanya jalur SPMB publik yang mempunyai payment token. Edit/admin lama tidak
  -- dipaksa memenuhi aturan pendaftaran baru agar data legacy tetap dapat dirawat.
  IF NEW.pmb_payment_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = NEW.siswa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data calon murid tidak ditemukan';
  END IF;

  SELECT id INTO target_year
  FROM public.tahun_ajaran
  WHERE nama = 'Tahun Ajaran 2027-2028'
  ORDER BY tanggal_mulai DESC NULLS LAST, id
  LIMIT 1;
  IF target_year IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Tahun Ajaran 2027-2028 belum tersedia';
  END IF;

  SELECT id INTO target_cohort
  FROM public.angkatan
  WHERE departemen_id = s.departemen_id
    AND nama = 'Angkatan 2027'
    AND aktif = true
  ORDER BY id
  LIMIT 1;
  IF target_cohort IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Angkatan 2027 untuk lembaga yang dipilih belum tersedia';
  END IF;

  IF NEW.tahun_ajaran_id IS DISTINCT FROM target_year THEN
    RAISE EXCEPTION 'Pendaftaran SPMB saat ini hanya untuk Tahun Ajaran 2027-2028';
  END IF;
  IF s.angkatan_id IS DISTINCT FROM target_cohort THEN
    RAISE EXCEPTION 'Angkatan calon murid harus Angkatan 2027 sesuai lembaga';
  END IF;
  IF COALESCE(NEW.kategori, '') <> 'MURID BARU' THEN
    RAISE EXCEPTION 'Kategori pendaftaran saat ini hanya Murid';
  END IF;
  IF COALESCE(NEW.jenis_pendaftaran, 'baru') <> 'baru' THEN
    RAISE EXCEPTION 'Pendaftaran SPMB saat ini hanya untuk murid baru';
  END IF;

  normalized_nik := regexp_replace(COALESCE(NEW.nik, ''), '[^0-9]', '', 'g');
  IF length(normalized_nik) <> 16 THEN
    RAISE EXCEPTION 'NIK Calon Murid harus terdiri dari 16 digit';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.siswa_detail d
    WHERE d.siswa_id <> NEW.siswa_id
      AND length(regexp_replace(COALESCE(d.nik, ''), '[^0-9]', '', 'g')) = 16
      AND regexp_replace(d.nik, '[^0-9]', '', 'g') = normalized_nik
  ) THEN
    RAISE EXCEPTION 'NIK Calon Murid sudah terdaftar pada data siswa lain';
  END IF;

  NEW.nik := normalized_nik;
  NEW.kategori := 'MURID BARU';
  NEW.jenis_pendaftaran := 'baru';
  -- Data fisik dan ukuran baju baru diisi setelah proses seleksi/kelulusan.
  NEW.tinggi_badan_cm := NULL;
  NEW.berat_badan_kg := NULL;
  NEW.lingkar_kepala_cm := NULL;
  NEW.ukuran_baju := NULL;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_spmb_public_registration_policy() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS guard_spmb_public_registration_policy ON public.siswa_detail;
CREATE TRIGGER guard_spmb_public_registration_policy
BEFORE INSERT ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.guard_spmb_public_registration_policy();

-- Jalur admin menyimpan data dasar calon murid. Kelas, dokumen dan verifikasi
-- tetap dilengkapi kemudian dan tetap diwajibkan oleh guard penerimaan SPMB.
CREATE OR REPLACE FUNCTION public.spmb_admin_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  dept public.departemen;
  target_year uuid;
  target_cohort uuid;
  normalized_nik text;
  clean_name text;
  clean_phone text;
  clean_address text;
  saved jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Data pendaftaran tidak valid';
  END IF;

  clean_name := trim(COALESCE(p_payload->>'nama', ''));
  IF length(clean_name) < 2 OR length(clean_name) > 200 THEN
    RAISE EXCEPTION 'Nama lengkap wajib diisi (2-200 karakter)';
  END IF;

  normalized_nik := regexp_replace(COALESCE(p_payload->>'nik', ''), '[^0-9]', '', 'g');
  IF length(normalized_nik) <> 16 THEN
    RAISE EXCEPTION 'NIK Calon Murid harus terdiri dari 16 digit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.siswa_detail d
    WHERE length(regexp_replace(COALESCE(d.nik, ''), '[^0-9]', '', 'g')) = 16
      AND regexp_replace(d.nik, '[^0-9]', '', 'g') = normalized_nik
  ) THEN
    RAISE EXCEPTION 'NIK Calon Murid sudah terdaftar pada data siswa lain';
  END IF;

  SELECT * INTO dept
  FROM public.departemen
  WHERE id = NULLIF(p_payload->>'departemen_id', '')::uuid
    AND aktif = true
    AND kategori = 'unit_pendidikan'
    AND psb_dibuka = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lembaga tidak valid atau SPMB belum dibuka untuk lembaga ini';
  END IF;

  SELECT id INTO target_year
  FROM public.tahun_ajaran
  WHERE nama = 'Tahun Ajaran 2027-2028'
  ORDER BY tanggal_mulai DESC NULLS LAST, id
  LIMIT 1;
  IF target_year IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Tahun Ajaran 2027-2028 belum tersedia';
  END IF;

  SELECT id INTO target_cohort
  FROM public.angkatan
  WHERE departemen_id = dept.id
    AND nama = 'Angkatan 2027'
    AND aktif = true
  ORDER BY id
  LIMIT 1;
  IF target_cohort IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Angkatan 2027 untuk lembaga ini belum tersedia';
  END IF;

  clean_phone := NULLIF(trim(COALESCE(p_payload->>'telepon', '')), '');
  clean_address := NULLIF(trim(COALESCE(p_payload->>'alamat', '')), '');

  saved := public.akademik_save_siswa(
    jsonb_build_object(
      'nama', clean_name,
      'jenis_kelamin', CASE WHEN p_payload->>'jenis_kelamin' = 'P' THEN 'P' ELSE 'L' END,
      'telepon', clean_phone,
      'alamat', clean_address,
      'angkatan_id', target_cohort,
      'departemen_id', dept.id,
      'agama', 'Islam',
      'status', 'calon'
    ),
    jsonb_build_object(
      'tahun_ajaran_id', target_year,
      'nik', normalized_nik,
      'kategori', 'MURID BARU',
      'jenis_pendaftaran', 'baru'
    ),
    NULL,
    NULL
  );

  RETURN saved || jsonb_build_object(
    'departemen_id', dept.id,
    'angkatan_id', target_cohort,
    'tahun_ajaran_id', target_year,
    'gratis_pendaftaran', public.spmb_is_first_wave_free(clock_timestamp())
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_admin_register(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_admin_register(jsonb) TO authenticated;

-- Pertahanan terakhir pembayaran. UI boleh menyembunyikan tombol, tetapi order
-- SPMB publik tidak boleh dibuat sebelum 24 Okt 2026 dan tidak pernah dibuat
-- untuk pendaftar yang timestamp pendaftarannya berada pada periode gratis.
CREATE OR REPLACE FUNCTION public.guard_spmb_public_payment_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  registered_at timestamptz;
BEGIN
  IF COALESCE(NEW.metadata->>'source', '') <> 'pmb_public' THEN
    RETURN NEW;
  END IF;

  BEGIN
    sid := NULLIF(NEW.metadata->>'siswa_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak valid';
  END;
  IF sid IS NULL THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak lengkap';
  END IF;

  SELECT created_at INTO registered_at FROM public.siswa WHERE id = sid;
  IF registered_at IS NULL THEN
    RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan';
  END IF;

  IF public.spmb_is_first_wave_free(registered_at) THEN
    RAISE EXCEPTION 'Pendaftar Gelombang Pertama berhak gratis biaya pendaftaran; transaksi tidak dibuat';
  END IF;
  IF clock_timestamp() < timestamptz '2026-10-23 17:00:00+00' THEN
    RAISE EXCEPTION 'Pembayaran biaya pendaftaran baru tersedia mulai 24 Oktober 2026 (Asia/Jakarta)';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_spmb_public_payment_policy() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS guard_spmb_public_payment_policy ON public.transaksi_midtrans;
CREATE TRIGGER guard_spmb_public_payment_policy
BEFORE INSERT ON public.transaksi_midtrans
FOR EACH ROW
EXECUTE FUNCTION public.guard_spmb_public_payment_policy();
