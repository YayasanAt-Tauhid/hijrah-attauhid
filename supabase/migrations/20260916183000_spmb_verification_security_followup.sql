-- Follow-up hardening for Verifikasi Data SPMB.
-- The first versioned verification migration is already applied; this migration
-- closes direct-table bypasses and verifies that required document objects exist.

CREATE OR REPLACE FUNCTION public.spmb_guard_siswa_verification_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.terverifikasi IS DISTINCT FROM NEW.terverifikasi
     AND COALESCE(current_setting('app.spmb_verification_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Status Verifikasi Data SPMB hanya boleh diubah melalui alur Pemeriksaan Data SPMB';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS spmb_guard_siswa_verification_state ON public.siswa;
CREATE TRIGGER spmb_guard_siswa_verification_state
BEFORE UPDATE OF terverifikasi ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.spmb_guard_siswa_verification_state();

CREATE OR REPLACE FUNCTION public.spmb_guard_detail_verification_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.spmb_verification_internal', true), '') <> '1'
     AND (
       OLD.spmb_verifikasi_fields IS DISTINCT FROM NEW.spmb_verifikasi_fields
       OR OLD.spmb_verifikasi_version IS DISTINCT FROM NEW.spmb_verifikasi_version
       OR OLD.spmb_verifikasi_status IS DISTINCT FROM NEW.spmb_verifikasi_status
       OR OLD.spmb_verifikasi_at IS DISTINCT FROM NEW.spmb_verifikasi_at
       OR OLD.spmb_verifikasi_by IS DISTINCT FROM NEW.spmb_verifikasi_by
       OR OLD.spmb_verifikasi_last_reason IS DISTINCT FROM NEW.spmb_verifikasi_last_reason
     ) THEN
    RAISE EXCEPTION 'State Pemeriksaan Data SPMB hanya boleh diubah melalui alur verifikasi resmi';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS spmb_guard_detail_verification_state ON public.siswa_detail;
CREATE TRIGGER spmb_guard_detail_verification_state
BEFORE UPDATE OF spmb_verifikasi_fields, spmb_verifikasi_version, spmb_verifikasi_status,
  spmb_verifikasi_at, spmb_verifikasi_by, spmb_verifikasi_last_reason
ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.spmb_guard_detail_verification_state();

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
  item jsonb;
  current_version text;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
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
  current_version := payload->>'version';
  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  SELECT value INTO item
  FROM jsonb_array_elements(payload->'requirements')
  WHERE value->>'key' = p_field
  LIMIT 1;

  IF item IS NULL THEN
    RAISE EXCEPTION 'Item pemeriksaan tidak termasuk persyaratan SPMB saat ini';
  END IF;
  IF NOT COALESCE((item->>'required')::boolean,false) THEN
    RAISE EXCEPTION 'Dokumen opsional tidak memerlukan checklist wajib';
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

  RETURN public.spmb_verification_state(p_siswa_id);
END
$$;

REVOKE ALL ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_field_verification(uuid,text,boolean,text) TO authenticated;

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
  current_version text;
  item jsonb;
  item_key text;
  item_label text;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
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
  current_version := payload->>'version';

  IF NULLIF(p_version,'') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah sejak diperiksa. Muat ulang halaman dan lakukan pemeriksaan ulang';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(payload->'requirements') LOOP
    IF COALESCE((item->>'required')::boolean,false) THEN
      item_key := item->>'key';
      item_label := item->>'label';

      IF NOT COALESCE((item->>'valid')::boolean,false) THEN
        RAISE EXCEPTION 'Data/dokumen wajib belum tersedia atau tidak valid: %', item_label;
      END IF;

      IF NOT COALESCE((d.spmb_verifikasi_fields->>item_key)::boolean,false) THEN
        RAISE EXCEPTION 'Checklist wajib belum lengkap: %', item_label;
      END IF;
    END IF;
  END LOOP;

  -- A valid-looking storage path is not enough: the required file must exist.
  IF d.dokumen_kk_path IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'pmb-dokumen' AND o.name = d.dokumen_kk_path
     ) THEN
    RAISE EXCEPTION 'Dokumen wajib belum tersedia di penyimpanan: Kartu Keluarga';
  END IF;

  IF d.dokumen_akta_path IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'pmb-dokumen' AND o.name = d.dokumen_akta_path
     ) THEN
    RAISE EXCEPTION 'Dokumen wajib belum tersedia di penyimpanan: Akta Kelahiran';
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

  INSERT INTO public.spmb_verifikasi_audit(
    siswa_id,status,data_version,checklist,actor_id,reason,changed_fields
  )
  VALUES (
    p_siswa_id,'terverifikasi',current_version,
    COALESCE(d.spmb_verifikasi_fields,'{}'::jsonb),uid,
    'Petugas menyelesaikan pemeriksaan data dan dokumen wajib SPMB',
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
BEGIN
  IF COALESCE(cardinality(p_fields),0) = 0 THEN RETURN; END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO s
  FROM public.siswa
  WHERE id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  was_verified := d.spmb_verifikasi_status = 'terverifikasi' OR s.terverifikasi;
  reason_text := 'Data/dokumen SPMB yang telah diperiksa berubah: ' || array_to_string(p_fields, ', ');
  cleaned_checklist := COALESCE(d.spmb_verifikasi_fields, '{}'::jsonb) - p_fields;

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
      siswa_id,status,data_version,checklist,actor_id,reason,changed_fields
    )
    VALUES (
      p_siswa_id,'perlu_verifikasi_ulang',d.spmb_verifikasi_version,
      cleaned_checklist,auth.uid(),reason_text,p_fields
    );
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_invalidate_verification(uuid,text[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.spmb_mark_verified(uuid,text) IS
  'Atomically verifies saved SPMB data after role, version, checklist, field and storage-document validation.';
