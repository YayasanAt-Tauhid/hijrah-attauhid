CREATE OR REPLACE FUNCTION public.integration_registration_payment_status(
  p_siswa_id uuid,
  p_departemen_id uuid,
  p_created_at timestamptz
)
RETURNS TABLE(
  status text,
  tanggal_bayar date,
  jumlah numeric,
  jenis_pembayaran_id uuid,
  gratis_gelombang_pertama boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT k.jenis_pembayaran_id
    FROM public.konfigurasi_pmb k
    WHERE k.departemen_id = p_departemen_id
    LIMIT 1
  ), reg AS (
    SELECT COALESCE(
      (
        SELECT g.gratis_pendaftaran
        FROM public.siswa_detail d
        JOIN public.spmb_gelombang g ON g.id = d.spmb_gelombang_id
        WHERE d.siswa_id = p_siswa_id
        LIMIT 1
      ),
      public.spmb_is_first_wave_free(p_created_at)
    ) AS gratis
  ), pay AS (
    SELECT p.tanggal_bayar, p.jumlah, p.jenis_id
    FROM public.pembayaran p, cfg
    WHERE p.siswa_id = p_siswa_id
      AND p.jenis_id = cfg.jenis_pembayaran_id
    ORDER BY p.tanggal_bayar DESC NULLS LAST
    LIMIT 1
  ), bill AS (
    SELECT t.status, t.pembayaran_id, t.jenis_id
    FROM public.tagihan t, cfg
    WHERE t.siswa_id = p_siswa_id
      AND t.jenis_id = cfg.jenis_pembayaran_id
    ORDER BY t.created_at DESC
    LIMIT 1
  )
  SELECT
    CASE
      WHEN reg.gratis THEN 'gratis_gelombang_pertama'
      WHEN pay.tanggal_bayar IS NOT NULL THEN 'dibayar'
      WHEN bill.status IS NOT NULL THEN COALESCE(bill.status, 'belum_dibayar')
      ELSE 'belum_tercatat'
    END,
    pay.tanggal_bayar,
    pay.jumlah,
    cfg.jenis_pembayaran_id,
    reg.gratis
  FROM cfg
  CROSS JOIN reg
  LEFT JOIN pay ON true
  LEFT JOIN bill ON true
$$;
