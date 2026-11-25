-- Akses baca tambahan, hanya SELECT:
--  1. keuangan membaca tabel siswa (halaman /akademik/siswa mode baca saja).
--     siswa_detail sudah terbaca oleh peran non-admin_tu lewat "Auth read siswa_detail",
--     kelas/kelas_siswa/departemen juga, jadi hanya siswa yang kurang.
--  2. admin_tu membaca harga_seragam_vendor milik departemen yang ia kelola
--     (halaman /keuangan/seragam-vendor), tanpa hak ubah.
-- Tidak ada GRANT baru: hak tabel untuk authenticated sudah ada, RLS yang membatasi.
-- Tidak mengubah, menghapus, atau menyentuh baris data apa pun.
--
-- Rollback (tidak menyentuh data):
--   DROP POLICY keuangan_siswa_select ON public.siswa;
--   DROP POLICY admin_tu_baca_harga_seragam_vendor ON public.harga_seragam_vendor;

DROP POLICY IF EXISTS keuangan_siswa_select ON public.siswa;
CREATE POLICY keuangan_siswa_select ON public.siswa
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS admin_tu_baca_harga_seragam_vendor ON public.harga_seragam_vendor;
CREATE POLICY admin_tu_baca_harga_seragam_vendor ON public.harga_seragam_vendor
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_tu')
    AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
  );
