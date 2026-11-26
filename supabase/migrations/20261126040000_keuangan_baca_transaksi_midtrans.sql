-- Perbaikan /keuangan/online-payment untuk peran keuangan: daftar transaksi dan
-- laporan per jenis tampil kosong karena RLS di produksi tidak punya policy SELECT
-- untuk keuangan pada dua tabel Midtrans (hanya admin/kepala sekolah dan pemilik
-- transaksi). Policy admin_keuangan_manage_transaksi_midtrans dari migrasi awal
-- tidak ada di database produksi.
--
-- Hanya SELECT (hak minimum untuk halaman baca-saja). Tidak ada GRANT baru: hak
-- tabel untuk authenticated sudah ada, RLS yang membatasi. Policy RESTRICTIVE
-- deny_kepala_sekolah_finance tetap berlaku. public.has_role(..., 'keuangan')
-- juga mencakup bendahara/sekretaris_yayasan yang punya izin keuangan.akses_data.
-- Tidak mengubah, menghapus, atau menyentuh baris data apa pun.
--
-- Rollback (tidak menyentuh data):
--   DROP POLICY keuangan_baca_transaksi_midtrans ON public.transaksi_midtrans;
--   DROP POLICY keuangan_baca_transaksi_midtrans_item ON public.transaksi_midtrans_item;

DROP POLICY IF EXISTS keuangan_baca_transaksi_midtrans ON public.transaksi_midtrans;
CREATE POLICY keuangan_baca_transaksi_midtrans ON public.transaksi_midtrans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS keuangan_baca_transaksi_midtrans_item ON public.transaksi_midtrans_item;
CREATE POLICY keuangan_baca_transaksi_midtrans_item ON public.transaksi_midtrans_item
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'keuangan'));
