-- PMB online payment: transaksi pendaftaran publik belum memiliki akun portal orang tua.
-- user_id tetap dipakai untuk transaksi portal biasa, tetapi boleh NULL khusus PMB.
ALTER TABLE public.transaksi_midtrans
  ALTER COLUMN user_id DROP NOT NULL;

-- Token rahasia sekali-pendaftaran untuk mengotorisasi checkout publik tanpa login.
ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS pmb_payment_token uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_siswa_detail_pmb_payment_token
  ON public.siswa_detail(pmb_payment_token)
  WHERE pmb_payment_token IS NOT NULL;

COMMENT ON COLUMN public.siswa_detail.pmb_payment_token IS
  'Token server-generated untuk checkout PMB publik; jangan ditampilkan selain ke browser pendaftar saat submit berhasil.';

COMMENT ON COLUMN public.transaksi_midtrans.user_id IS
  'Akun portal orang tua. NULL hanya untuk transaksi PMB publik sebelum akun portal dibuat.';