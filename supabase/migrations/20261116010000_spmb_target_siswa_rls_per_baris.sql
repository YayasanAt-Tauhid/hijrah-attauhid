-- Perbaiki lambatnya spmb_readiness_list / halaman Statistik SPMB untuk Admin TU.
--
-- Gejala (16 Nov 2026): /akademik/spmb/statistik "Memuat…" lama lalu gagal untuk SEMUA
-- admin_tu; admin normal. Terukur di produksi (tiruan login lewat SET LOCAL ROLE authenticated,
-- hanya baca): `SELECT * FROM siswa WHERE id = …` 184-203 ms untuk admin_tu vs 3,5 ms untuk
-- admin; spmb_readiness_list 12 id = 2,6 dtk (admin_tu) vs 0,13 dtk (admin).
--
-- Penyebab: kebijakan SELECT `admin_tu_spmb_target_siswa_select` dan
-- `kepsek_spmb_target_siswa_select` di `siswa` memakai EXISTS (SELECT … FROM siswa_detail d
-- WHERE d.siswa_id = siswa.id AND … can_manage_akademik_departemen(…)). Karena digabung OR dengan
-- kebijakan lain, Postgres merencanakannya sebagai hashed SubPlan yang tidak berkorelasi:
-- SETIAP lookup satu siswa memeriksa SELURUH baris siswa_detail ber-tujuan SPMB (226 baris, tiap
-- baris memanggil has_role + can_manage_akademik_departemen). spmb_readiness memanggil lookup itu
-- per pendaftar, jadi biayanya kuadratik terhadap jumlah pendaftar.
--
-- Perbaikan: bungkus pemeriksaan yang sama dalam fungsi SECURITY DEFINER yang menerima siswa.id,
-- sehingga hanya dievaluasi untuk baris yang benar-benar dibaca (tidak bisa jadi hashed
-- SubPlan). Semantik tidak berubah: kondisi dan fungsi pemeriksa lembaga identik dengan kebijakan
-- lama (admin_tu: tanpa syarat gelombang; kepala_sekolah: wajib spmb_gelombang_id terisi).
-- Ditambah indeks siswa_detail(siswa_id), yang selama ini tidak ada (dipakai pencarian per siswa
-- di spmb_readiness, kebijakan, dan pembentukan daftar).
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi (dry-run
-- BEGIN…ROLLBACK dulu, bandingkan himpunan siswa yang terlihat per pengguna sebelum/sesudah).
--
-- Mengembalikan ke keadaan lama (bila perlu):
--   DROP POLICY admin_tu_spmb_target_siswa_select ON public.siswa;
--   CREATE POLICY admin_tu_spmb_target_siswa_select ON public.siswa FOR SELECT TO authenticated
--     USING (public.has_role(auth.uid(),'admin_tu') AND EXISTS (
--       SELECT 1 FROM public.siswa_detail d WHERE d.siswa_id=siswa.id
--         AND d.spmb_departemen_tujuan_id IS NOT NULL
--         AND public.can_manage_akademik_departemen(auth.uid(),d.spmb_departemen_tujuan_id)));
--   DROP POLICY kepsek_spmb_target_siswa_select ON public.siswa;
--   CREATE POLICY kepsek_spmb_target_siswa_select ON public.siswa FOR SELECT TO authenticated
--     USING (public.has_role(auth.uid(),'kepala_sekolah') AND EXISTS (
--       SELECT 1 FROM public.siswa_detail d WHERE d.siswa_id=siswa.id
--         AND d.spmb_gelombang_id IS NOT NULL AND d.spmb_departemen_tujuan_id IS NOT NULL
--         AND public.can_manage_akademik_departemen(auth.uid(),d.spmb_departemen_tujuan_id)));
--   DROP FUNCTION public.can_manage_spmb_target_siswa(uuid,uuid,boolean);
--   DROP INDEX public.siswa_detail_siswa_id_idx;

CREATE INDEX IF NOT EXISTS siswa_detail_siswa_id_idx ON public.siswa_detail (siswa_id);

CREATE OR REPLACE FUNCTION public.can_manage_spmb_target_siswa(
  _user_id uuid,
  _siswa_id uuid,
  _require_registration boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.siswa_detail d
    WHERE d.siswa_id = _siswa_id
      AND d.spmb_departemen_tujuan_id IS NOT NULL
      AND (NOT _require_registration OR d.spmb_gelombang_id IS NOT NULL)
      AND public.can_manage_akademik_departemen(_user_id, d.spmb_departemen_tujuan_id)
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_spmb_target_siswa(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_spmb_target_siswa(uuid,uuid,boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS admin_tu_spmb_target_siswa_select ON public.siswa;
CREATE POLICY admin_tu_spmb_target_siswa_select ON public.siswa
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin_tu')
  AND public.can_manage_spmb_target_siswa(auth.uid(), id)
);

DROP POLICY IF EXISTS kepsek_spmb_target_siswa_select ON public.siswa;
CREATE POLICY kepsek_spmb_target_siswa_select ON public.siswa
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_spmb_target_siswa(auth.uid(), id, true)
);
