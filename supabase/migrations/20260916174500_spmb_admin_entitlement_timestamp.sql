-- Pastikan hak gratis pada respons pendaftaran admin memakai created_at record,
-- bukan waktu saat RPC selesai. Ini menghilangkan race condition tepat di batas promo.
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
  registered_at timestamptz;
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

  SELECT s.created_at INTO registered_at
  FROM public.siswa s
  WHERE s.id = (saved->>'id')::uuid;

  RETURN saved || jsonb_build_object(
    'departemen_id', dept.id,
    'angkatan_id', target_cohort,
    'tahun_ajaran_id', target_year,
    'gratis_pendaftaran', public.spmb_is_first_wave_free(registered_at)
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_admin_register(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_admin_register(jsonb) TO authenticated;
