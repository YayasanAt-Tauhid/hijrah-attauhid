-- Buku Besar "Semua akun rekening": ringkasan per akun untuk tampilan layar.
-- Layar tidak lagi mengunduh seluruh mutasi (puluhan ribu baris per tahun); cukup
-- total debit, total kredit, dan jumlah baris per akun. Mutasi rinci satu akun
-- dimuat saat barisnya dibuka (buku_besar_mutasi per akun), dan seluruh mutasi hanya
-- diambil saat export (buku_besar_mutasi_semua).
--
-- Filter SAMA PERSIS dengan buku_besar_mutasi_semua (jurnal 'posted', rentang tanggal,
-- penutup, unit, pengecualian koreksi) supaya angka ringkasan = jumlah mutasi rinci.
-- Saldo awal tetap dari buku_besar_saldo_awal_semua. Tidak mengubah fungsi lama,
-- tabel, maupun data. Akses: admin/kepala/keuangan (dicek di dalam fungsi) dan hanya
-- untuk role authenticated + service_role.

CREATE OR REPLACE FUNCTION public.buku_besar_ringkasan_semua(
  p_tgl_awal date, p_tgl_akhir date,
  p_departemen_ids uuid[] DEFAULT NULL::uuid[],
  p_include_penutup boolean DEFAULT false,
  p_exclude_koreksi boolean DEFAULT false
)
RETURNS TABLE(akun_id uuid, total_debit numeric, total_kredit numeric, jumlah integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan')) THEN
    RAISE EXCEPTION 'Tidak diizinkan mengakses buku besar';
  END IF;

  RETURN QUERY
  SELECT jd.akun_id,
         COALESCE(SUM(jd.debit), 0),
         COALESCE(SUM(jd.kredit), 0),
         COUNT(*)::integer
  FROM jurnal_detail jd
  JOIN jurnal j ON j.id = jd.jurnal_id
  JOIN akun_rekening a ON a.id = jd.akun_id
  WHERE j.status = 'posted'
    AND j.tanggal BETWEEN p_tgl_awal AND p_tgl_akhir
    AND (p_include_penutup OR COALESCE(j.tipe, '') <> 'penutup')
    AND (p_departemen_ids IS NULL OR j.departemen_id = ANY(p_departemen_ids))
    AND (NOT p_exclude_koreksi OR (
      (j.tipe <> 'pembalik' OR j.tipe IS NULL)
      AND NOT EXISTS (SELECT 1 FROM jurnal jp WHERE jp.jurnal_asal_id = j.id)
    ))
  GROUP BY jd.akun_id, a.kode
  ORDER BY a.kode, jd.akun_id;
END;
$function$;

-- Hardening sama dengan fungsi buku besar lain (lihat 20261005044657 dan
-- 20261117090000): tidak bisa dipanggil anon/PUBLIC; role authenticated dibatasi lagi
-- oleh pengecekan peran di atas.
REVOKE ALL ON FUNCTION public.buku_besar_ringkasan_semua(date, date, uuid[], boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buku_besar_ringkasan_semua(date, date, uuid[], boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.buku_besar_ringkasan_semua(date, date, uuid[], boolean, boolean) TO authenticated, service_role;
