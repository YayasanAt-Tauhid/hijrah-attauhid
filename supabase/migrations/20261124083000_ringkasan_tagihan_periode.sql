-- Proyeksi Tagihan SPP: ringkasan tagihan SPP per lembaga x bulan.
-- Dasar halaman /keuangan/proyeksi-tagihan (perkiraan SPP bulan/tahun mendatang per lembaga
-- atau semua lembaga). Tagihan SPP sudah dijadwalkan jauh ke depan (status 'terjadwal'),
-- jadi angkanya cukup dijumlahkan dari tabel tagihan; tidak ada rumus proyeksi tambahan.
--
-- Aturan hitung:
--   * SPP = jenis_pembayaran bertipe 'bulanan' dengan nama berawalan 'SPP ' (jenis bulanan
--     lain seperti DAYCARE dan SUBSIDI SILANG, serta saldo lama, tidak ikut).
--   * Bulan/tahun diambil dari jatuh_tempo (sama dengan tagihan.bulan untuk SPP).
--   * Tagihan berstatus 'dibatalkan' tidak dihitung.
--   * bruto = nominal_bruto (jatuh ke nominal bila kosong); potongan = nominal_diskon;
--     neto = nominal; terbayar = jumlah pembayaran yang terhubung lewat pembayaran.tagihan_id;
--     sisa = neto - terbayar.
-- Hanya membaca: tidak mengubah tabel maupun data. Akses: admin/kepala/keuangan (dicek di
-- dalam fungsi, sama dengan buku besar) dan hanya untuk role authenticated + service_role.

CREATE OR REPLACE FUNCTION public.ringkasan_tagihan_periode(
  p_tgl_awal date,
  p_tgl_akhir date,
  p_departemen_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  departemen_id uuid, departemen_kode text, tahun integer, bulan integer,
  jumlah_siswa integer, jumlah_tagihan integer,
  bruto numeric, potongan numeric, neto numeric, terbayar numeric, sisa numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan')) THEN
    RAISE EXCEPTION 'Tidak diizinkan mengakses proyeksi tagihan';
  END IF;

  RETURN QUERY
  WITH tg AS (
    SELECT j.departemen_id AS dep_id,
           t.id AS tagihan_id,
           t.siswa_id AS siswa_id,
           t.jatuh_tempo AS jatuh_tempo,
           COALESCE(t.nominal_bruto, t.nominal) AS bruto_t,
           COALESCE(t.nominal_diskon, 0) AS diskon_t,
           t.nominal AS neto_t
    FROM tagihan t
    JOIN jenis_pembayaran j ON j.id = t.jenis_id
    WHERE j.tipe = 'bulanan'
      AND j.nama ILIKE 'SPP %'
      AND t.status <> 'dibatalkan'
      AND t.jatuh_tempo BETWEEN p_tgl_awal AND p_tgl_akhir
      AND (p_departemen_id IS NULL OR j.departemen_id = p_departemen_id)
  ),
  byr AS (
    SELECT p.tagihan_id AS tagihan_id, SUM(p.jumlah) AS jumlah
    FROM pembayaran p
    WHERE p.tagihan_id IN (SELECT tg.tagihan_id FROM tg)
    GROUP BY p.tagihan_id
  )
  SELECT d.id,
         d.kode,
         EXTRACT(YEAR FROM tg.jatuh_tempo)::integer,
         EXTRACT(MONTH FROM tg.jatuh_tempo)::integer,
         COUNT(DISTINCT tg.siswa_id)::integer,
         COUNT(*)::integer,
         SUM(tg.bruto_t),
         SUM(tg.diskon_t),
         SUM(tg.neto_t),
         COALESCE(SUM(byr.jumlah), 0),
         SUM(tg.neto_t) - COALESCE(SUM(byr.jumlah), 0)
  FROM tg
  JOIN departemen d ON d.id = tg.dep_id
  LEFT JOIN byr ON byr.tagihan_id = tg.tagihan_id
  GROUP BY d.id, d.kode, 3, 4
  ORDER BY d.kode, 3, 4;
END;
$function$;

-- Hardening sama dengan fungsi buku besar (20261117120000): tidak bisa dipanggil
-- anon/PUBLIC; role authenticated dibatasi lagi oleh pengecekan peran di atas.
REVOKE ALL ON FUNCTION public.ringkasan_tagihan_periode(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ringkasan_tagihan_periode(date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ringkasan_tagihan_periode(date, date, uuid) TO authenticated, service_role;
