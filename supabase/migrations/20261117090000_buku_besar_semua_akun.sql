-- Buku Besar "Semua akun rekening".
-- Dua fungsi baru yang menghitung SEMUA akun sekaligus, dengan aturan yang sama
-- persis dengan buku_besar_saldo_awal / buku_besar_mutasi (per akun):
--   * hanya jurnal berstatus 'posted'
--   * saldo awal = saldo_awal_isak35 tahun kalender p_tgl_awal
--                  + mutasi sejak 1 Januari tahun itu sampai sebelum p_tgl_awal
--     (tanpa jurnal penutup), saldo normal 'K' => kredit - debit, selain itu debit - kredit
--   * filter unit (p_departemen_ids) dan p_exclude_koreksi sama seperti fungsi per akun
-- Tidak mengubah fungsi lama, tabel, maupun data. Akses: admin/kepala/keuangan
-- (dicek di dalam fungsi) dan hanya untuk role authenticated + service_role.

CREATE OR REPLACE FUNCTION public.buku_besar_saldo_awal_semua(
  p_tgl_awal date,
  p_departemen_ids uuid[] DEFAULT NULL::uuid[],
  p_exclude_koreksi boolean DEFAULT false
)
RETURNS TABLE(akun_id uuid, saldo numeric)
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
  WITH sa AS (
    SELECT s.akun_id, COALESCE(SUM(s.saldo), 0) AS v
    FROM saldo_awal_isak35 s
    WHERE s.tahun = EXTRACT(YEAR FROM p_tgl_awal)::int
      AND (p_departemen_ids IS NULL OR s.departemen_id = ANY(p_departemen_ids))
    GROUP BY s.akun_id
  ),
  mut AS (
    SELECT jd.akun_id, COALESCE(SUM(jd.debit), 0) AS d, COALESCE(SUM(jd.kredit), 0) AS k
    FROM jurnal_detail jd
    JOIN jurnal j ON j.id = jd.jurnal_id
    WHERE j.status = 'posted'
      AND COALESCE(j.tipe, '') <> 'penutup'
      AND j.tanggal >= make_date(EXTRACT(YEAR FROM p_tgl_awal)::int, 1, 1)
      AND j.tanggal < p_tgl_awal
      AND (p_departemen_ids IS NULL OR j.departemen_id = ANY(p_departemen_ids))
      AND (NOT p_exclude_koreksi OR (
        (j.tipe <> 'pembalik' OR j.tipe IS NULL)
        AND NOT EXISTS (SELECT 1 FROM jurnal jp WHERE jp.jurnal_asal_id = j.id)
      ))
    GROUP BY jd.akun_id
  ),
  hasil AS (
    SELECT a.id AS akun_id,
           COALESCE(sa.v, 0) + CASE WHEN a.saldo_normal = 'K'
             THEN COALESCE(mut.k, 0) - COALESCE(mut.d, 0)
             ELSE COALESCE(mut.d, 0) - COALESCE(mut.k, 0) END AS saldo
    FROM akun_rekening a
    LEFT JOIN sa ON sa.akun_id = a.id
    LEFT JOIN mut ON mut.akun_id = a.id
  )
  SELECT h.akun_id, h.saldo FROM hasil h WHERE h.saldo <> 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.buku_besar_mutasi_semua(
  p_tgl_awal date, p_tgl_akhir date,
  p_departemen_ids uuid[] DEFAULT NULL::uuid[],
  p_include_penutup boolean DEFAULT false,
  p_exclude_koreksi boolean DEFAULT false
)
RETURNS TABLE(akun_id uuid, tanggal date, nomor text, lembaga text, keterangan text, debit numeric, kredit numeric, tipe text)
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
         j.tanggal,
         j.nomor,
         COALESCE(d.nama, '-'),
         COALESCE(NULLIF(jd.keterangan, ''), j.keterangan, '-'),
         jd.debit,
         jd.kredit,
         COALESCE(j.tipe, 'normal')
  FROM jurnal_detail jd
  JOIN jurnal j ON j.id = jd.jurnal_id
  JOIN akun_rekening a ON a.id = jd.akun_id
  LEFT JOIN departemen d ON d.id = j.departemen_id
  WHERE j.status = 'posted'
    AND j.tanggal BETWEEN p_tgl_awal AND p_tgl_akhir
    AND (p_include_penutup OR COALESCE(j.tipe, '') <> 'penutup')
    AND (p_departemen_ids IS NULL OR j.departemen_id = ANY(p_departemen_ids))
    AND (NOT p_exclude_koreksi OR (
      (j.tipe <> 'pembalik' OR j.tipe IS NULL)
      AND NOT EXISTS (SELECT 1 FROM jurnal jp WHERE jp.jurnal_asal_id = j.id)
    ))
  -- jd.id sebagai pembeda terakhir agar urutan stabil saat dipaginasi (.range) di klien.
  ORDER BY a.kode, jd.akun_id, j.tanggal, j.nomor, jd.urutan, jd.id;
END;
$function$;

-- Hardening sama dengan fungsi buku besar lain (lihat 20261005044657): tidak bisa
-- dipanggil anon/PUBLIC; role authenticated dibatasi lagi oleh pengecekan peran di atas.
REVOKE ALL ON FUNCTION public.buku_besar_saldo_awal_semua(date, uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buku_besar_saldo_awal_semua(date, uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.buku_besar_saldo_awal_semua(date, uuid[], boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.buku_besar_mutasi_semua(date, date, uuid[], boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buku_besar_mutasi_semua(date, date, uuid[], boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.buku_besar_mutasi_semua(date, date, uuid[], boolean, boolean) TO authenticated, service_role;
