-- Tampilkan dan simpan checklist untuk data SPMB opsional tanpa menjadikannya
-- syarat verifikasi akhir. Hanya requirement required=true yang menghitung can_submit.

CREATE OR REPLACE FUNCTION public.spmb_optional_verification_requirements(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
BEGIN
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  RETURN jsonb_build_array(
    jsonb_build_object('key','telepon','label','No. HP Siswa / Pendaftar','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(s.telepon),''),'Opsional — belum diisi')),
    jsonb_build_object('key','alamat','label','Alamat rumah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(s.alamat),''),'Opsional — belum diisi')),
    jsonb_build_object('key','jenis_pendaftaran','label','Jenis pendaftaran','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.jenis_pendaftaran),''),'Opsional — belum diisi')),
    jsonb_build_object('key','tinggi_badan_cm','label','Tinggi badan','kind','field','required',false,
      'valid',d.tinggi_badan_cm IS NULL OR d.tinggi_badan_cm >= 0,
      'display_value',CASE WHEN d.tinggi_badan_cm IS NULL THEN 'Opsional — belum diisi' ELSE d.tinggi_badan_cm::text || ' cm' END),
    jsonb_build_object('key','berat_badan_kg','label','Berat badan','kind','field','required',false,
      'valid',d.berat_badan_kg IS NULL OR d.berat_badan_kg >= 0,
      'display_value',CASE WHEN d.berat_badan_kg IS NULL THEN 'Opsional — belum diisi' ELSE d.berat_badan_kg::text || ' kg' END),
    jsonb_build_object('key','lingkar_kepala_cm','label','Lingkar kepala','kind','field','required',false,
      'valid',d.lingkar_kepala_cm IS NULL OR d.lingkar_kepala_cm >= 0,
      'display_value',CASE WHEN d.lingkar_kepala_cm IS NULL THEN 'Opsional — belum diisi' ELSE d.lingkar_kepala_cm::text || ' cm' END),
    jsonb_build_object('key','ukuran_baju','label','Ukuran baju','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.ukuran_baju),''),'Opsional — belum diisi')),
    jsonb_build_object('key','penyakit_pernah_diderita','label','Penyakit yang pernah diderita','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.penyakit_pernah_diderita),''),'Opsional — belum diisi')),

    jsonb_build_object('key','nik_ayah','label','NIK Ayah','kind','field','required',false,
      'valid',d.nik_ayah IS NULL OR d.nik_ayah = '' OR d.nik_ayah ~ '^[0-9]{16}$',
      'display_value',COALESCE(NULLIF(trim(d.nik_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','nama_ayah','label','Nama Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.nama_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','tempat_lahir_ayah','label','Tempat lahir Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.tempat_lahir_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','tanggal_lahir_ayah','label','Tanggal lahir Ayah','kind','field','required',false,
      'valid',true,'display_value',CASE WHEN d.tanggal_lahir_ayah IS NULL THEN 'Opsional — belum diisi' ELSE to_char(d.tanggal_lahir_ayah,'DD-MM-YYYY') END),
    jsonb_build_object('key','pendidikan_ayah','label','Pendidikan Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.pendidikan_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','pekerjaan_ayah','label','Pekerjaan Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.pekerjaan_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','penghasilan_ayah','label','Penghasilan Ayah','kind','field','required',false,
      'valid',d.penghasilan_ayah IS NULL OR d.penghasilan_ayah >= 0,
      'display_value',CASE WHEN d.penghasilan_ayah IS NULL THEN 'Opsional — belum diisi' ELSE d.penghasilan_ayah::text END),
    jsonb_build_object('key','telepon_ayah','label','No. HP / WA Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.telepon_ayah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','alamat_ayah','label','Alamat Ayah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.alamat_ayah),''),'Opsional — belum diisi')),

    jsonb_build_object('key','nik_ibu','label','NIK Ibu','kind','field','required',false,
      'valid',d.nik_ibu IS NULL OR d.nik_ibu = '' OR d.nik_ibu ~ '^[0-9]{16}$',
      'display_value',COALESCE(NULLIF(trim(d.nik_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','nama_ibu','label','Nama Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.nama_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','tempat_lahir_ibu','label','Tempat lahir Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.tempat_lahir_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','tanggal_lahir_ibu','label','Tanggal lahir Ibu','kind','field','required',false,
      'valid',true,'display_value',CASE WHEN d.tanggal_lahir_ibu IS NULL THEN 'Opsional — belum diisi' ELSE to_char(d.tanggal_lahir_ibu,'DD-MM-YYYY') END),
    jsonb_build_object('key','pendidikan_ibu','label','Pendidikan Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.pendidikan_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','pekerjaan_ibu','label','Pekerjaan Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.pekerjaan_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','penghasilan_ibu','label','Penghasilan Ibu','kind','field','required',false,
      'valid',d.penghasilan_ibu IS NULL OR d.penghasilan_ibu >= 0,
      'display_value',CASE WHEN d.penghasilan_ibu IS NULL THEN 'Opsional — belum diisi' ELSE d.penghasilan_ibu::text END),
    jsonb_build_object('key','telepon_ibu','label','No. HP / WA Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.telepon_ibu),''),'Opsional — belum diisi')),
    jsonb_build_object('key','alamat_ibu','label','Alamat Ibu','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.alamat_ibu),''),'Opsional — belum diisi')),

    jsonb_build_object('key','asal_sekolah','label','Nama sekolah asal','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.asal_sekolah),''),'Opsional — belum diisi')),
    jsonb_build_object('key','kelas_terakhir','label','Kelas terakhir','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.kelas_terakhir),''),'Opsional — belum diisi')),
    jsonb_build_object('key','kabupaten_sekolah_asal','label','Kabupaten / Kota sekolah asal','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.kabupaten_sekolah_asal),''),'Opsional — belum diisi')),
    jsonb_build_object('key','kecamatan_sekolah_asal','label','Kecamatan sekolah asal','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.kecamatan_sekolah_asal),''),'Opsional — belum diisi')),
    jsonb_build_object('key','kelurahan_sekolah_asal','label','Desa / Kelurahan sekolah asal','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.kelurahan_sekolah_asal),''),'Opsional — belum diisi')),
    jsonb_build_object('key','alamat_sekolah_asal','label','Alamat sekolah asal','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.alamat_sekolah_asal),''),'Opsional — belum diisi')),
    jsonb_build_object('key','alasan_pindah','label','Alasan pindah','kind','field','required',false,
      'valid',true,'display_value',COALESCE(NULLIF(trim(d.alasan_pindah),''),'Opsional — belum diisi'))
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_optional_verification_requirements(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_verification_state(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.siswa;
  d public.siswa_detail;
  payload jsonb;
  requirements jsonb;
  current_version text;
  checklist jsonb;
  total_required integer := 0;
  checked_required integer := 0;
  invalid_required jsonb := '[]'::jsonb;
  unchecked_required jsonb := '[]'::jsonb;
  can_verify boolean := false;
  verifier_name text;
  history jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Anda harus masuk terlebih dahulu'; END IF;
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  can_verify := public.has_role(uid, 'admin');
  payload := public.spmb_verification_payload(p_siswa_id);
  requirements := payload->'requirements' || public.spmb_optional_verification_requirements(p_siswa_id);
  current_version := payload->>'version';
  checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb);

  SELECT
    count(*) FILTER (WHERE COALESCE((item->>'required')::boolean,false)),
    count(*) FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND COALESCE((checklist->>(item->>'key'))::boolean,false)),
    COALESCE(jsonb_agg(item->>'label') FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND NOT COALESCE((item->>'valid')::boolean,false)), '[]'::jsonb),
    COALESCE(jsonb_agg(item->>'label') FILTER (WHERE COALESCE((item->>'required')::boolean,false) AND NOT COALESCE((checklist->>(item->>'key'))::boolean,false)), '[]'::jsonb)
  INTO total_required, checked_required, invalid_required, unchecked_required
  FROM jsonb_array_elements(requirements) item;

  IF can_verify AND d.spmb_verifikasi_by IS NOT NULL THEN
    SELECT COALESCE(p.nama, up.email, 'Petugas') INTO verifier_name
    FROM public.users_profile up
    LEFT JOIN public.pegawai p ON p.id = up.pegawai_id
    WHERE up.id = d.spmb_verifikasi_by;
  END IF;

  IF can_verify THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'status', x.status, 'data_version', x.data_version, 'reason', x.reason,
      'changed_fields', to_jsonb(x.changed_fields), 'created_at', x.created_at, 'petugas', x.actor_name
    ) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO history
    FROM (
      SELECT a.status, a.data_version, a.reason, a.changed_fields, a.created_at,
             COALESCE(p.nama, up.email, 'Petugas') AS actor_name
      FROM public.spmb_verifikasi_audit a
      LEFT JOIN public.users_profile up ON up.id = a.actor_id
      LEFT JOIN public.pegawai p ON p.id = up.pegawai_id
      WHERE a.siswa_id = p_siswa_id
      ORDER BY a.created_at DESC
      LIMIT 20
    ) x;
  END IF;

  RETURN jsonb_build_object(
    'siswa_id', p_siswa_id,
    'student_status', s.status,
    'status', COALESCE(d.spmb_verifikasi_status, CASE WHEN s.terverifikasi THEN 'terverifikasi' ELSE 'belum_verifikasi' END),
    'legacy_verified', s.terverifikasi,
    'version', current_version,
    'verified_version', d.spmb_verifikasi_version,
    'verified_at', d.spmb_verifikasi_at,
    'verified_by', CASE WHEN can_verify THEN d.spmb_verifikasi_by ELSE NULL END,
    'verified_by_name', CASE WHEN can_verify THEN verifier_name ELSE NULL END,
    'last_reason', d.spmb_verifikasi_last_reason,
    'can_verify', can_verify,
    'requirements', requirements,
    'checklist', checklist,
    'required_total', total_required,
    'required_checked', checked_required,
    'invalid_required', invalid_required,
    'unchecked_required', unchecked_required,
    'data_current', d.spmb_verifikasi_version IS NULL OR d.spmb_verifikasi_version = current_version,
    'can_submit', can_verify AND s.status IN ('calon','diterima','aktif')
      AND total_required = checked_required AND jsonb_array_length(invalid_required) = 0,
    'history', history
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_verification_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_verification_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_set_field_verifications(
  p_siswa_id uuid,
  p_changes jsonb,
  p_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  d public.siswa_detail;
  payload jsonb;
  requirements jsonb;
  item jsonb;
  current_version text;
  change_key text;
  change_value jsonb;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Akses verifikasi SPMB ditolak';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'Perubahan checklist tidak valid';
  END IF;

  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  current_version := payload->>'version';
  requirements := payload->'requirements' || public.spmb_optional_verification_requirements(p_siswa_id);

  IF NULLIF(p_version, '') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  FOR change_key, change_value IN SELECT key, value FROM jsonb_each(p_changes)
  LOOP
    IF jsonb_typeof(change_value) <> 'boolean' THEN
      RAISE EXCEPTION 'Nilai checklist tidak valid: %', change_key;
    END IF;

    SELECT value INTO item
    FROM jsonb_array_elements(requirements)
    WHERE value->>'key' = change_key
    LIMIT 1;

    IF item IS NULL THEN
      RAISE EXCEPTION 'Item pemeriksaan tidak termasuk data SPMB saat ini: %', change_key;
    END IF;
  END LOOP;

  IF p_changes <> '{}'::jsonb THEN
    PERFORM set_config('app.spmb_verification_internal', '1', true);
    UPDATE public.siswa_detail
    SET spmb_verifikasi_fields = COALESCE(spmb_verifikasi_fields, '{}'::jsonb) || p_changes
    WHERE siswa_id = p_siswa_id;
  END IF;

  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;

REVOKE ALL ON FUNCTION public.spmb_set_field_verifications(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_field_verifications(uuid,jsonb,text) TO authenticated;

COMMENT ON FUNCTION public.spmb_set_field_verifications(uuid,jsonb,text) IS
  'Menyimpan checklist wajib maupun opsional; hanya checklist wajib memengaruhi kelayakan verifikasi akhir.';
