-- Izinkan pembayaran SPMB publik sebelum periode promo Gelombang Pertama.
-- Selama 21 Sep–23 Okt 2026 pembayaran ditutup; pendaftar pada periode tersebut
-- tetap gratis permanen berdasarkan timestamp pendaftarannya.

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

  IF sid IS NULL THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak lengkap';
  END IF;

  SELECT created_at INTO registered_at
  FROM public.siswa
  WHERE id = sid;

  IF registered_at IS NULL THEN
    RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan';
  END IF;

  IF public.spmb_is_first_wave_free(registered_at) THEN
    RAISE EXCEPTION 'Pendaftar Gelombang Pertama berhak gratis biaya pendaftaran; transaksi tidak dibuat';
  END IF;

  current_at := clock_timestamp();
  IF current_at >= timestamptz '2026-09-20 17:00:00+00'
     AND current_at < timestamptz '2026-10-23 17:00:00+00' THEN
    RAISE EXCEPTION 'Pembayaran biaya pendaftaran ditutup selama promo Gelombang Pertama dan tersedia kembali mulai 24 Oktober 2026 (Asia/Jakarta)';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_spmb_public_payment_policy() FROM PUBLIC, anon;
