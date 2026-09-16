-- Aksi admin SPMB dibuat atomik agar checklist dan tanggal proses tidak saling menimpa.

CREATE OR REPLACE FUNCTION public.spmb_set_field_verification(
  p_siswa_id uuid,
  p_field text,
  p_checked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_siswa_id IS NULL OR NULLIF(trim(p_field), '') IS NULL THEN
    RAISE EXCEPTION 'Data checklist tidak lengkap';
  END IF;

  UPDATE siswa_detail
  SET spmb_verifikasi_fields = jsonb_set(
    COALESCE(spmb_verifikasi_fields, '{}'::jsonb),
    ARRAY[p_field],
    to_jsonb(COALESCE(p_checked, false)),
    true
  )
  WHERE siswa_id = p_siswa_id
  RETURNING spmb_verifikasi_fields INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan atau akses ditolak';
  END IF;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_set_field_verification(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_set_field_verification(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.spmb_mark_milestone(
  p_siswa_id uuid,
  p_action text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d siswa_detail;
  marked_at timestamptz := now();
BEGIN
  SELECT * INTO d
  FROM siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan atau akses ditolak';
  END IF;

  CASE p_action
    WHEN 'tes' THEN
      IF d.spmb_tanggal_tes IS NOT NULL THEN
        RETURN d.spmb_tanggal_tes;
      END IF;
      UPDATE siswa_detail SET spmb_tanggal_tes = marked_at WHERE siswa_id = p_siswa_id;

    WHEN 'lulus' THEN
      IF d.spmb_tanggal_tes IS NULL THEN
        RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu';
      END IF;
      IF d.spmb_tanggal_lulus IS NOT NULL THEN
        RETURN d.spmb_tanggal_lulus;
      END IF;
      UPDATE siswa_detail SET spmb_tanggal_lulus = marked_at WHERE siswa_id = p_siswa_id;

    WHEN 'daftar_ulang' THEN
      IF d.spmb_tanggal_lulus IS NULL THEN
        RAISE EXCEPTION 'Calon murid harus dinyatakan Lulus terlebih dahulu';
      END IF;
      IF d.spmb_tanggal_daftar_ulang IS NOT NULL THEN
        RETURN d.spmb_tanggal_daftar_ulang;
      END IF;
      UPDATE siswa_detail SET spmb_tanggal_daftar_ulang = marked_at WHERE siswa_id = p_siswa_id;

    ELSE
      RAISE EXCEPTION 'Aksi SPMB tidak valid';
  END CASE;

  RETURN marked_at;
END
$$;

REVOKE ALL ON FUNCTION public.spmb_mark_milestone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_mark_milestone(uuid, text) TO authenticated;
