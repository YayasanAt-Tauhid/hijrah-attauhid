-- ID Santri pihak ketiga (SiPaksa) pada tabel siswa.
--
-- Tujuan: menyimpan `santriId` dari API pihak ketiga sebagai penghubung
-- sementara. Aturan mandiri: siswa yang sudah ber-NIS resmi aplikasi
-- (format YY-KK-NNN, lihat akademik_generate_nis_current) tidak pernah ditimpa
-- ID pihak ketiga, dan kolom ini bisa dihapus setelah semua siswa memakai NIS
-- mandiri.
--
-- BELUM diterapkan ke produksi. Terapkan lewat MCP apply_migration dengan
-- konfirmasi pemilik data; jangan `supabase db push` buta (lihat CLAUDE.md).

ALTER TABLE public.siswa
  ADD COLUMN IF NOT EXISTS id_santri_pihak3 text;

COMMENT ON COLUMN public.siswa.id_santri_pihak3 IS
  'ID Santri dari API pihak ketiga (SiPaksa). Sementara; tidak dipakai bila siswa sudah ber-NIS mandiri YY-KK-NNN.';

-- Satu ID pihak ketiga hanya boleh menunjuk satu siswa.
CREATE UNIQUE INDEX IF NOT EXISTS siswa_id_santri_pihak3_uidx
  ON public.siswa (id_santri_pihak3)
  WHERE id_santri_pihak3 IS NOT NULL;

-- Tulis massal secara atomik (satu transaksi; pelanggaran unik membatalkan semuanya).
-- Pengaman berlapis di sisi DB, selain pencocokan di aplikasi:
--   * hanya mengisi kolom yang masih NULL (tidak menimpa),
--   * melewati siswa yang sudah ber-NIS mandiri YY-KK-NNN.
-- p_updates: [{ "siswa_id": uuid, "id_santri_pihak3": text }, ...]
CREATE OR REPLACE FUNCTION public.sync_id_santri_pihak3(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested integer;
  v_updated integer;
BEGIN
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates harus berupa array JSON';
  END IF;

  v_requested := jsonb_array_length(p_updates);

  WITH input AS (
    SELECT
      (e ->> 'siswa_id')::uuid AS siswa_id,
      NULLIF(btrim(e ->> 'id_santri_pihak3'), '') AS id_pihak3
    FROM jsonb_array_elements(p_updates) AS e
  ),
  upd AS (
    UPDATE public.siswa s
       SET id_santri_pihak3 = i.id_pihak3
      FROM input i
     WHERE s.id = i.siswa_id
       AND i.id_pihak3 IS NOT NULL
       AND s.id_santri_pihak3 IS NULL
       AND (s.nis IS NULL OR s.nis !~ '^\d{2}-\d{2}-\d{3}$')
    RETURNING s.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'updated', v_updated,
    'skipped', v_requested - v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_id_santri_pihak3(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_id_santri_pihak3(jsonb) TO service_role;
