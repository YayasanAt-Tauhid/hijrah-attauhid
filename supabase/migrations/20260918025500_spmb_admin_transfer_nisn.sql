CREATE OR REPLACE FUNCTION public.spmb_admin_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  dept public.departemen;
  target_year uuid;
  target_cohort uuid;
  normalized_nik text;
  normalized_nisn text;
  clean_name text;
  clean_phone text;
  clean_address text;
  category_value text;
  registration_type text;
  needs_nisn boolean := false;
  saved jsonb;
  registered_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'admin_tu')
  ) THEN
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
  IF NOT public.can_manage_akademik_departemen(auth.uid(), dept.id) THEN
    RAISE EXCEPTION 'Akses lembaga ditolak';
  END IF;

  needs_nisn :=
    upper(trim(COALESCE(dept.kode,''))) IN ('SMP','SMA','MTA')
    OR upper(COALESCE(dept.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)';
  normalized_nisn := regexp_replace(COALESCE(p_payload->>'nisn', ''), '[^0-9]', '', 'g');
  IF needs_nisn AND length(normalized_nisn) <> 10 THEN
    RAISE EXCEPTION 'NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA';
  END IF;

  category_value := upper(trim(COALESCE(p_payload->>'kategori', 'MURID BARU')));
  IF category_value NOT IN ('MURID BARU','MURID PINDAHAN') THEN
    RAISE EXCEPTION 'Kategori harus Murid Baru atau Siswa Pindahan';
  END IF;
  registration_type := CASE WHEN category_value = 'MURID PINDAHAN' THEN 'pindahan' ELSE 'baru' END;

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

  clean_phone := NULLIF(replace(replace(trim(COALESCE(p_payload->>'telepon', '')), ' ', ''), '-', ''), '');
  clean_address := NULLIF(trim(COALESCE(p_payload->>'alamat', '')), '');
  IF clean_phone IS NULL THEN
    RAISE EXCEPTION 'No. HP / WhatsApp yang bisa dihubungi wajib diisi';
  END IF;
  IF clean_phone !~ '^(\+62|62|0)[0-9]{7,16}$' THEN
    RAISE EXCEPTION 'No. HP / WhatsApp tidak valid';
  END IF;
  IF clean_address IS NULL THEN
    RAISE EXCEPTION 'Alamat rumah wajib diisi';
  END IF;

  saved := public.akademik_save_siswa(
    jsonb_build_object(
      'nama', clean_name,
      'nisn', CASE WHEN needs_nisn THEN normalized_nisn ELSE NULL END,
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
      'kategori', category_value,
      'jenis_pendaftaran', registration_type
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
    'kategori', category_value,
    'jenis_pendaftaran', registration_type,
    'gratis_pendaftaran', public.spmb_is_first_wave_free(registered_at)
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_admin_register(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_admin_register(jsonb) TO authenticated;
