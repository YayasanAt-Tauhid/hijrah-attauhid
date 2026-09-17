-- Selaraskan pembayaran pendaftaran SPMB lama yang sempat tersimpan memakai
-- tahun ajaran aktif global, bukan tahun ajaran pendaftaran calon murid.
-- Pembatasan jenis pembayaran mengikuti konfigurasi SPMB lembaga agar
-- pembayaran non-SPMB tidak ikut berubah.
CREATE OR REPLACE FUNCTION public.align_spmb_payment_academic_year_once()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE pembayaran AS p
  SET tahun_ajaran_id = sd.tahun_ajaran_id
  FROM siswa AS s
  JOIN siswa_detail AS sd
    ON sd.siswa_id = s.id
  JOIN konfigurasi_pmb AS kp
    ON kp.departemen_id = s.departemen_id
  WHERE p.siswa_id = s.id
    AND s.status = 'calon'
    AND p.jenis_id = kp.jenis_pembayaran_id
    AND p.jurnal_id IS NOT NULL
    AND sd.tahun_ajaran_id IS NOT NULL
    AND p.tahun_ajaran_id IS DISTINCT FROM sd.tahun_ajaran_id;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END
$$;

REVOKE ALL ON FUNCTION public.align_spmb_payment_academic_year_once() FROM PUBLIC, anon, authenticated;
SELECT public.align_spmb_payment_academic_year_once();
DROP FUNCTION public.align_spmb_payment_academic_year_once();
