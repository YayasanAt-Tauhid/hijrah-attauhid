-- Pembukaan SPMB dimulai 23 Sep 2026. Payment untuk pendaftaran lama
-- tidak boleh dibuka sebelum periode tersebut; Gelombang 1 sendiri gratis.
CREATE OR REPLACE FUNCTION public.guard_spmb_public_payment_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  registered_at timestamptz;
  current_at timestamptz;
BEGIN
  IF COALESCE(NEW.metadata->>'source', '') <> 'pmb_public' THEN
    RETURN NEW;
  END IF;

  BEGIN
    sid := NULLIF(NEW.metadata->>'siswa_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak valid';
  END;

  IF sid IS NULL THEN RAISE EXCEPTION 'Metadata siswa SPMB tidak lengkap'; END IF;

  SELECT created_at INTO registered_at FROM public.siswa WHERE id = sid;
  IF registered_at IS NULL THEN RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan'; END IF;

  current_at := clock_timestamp();
  IF current_at < timestamptz '2026-09-22 17:00:00+00' THEN
    RAISE EXCEPTION 'SPMB Gelombang 1 belum dibuka; pendaftaran dimulai 23 September 2026 (Asia/Jakarta)';
  END IF;

  IF public.spmb_is_first_wave_free(registered_at) THEN
    RAISE EXCEPTION 'Pendaftar Gelombang Pertama berhak gratis biaya pendaftaran; transaksi tidak dibuat';
  END IF;

  IF current_at < timestamptz '2026-10-30 17:00:00+00' THEN
    RAISE EXCEPTION 'Pembayaran biaya pendaftaran ditutup selama Gelombang Pertama dan tersedia mulai 31 Oktober 2026 (Asia/Jakarta)';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_spmb_public_payment_policy() FROM PUBLIC, anon;
