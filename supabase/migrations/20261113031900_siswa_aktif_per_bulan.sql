-- Migrasi 01: rentang aktif per siswa + hitung saudara aktif PER BULAN SPP.
-- Tambahan saja (kolom nullable + fungsi baru); rollback = DROP FUNCTION / DROP COLUMN.
ALTER TABLE public.siswa
  ADD COLUMN IF NOT EXISTS tanggal_mulai_aktif date,
  ADD COLUMN IF NOT EXISTS tanggal_akhir_aktif date;

COMMENT ON COLUMN public.siswa.tanggal_mulai_aktif IS
  'Hari pertama siswa terdaftar aktif. NULL = sudah aktif sejak sebelum pencatatan ini. Wajib terisi untuk status diterima agar dihitung sebagai saudara aktif.';
COMMENT ON COLUMN public.siswa.tanggal_akhir_aktif IS
  'Hari terakhir siswa terdaftar aktif (lulus/keluar). NULL = masih aktif. Wajib terisi untuk status alumni/keluar/pindah/mengundurkan_diri agar bulan-bulan sebelumnya tetap dihitung.';

CREATE OR REPLACE FUNCTION public.siswa_aktif_di_bulan(
  p_status text, p_mulai date, p_akhir date, p_bulan date
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $f$
  SELECT
    CASE
      WHEN p_status = 'aktif' THEN true
      WHEN p_status = 'diterima' THEN p_mulai IS NOT NULL
      WHEN p_status IN ('alumni','keluar','pindah','mengundurkan_diri') THEN p_akhir IS NOT NULL
      ELSE false
    END
    AND (p_mulai IS NULL OR p_mulai <= (date_trunc('month', p_bulan) + interval '1 month - 1 day')::date)
    AND (p_akhir IS NULL OR p_akhir >= date_trunc('month', p_bulan)::date);
$f$;

CREATE OR REPLACE FUNCTION public.jumlah_saudara_aktif(p_keluarga_id uuid, p_bulan date)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $f$
  SELECT count(*)::integer
  FROM public.siswa s
  WHERE s.keluarga_id = p_keluarga_id
    AND public.siswa_aktif_di_bulan(s.status, s.tanggal_mulai_aktif, s.tanggal_akhir_aktif, p_bulan);
$f$;

REVOKE ALL ON FUNCTION public.siswa_aktif_di_bulan(text,date,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jumlah_saudara_aktif(uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siswa_aktif_di_bulan(text,date,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.jumlah_saudara_aktif(uuid,date) TO service_role;
