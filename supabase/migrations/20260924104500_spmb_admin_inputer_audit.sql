-- Track whether an SPMB registration was entered by a logged-in academic officer.
-- Public registrations keep these actor columns NULL and source='publik'.

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_inputer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spmb_inputer_nama text,
  ADD COLUMN IF NOT EXISTS spmb_inputer_email text,
  ADD COLUMN IF NOT EXISTS spmb_sumber_pendaftaran text;

UPDATE public.siswa_detail
SET spmb_sumber_pendaftaran = CASE
  WHEN spmb_inputer_user_id IS NOT NULL THEN 'admin'
  ELSE 'publik'
END
WHERE pmb_payment_token IS NOT NULL
  AND spmb_sumber_pendaftaran IS NULL;

ALTER TABLE public.siswa_detail
  DROP CONSTRAINT IF EXISTS siswa_detail_spmb_sumber_pendaftaran_check;

ALTER TABLE public.siswa_detail
  ADD CONSTRAINT siswa_detail_spmb_sumber_pendaftaran_check
  CHECK (
    spmb_sumber_pendaftaran IS NULL
    OR spmb_sumber_pendaftaran IN ('publik', 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_siswa_detail_spmb_inputer_user
  ON public.siswa_detail (spmb_inputer_user_id)
  WHERE spmb_inputer_user_id IS NOT NULL;

COMMENT ON COLUMN public.siswa_detail.spmb_inputer_user_id IS
  'Auth user petugas yang memasukkan pendaftaran dari /akademik/spmb; NULL untuk pendaftaran publik.';
COMMENT ON COLUMN public.siswa_detail.spmb_inputer_nama IS
  'Snapshot nama petugas/inputer saat pendaftaran admin dibuat.';
COMMENT ON COLUMN public.siswa_detail.spmb_inputer_email IS
  'Snapshot email akun petugas/inputer saat pendaftaran admin dibuat.';
COMMENT ON COLUMN public.siswa_detail.spmb_sumber_pendaftaran IS
  'Sumber input pendaftaran SPMB: publik atau admin.';
