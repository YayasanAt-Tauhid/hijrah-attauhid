-- Sederhanakan verifikasi dari halaman Edit Data Siswa:
-- hanya data inti yang dapat dicocokkan dengan Kartu Keluarga (KK) yang wajib.
-- Aturan pendaftaran publik SPMB tetap dipertahankan dan tidak dilonggarkan.

CREATE OR REPLACE FUNCTION public.spmb_kk_verification_required_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT ARRAY[
    'nama',
    'jenis_kelamin',
    'tempat_lahir',
    'tanggal_lahir',
    'alamat',
    'nik',
    'no_kk',
    'nama_ayah',
    'pekerjaan_ayah',
    'nama_ibu',
    'pekerjaan_ibu',
    'dokumen_kk_path'
  ]::text[]
$$;

REVOKE ALL ON FUNCTION public.spmb_kk_verification_required_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_scope_kk_requirements(p_requirements jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_set(
        item,
        '{required}',
        to_jsonb((item->>'key') = ANY(public.spmb_kk_verification_required_keys())),
        true
      )
      ORDER BY ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(p_requirements, '[]'::jsonb))
       WITH ORDINALITY AS requirement(item, ord)
$$;

REVOKE ALL ON FUNCTION public.spmb_scope_kk_requirements(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_kk_verification_version(p_siswa_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT md5(jsonb_build_object(
    'nama', s.nama,
    'jenis_kelamin', s.jenis_kelamin,
    'tempat_lahir', s.tempat_lahir,
    'tanggal_lahir', s.tanggal_lahir,
    'alamat', s.alamat,
    'nik', d.nik,
    'no_kk', d.no_kk,
    'nama_ayah', d.nama_ayah,
    'pekerjaan_ayah', d.pekerjaan_ayah,
    'nama_ibu', d.nama_ibu,
    'pekerjaan_ibu', d.pekerjaan_ibu,
    'dokumen_kk_path', d.dokumen_kk_path
  )::text)
  FROM public.siswa s
  JOIN public.siswa_detail d ON d.siswa_id = s.id
  WHERE s.id = p_siswa_id
$$;

REVOKE ALL ON FUNCTION public.spmb_kk_verification_version(uuid) FROM PUBLIC, anon, authenticated;

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

  IF NOT public.can_access_spmb_siswa(uid, p_siswa_id) THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan atau akses ditolak';
  END IF;

  can_verify := public.has_role(uid, 'admin') OR public.has_role(uid, 'admin_tu');
  payload := public.spmb_verification_payload(p_siswa_id);

  requirements := public.spmb_scope_kk_requirements(
    payload->'requirements' || COALESCE((
      SELECT jsonb_agg(opt)
      FROM jsonb_array_elements(public.spmb_optional_verification_requirements(p_siswa_id)) opt
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload->'requirements') req
        WHERE req->>'key' = opt->>'key'
      )
    ), '[]'::jsonb)
  );

  current_version := public.spmb_kk_verification_version(p_siswa_id);
  checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb);

  SELECT
    count(*) FILTER (WHERE COALESCE((item->>'required')::boolean,false)),
    count(*) FILTER (
      WHERE COALESCE((item->>'required')::boolean,false)
        AND COALESCE((checklist->>(item->>'key'))::boolean,false)
    ),
    COALESCE(jsonb_agg(item->>'label') FILTER (
      WHERE COALESCE((item->>'required')::boolean,false)
        AND NOT COALESCE((item->>'valid')::boolean,false)
    ), '[]'::jsonb),
    COALESCE(jsonb_agg(item->>'label') FILTER (
      WHERE COALESCE((item->>'required')::boolean,false)
        AND NOT COALESCE((checklist->>(item->>'key'))::boolean,false)
    ), '[]'::jsonb)
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
      'status', x.status,
      'data_version', x.data_version,
      'reason', x.reason,
      'changed_fields', to_jsonb(x.changed_fields),
      'created_at', x.created_at,
      'petugas', x.actor_name
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
    'can_submit', can_verify
      AND s.status IN ('calon','diterima','aktif')
      AND total_required = checked_required
      AND jsonb_array_length(invalid_required) = 0,
    'history', history
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_verification_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_verification_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_set_field_verification(
  p_siswa_id uuid,
  p_field text,
  p_checked boolean,
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
  previous_internal text := COALESCE(current_setting('app.spmb_verification_internal', true), '');
BEGIN
  IF uid IS NULL OR NOT (
    public.has_role(uid, 'admin')
    OR (public.has_role(uid, 'admin_tu') AND public.can_access_spmb_siswa(uid, p_siswa_id))
  ) THEN
    RAISE EXCEPTION 'Akses verifikasi SPMB ditolak';
  END IF;

  IF NULLIF(trim(COALESCE(p_field,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Item pemeriksaan tidak valid';
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  requirements := public.spmb_scope_kk_requirements(payload->'requirements');
  current_version := public.spmb_kk_verification_version(p_siswa_id);

  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data KK berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  SELECT value INTO item
  FROM jsonb_array_elements(requirements)
  WHERE value->>'key' = p_field
  LIMIT 1;

  IF item IS NULL THEN
    RAISE EXCEPTION 'Item pemeriksaan tidak termasuk persyaratan SPMB saat ini';
  END IF;

  IF NOT COALESCE((item->>'required')::boolean,false) THEN
    RAISE EXCEPTION 'Item opsional tidak memerlukan checklist wajib';
  END IF;

  PERFORM set_config('app.spmb_verification_internal', '1', true);
  UPDATE public.siswa_detail
  SET spmb_verifikasi_fields = jsonb_set(
    COALESCE(spmb_verifikasi_fields, '{}'::jsonb),
    ARRAY[p_field],
    to_jsonb(COALESCE(p_checked,false)),
    true
  )
  WHERE siswa_id = p_siswa_id;
  PERFORM set_config('app.spmb_verification_internal', previous_internal, true);

  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;

REVOKE ALL ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) TO authenticated;

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
  IF uid IS NULL OR NOT (
    public.has_role(uid, 'admin')
    OR (public.has_role(uid, 'admin_tu') AND public.can_access_spmb_siswa(uid, p_siswa_id))
  ) THEN
    RAISE EXCEPTION 'Akses verifikasi SPMB ditolak';
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'Perubahan checklist tidak valid';
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  current_version := public.spmb_kk_verification_version(p_siswa_id);
  requirements := payload->'requirements' || public.spmb_optional_verification_requirements(p_siswa_id);

  IF NULLIF(p_version, '') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data KK berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  FOR change_key, change_value IN
    SELECT key, value FROM jsonb_each(p_changes)
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

CREATE OR REPLACE FUNCTION public.spmb_mark_verified(p_siswa_id uuid, p_version text)
RETURNS jsonb
LANGUAGE plpgsql
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
  item jsonb;
  item_key text;
  item_label text;
  previous_internal text := COALESCE(current_setting('app.spmb_verification_internal', true), '');
BEGIN
  IF uid IS NULL OR NOT (
    public.has_role(uid, 'admin')
    OR (public.has_role(uid, 'admin_tu') AND public.can_access_spmb_siswa(uid, p_siswa_id))
  ) THEN
    RAISE EXCEPTION 'Akses verifikasi SPMB ditolak';
  END IF;

  SELECT * INTO s
  FROM public.siswa
  WHERE id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;

  IF s.status NOT IN ('calon','diterima','aktif') THEN
    RAISE EXCEPTION 'Data SPMB tidak dapat diverifikasi pada status siswa saat ini';
  END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  requirements := public.spmb_scope_kk_requirements(payload->'requirements');
  current_version := public.spmb_kk_verification_version(p_siswa_id);

  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data KK berubah sejak diperiksa. Muat ulang halaman dan lakukan pemeriksaan ulang';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(requirements)
  LOOP
    IF COALESCE((item->>'required')::boolean,false) THEN
      item_key := item->>'key';
      item_label := item->>'label';

      IF NOT COALESCE((item->>'valid')::boolean,false) THEN
        RAISE EXCEPTION 'Data wajib berdasarkan KK belum tersedia atau tidak valid: %', item_label;
      END IF;

      IF NOT COALESCE((d.spmb_verifikasi_fields->>item_key)::boolean,false) THEN
        RAISE EXCEPTION 'Checklist wajib berdasarkan KK belum lengkap: %', item_label;
      END IF;
    END IF;
  END LOOP;

  IF d.dokumen_kk_path IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM storage.objects o
       WHERE o.bucket_id = 'pmb-dokumen'
         AND o.name = d.dokumen_kk_path
     ) THEN
    RAISE EXCEPTION 'Dokumen sumber verifikasi belum tersedia di penyimpanan: Kartu Keluarga';
  END IF;

  IF d.spmb_verifikasi_status = 'terverifikasi'
     AND d.spmb_verifikasi_version = current_version
     AND s.terverifikasi THEN
    RETURN public.spmb_verification_state(p_siswa_id);
  END IF;

  PERFORM set_config('app.spmb_verification_internal', '1', true);

  UPDATE public.siswa_detail
  SET spmb_verifikasi_version = current_version,
      spmb_verifikasi_status = 'terverifikasi',
      spmb_verifikasi_at = now(),
      spmb_verifikasi_by = uid,
      spmb_verifikasi_last_reason = NULL
  WHERE siswa_id = p_siswa_id;

  UPDATE public.siswa
  SET terverifikasi = true
  WHERE id = p_siswa_id;

  PERFORM set_config('app.spmb_verification_internal', previous_internal, true);

  INSERT INTO public.spmb_verifikasi_audit(
    siswa_id,
    status,
    data_version,
    checklist,
    actor_id,
    reason,
    changed_fields
  )
  VALUES (
    p_siswa_id,
    'terverifikasi',
    current_version,
    COALESCE(d.spmb_verifikasi_fields,'{}'::jsonb),
    uid,
    'Petugas menyelesaikan pemeriksaan data inti berdasarkan Kartu Keluarga',
    '{}'::text[]
  )
  ON CONFLICT DO NOTHING;

  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;

REVOKE ALL ON FUNCTION public.spmb_mark_verified(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_mark_verified(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_invalidate_verification(p_siswa_id uuid, p_fields text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d public.siswa_detail;
  s public.siswa;
  was_verified boolean := false;
  reason_text text;
  cleaned_checklist jsonb;
  relevant_fields text[] := '{}'::text[];
  previous_internal text := COALESCE(current_setting('app.spmb_verification_internal', true), '');
BEGIN
  SELECT COALESCE(array_agg(field_name), '{}'::text[])
  INTO relevant_fields
  FROM unnest(COALESCE(p_fields, '{}'::text[])) AS changed(field_name)
  WHERE field_name = ANY(public.spmb_kk_verification_required_keys());

  IF COALESCE(cardinality(relevant_fields),0) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Pendaftaran selesai diperlakukan sebagai histori.
  IF COALESCE(d.spmb_status_pendaftaran, '') = 'selesai' THEN
    RETURN;
  END IF;

  SELECT * INTO s
  FROM public.siswa
  WHERE id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  was_verified := d.spmb_verifikasi_status = 'terverifikasi' OR s.terverifikasi;
  reason_text := 'Data berdasarkan KK yang telah diperiksa berubah: ' || array_to_string(relevant_fields, ', ');
  cleaned_checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb) - relevant_fields;

  PERFORM set_config('app.spmb_verification_internal', '1', true);

  UPDATE public.siswa_detail
  SET spmb_verifikasi_fields = cleaned_checklist,
      spmb_verifikasi_status = CASE
        WHEN was_verified OR spmb_verifikasi_status = 'perlu_verifikasi_ulang'
          THEN 'perlu_verifikasi_ulang'
        ELSE spmb_verifikasi_status
      END,
      spmb_verifikasi_last_reason = CASE
        WHEN was_verified OR spmb_verifikasi_status = 'perlu_verifikasi_ulang'
          THEN reason_text
        ELSE spmb_verifikasi_last_reason
      END
  WHERE siswa_id = p_siswa_id;

  IF was_verified THEN
    UPDATE public.siswa
    SET terverifikasi = false
    WHERE id = p_siswa_id;

    INSERT INTO public.spmb_verifikasi_audit(
      siswa_id,
      status,
      data_version,
      checklist,
      actor_id,
      reason,
      changed_fields
    )
    VALUES (
      p_siswa_id,
      'perlu_verifikasi_ulang',
      d.spmb_verifikasi_version,
      cleaned_checklist,
      auth.uid(),
      reason_text,
      relevant_fields
    );
  END IF;

  PERFORM set_config('app.spmb_verification_internal', previous_internal, true);
END
$$;

REVOKE ALL ON FUNCTION public.spmb_invalidate_verification(uuid,text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_invalidate_on_siswa_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed text[] := '{}'::text[];
BEGIN
  IF NEW.nama IS DISTINCT FROM OLD.nama THEN changed := array_append(changed,'nama'); END IF;
  IF NEW.jenis_kelamin IS DISTINCT FROM OLD.jenis_kelamin THEN changed := array_append(changed,'jenis_kelamin'); END IF;
  IF NEW.tempat_lahir IS DISTINCT FROM OLD.tempat_lahir THEN changed := array_append(changed,'tempat_lahir'); END IF;
  IF NEW.tanggal_lahir IS DISTINCT FROM OLD.tanggal_lahir THEN changed := array_append(changed,'tanggal_lahir'); END IF;
  IF NEW.alamat IS DISTINCT FROM OLD.alamat THEN changed := array_append(changed,'alamat'); END IF;

  PERFORM public.spmb_invalidate_verification(NEW.id, changed);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS spmb_invalidate_siswa_verification ON public.siswa;
CREATE TRIGGER spmb_invalidate_siswa_verification
AFTER UPDATE OF nama, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat
ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.spmb_invalidate_on_siswa_change();

CREATE OR REPLACE FUNCTION public.spmb_invalidate_on_detail_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed text[] := '{}'::text[];
BEGIN
  IF NEW.nik IS DISTINCT FROM OLD.nik THEN changed := array_append(changed,'nik'); END IF;
  IF NEW.no_kk IS DISTINCT FROM OLD.no_kk THEN changed := array_append(changed,'no_kk'); END IF;
  IF NEW.nama_ayah IS DISTINCT FROM OLD.nama_ayah THEN changed := array_append(changed,'nama_ayah'); END IF;
  IF NEW.pekerjaan_ayah IS DISTINCT FROM OLD.pekerjaan_ayah THEN changed := array_append(changed,'pekerjaan_ayah'); END IF;
  IF NEW.nama_ibu IS DISTINCT FROM OLD.nama_ibu THEN changed := array_append(changed,'nama_ibu'); END IF;
  IF NEW.pekerjaan_ibu IS DISTINCT FROM OLD.pekerjaan_ibu THEN changed := array_append(changed,'pekerjaan_ibu'); END IF;
  IF NEW.dokumen_kk_path IS DISTINCT FROM OLD.dokumen_kk_path THEN changed := array_append(changed,'dokumen_kk_path'); END IF;

  PERFORM public.spmb_invalidate_verification(NEW.siswa_id, changed);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS spmb_invalidate_detail_verification ON public.siswa_detail;
CREATE TRIGGER spmb_invalidate_detail_verification
AFTER UPDATE OF nik, no_kk, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, dokumen_kk_path
ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.spmb_invalidate_on_detail_change();

-- Pertahankan status verifikasi lama jika data wajib KK saat ini masih valid.
-- Dengan ini perubahan scope tidak memaksa petugas memverifikasi ulang semua siswa.
UPDATE public.siswa_detail d
SET spmb_verifikasi_version = public.spmb_kk_verification_version(d.siswa_id)
FROM public.siswa s
WHERE s.id = d.siswa_id
  AND (d.spmb_verifikasi_status = 'terverifikasi' OR s.terverifikasi)
  AND char_length(trim(COALESCE(s.nama,''))) >= 2
  AND s.jenis_kelamin IN ('L','P')
  AND NULLIF(trim(COALESCE(s.tempat_lahir,'')),'') IS NOT NULL
  AND s.tanggal_lahir IS NOT NULL
  AND NULLIF(trim(COALESCE(s.alamat,'')),'') IS NOT NULL
  AND COALESCE(d.nik ~ '^[0-9]{16}$',false)
  AND NULLIF(trim(COALESCE(d.no_kk,'')),'') IS NOT NULL
  AND NULLIF(trim(COALESCE(d.nama_ayah,'')),'') IS NOT NULL
  AND NULLIF(trim(COALESCE(d.pekerjaan_ayah,'')),'') IS NOT NULL
  AND NULLIF(trim(COALESCE(d.nama_ibu,'')),'') IS NOT NULL
  AND NULLIF(trim(COALESCE(d.pekerjaan_ibu,'')),'') IS NOT NULL
  AND d.dokumen_kk_path IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'pmb-dokumen'
      AND o.name = d.dokumen_kk_path
  );

COMMENT ON FUNCTION public.spmb_kk_verification_required_keys() IS
  'Daftar field wajib untuk verifikasi dari halaman Edit Siswa; dibatasi pada data inti yang dapat dicocokkan dengan KK.';
