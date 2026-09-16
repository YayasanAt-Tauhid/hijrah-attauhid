-- Harden SPMB verification workflow
-- Verification must be based on saved data, checklist state, and server-side validation.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_version text,
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_status text DEFAULT 'belum_verifikasi',
  ADD COLUMN IF NOT EXISTS spmb_verifikasi_last_reason text;

CREATE TABLE IF NOT EXISTS public.spmb_verifikasi_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  status text NOT NULL,
  data_version text,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spmb_verifikasi_audit_siswa_idx
  ON public.spmb_verifikasi_audit(siswa_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.spmb_mark_verified(
  p_siswa_id uuid,
  p_version text,
  p_checklist jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d siswa_detail;
  required_fields text[] := ARRAY[
    'tahun_ajaran_id', 'jenis_pendaftaran', 'kategori', 'nik', 'no_kk',
    'nama_ayah', 'nama_ibu', 'dokumen_kk_path', 'dokumen_akta_path'
  ];
  f text;
BEGIN
  SELECT * INTO d
  FROM siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan';
  END IF;

  IF p_version IS NULL OR p_version = '' THEN
    RAISE EXCEPTION 'Versi data tidak tersedia';
  END IF;

  IF d.spmb_verifikasi_version IS NOT NULL
     AND d.spmb_verifikasi_version <> p_version THEN
    RAISE EXCEPTION 'Data berubah. Silakan muat ulang dan periksa kembali';
  END IF;

  FOREACH f IN ARRAY required_fields LOOP
    IF COALESCE((p_checklist ->> f)::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Checklist wajib belum lengkap: %', f;
    END IF;
  END LOOP;

  UPDATE siswa_detail
  SET spmb_verifikasi_version = p_version,
      spmb_verifikasi_status = 'terverifikasi',
      spmb_verifikasi_last_reason = NULL
  WHERE siswa_id = p_siswa_id;

  INSERT INTO public.spmb_verifikasi_audit(siswa_id, status, data_version, checklist)
  VALUES (p_siswa_id, 'terverifikasi', p_version, p_checklist);

  RETURN jsonb_build_object('status','terverifikasi');
END;
$$;

REVOKE ALL ON FUNCTION public.spmb_mark_verified(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_mark_verified(uuid,text,jsonb) TO authenticated;
