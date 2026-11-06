-- Perbaikan 20261028052500_siswa_id_santri_pihak3.sql: pola NIS mandiri.
--
-- Trigger `normalisasi_nis_siswa_tanpa_hubung` membuang tanda hubung dari
-- siswa.nis, sehingga NIS mandiri buatan aplikasi (YY + KK + NNN, lihat
-- nis_get_or_create_for_department) tersimpan 7 digit polos, mis. 2601001.
-- Guard versi pertama hanya mengenali bentuk berhubung (YY-KK-NNN) dan karena
-- itu tidak pernah menangkap NIS mandiri di data nyata. Fungsi ini mengenali
-- keduanya. Hanya mengganti isi fungsi; tidak ada data yang diubah.

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
       AND (s.nis IS NULL OR btrim(s.nis) !~ '^(\d{2}-\d{2}-\d{3}|\d{7})$')
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

COMMENT ON COLUMN public.siswa.id_santri_pihak3 IS
  'ID Santri dari API pihak ketiga (SiPaksa). Sementara; tidak dipakai bila siswa sudah ber-NIS mandiri (7 digit polos YYKKNNN).';
