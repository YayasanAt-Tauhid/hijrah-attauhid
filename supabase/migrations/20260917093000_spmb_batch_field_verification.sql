-- Store multiple SPMB checklist decisions atomically after the student data save succeeds.
-- The RPC keeps role checks and immutable data-version protection, and does not
-- change selection, payment, graduation, or student activation state.

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

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan';
  END IF;

  payload := public.spmb_verification_payload(p_siswa_id);
  current_version := payload->>'version';
  IF NULLIF(p_version, '') IS NULL OR p_version <> current_version THEN
    RAISE EXCEPTION 'Data berubah. Muat ulang halaman dan periksa kembali perubahan tersebut';
  END IF;

  FOR change_key, change_value IN
    SELECT key, value FROM jsonb_each(p_changes)
  LOOP
    IF jsonb_typeof(change_value) <> 'boolean' THEN
      RAISE EXCEPTION 'Nilai checklist tidak valid: %', change_key;
    END IF;

    SELECT value INTO item
    FROM jsonb_array_elements(payload->'requirements')
    WHERE value->>'key' = change_key
    LIMIT 1;

    IF item IS NULL THEN
      RAISE EXCEPTION 'Item pemeriksaan tidak termasuk persyaratan SPMB saat ini: %', change_key;
    END IF;
    IF NOT COALESCE((item->>'required')::boolean, false) THEN
      RAISE EXCEPTION 'Item opsional tidak memerlukan checklist wajib: %', change_key;
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
  'Atomically stores a batch of required SPMB checklist decisions for one immutable saved-data version.';
