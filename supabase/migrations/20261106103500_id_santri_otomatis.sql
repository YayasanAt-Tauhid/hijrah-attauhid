-- ID Santri dibuat otomatis oleh aplikasi (tidak lagi bergantung pada SiPaksa).
--
-- Format: YY.KK.NNN (mis. 27.01.001)
--   YY  = 2 digit tahun masuk (sama dengan sumber tahun NIS)
--   KK  = kode lembaga (TK=01, SD=02, SMP=03, SMA=04, MTA/MTQ=05),
--         memakai public.nis_kode_lembaga agar identik dengan NIS
--   NNN = urutan per tahun+lembaga, dilanjutkan dari nomor tertinggi yang sudah
--         ada di kolom id_santri_pihak3 (termasuk ID lama dari SiPaksa), sehingga
--         tidak bentrok dengan data yang sudah ada.
--
-- ID dibuat SEKALI, tepat saat NIS siswa pertama kali terisi. Dengan begitu
-- aturan yang berlaku tetap sama: calon SPMB mendapat NIS (dan ID) saat Lulus,
-- siswa dari form admin saat disimpan. Kode aplikasi tidak perlu berubah.
-- ID yang sudah ada tidak pernah ditimpa.
--
-- Nama kolom `id_santri_pihak3` dipertahankan sementara (historis) agar aman;
-- mengganti nama kolom adalah langkah terpisah.
--
-- Migrasi ini hanya menambah fungsi dan trigger. Tidak ada data yang diubah.
-- Pengisian ID untuk siswa lama adalah langkah data terpisah dan butuh
-- konfirmasi pemilik data. BELUM diterapkan ke produksi.

CREATE OR REPLACE FUNCTION public.id_santri_generate(
  p_siswa_id uuid,
  p_departemen_id uuid,
  p_angkatan_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_tahun integer;
  v_year2 text;
  v_kode text;
  v_prefix text;
  v_next integer;
BEGIN
  -- Tanpa lembaga, ID tidak dapat ditentukan. Jangan menghalangi penyimpanan siswa.
  IF p_departemen_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotent: ID yang sudah ada dikembalikan apa adanya.
  IF p_siswa_id IS NOT NULL THEN
    SELECT NULLIF(btrim(s.id_santri_pihak3), '')
    INTO v_existing
    FROM public.siswa s
    WHERE s.id = p_siswa_id;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Tahun masuk: riwayat lembaga (dibuat generator NIS) lebih dulu, lalu nama angkatan.
  IF p_siswa_id IS NOT NULL THEN
    SELECT h.tahun_masuk
    INTO v_tahun
    FROM public.siswa_tahun_masuk_departemen h
    WHERE h.siswa_id = p_siswa_id
      AND h.departemen_id = p_departemen_id;
  END IF;

  IF v_tahun IS NULL AND p_angkatan_id IS NOT NULL THEN
    SELECT ((regexp_match(a.nama, '([0-9]{4})'))[1])::integer
    INTO v_tahun
    FROM public.angkatan a
    WHERE a.id = p_angkatan_id
      AND a.departemen_id = p_departemen_id;
  END IF;

  IF v_tahun IS NULL OR v_tahun < 1900 OR v_tahun > 2200 THEN
    RETURN NULL;
  END IF;

  -- Lembaga yang belum didukung (mis. unit usaha) tidak mendapat ID dan
  -- tidak boleh menggagalkan penyimpanan siswa.
  BEGIN
    v_kode := public.nis_kode_lembaga(p_departemen_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  v_year2 := right(v_tahun::text, 2);
  v_prefix := v_year2 || '.' || v_kode || '.';

  -- Kunci per tahun+lembaga sampai transaksi selesai agar dua pendaftaran
  -- bersamaan tidak mendapat nomor yang sama.
  PERFORM pg_advisory_xact_lock(hashtext('id_santri:' || v_prefix));

  SELECT COALESCE(MAX(right(s.id_santri_pihak3, 3)::integer), 0) + 1
  INTO v_next
  FROM public.siswa s
  WHERE s.id_santri_pihak3 ~ ('^' || v_year2 || '\.' || v_kode || '\.[0-9]{3}$');

  IF v_next > 999 THEN
    RAISE EXCEPTION 'Nomor urut ID Santri % sudah penuh (maksimal 999)', v_prefix;
  END IF;

  RETURN v_year2 || '.' || v_kode || '.' || lpad(v_next::text, 3, '0');
END
$$;

REVOKE ALL ON FUNCTION public.id_santri_generate(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.id_santri_generate(uuid,uuid,uuid) TO service_role;

-- Trigger BEFORE: mengisi kolom pada baris yang sedang ditulis, tanpa UPDATE
-- tambahan (menghindari pemicu audit/integrasi berjalan dua kali).
CREATE OR REPLACE FUNCTION public.siswa_assign_id_santri()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.id_santri_pihak3 := public.id_santri_generate(NEW.id, NEW.departemen_id, NEW.angkatan_id);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.siswa_assign_id_santri() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_siswa_assign_id_santri ON public.siswa;
CREATE TRIGGER trg_siswa_assign_id_santri
  BEFORE INSERT OR UPDATE OF nis ON public.siswa
  FOR EACH ROW
  WHEN (
    NEW.nis IS NOT NULL
    AND btrim(NEW.nis) <> ''
    AND NEW.id_santri_pihak3 IS NULL
  )
  EXECUTE FUNCTION public.siswa_assign_id_santri();

COMMENT ON COLUMN public.siswa.id_santri_pihak3 IS
  'ID Santri (YY.KK.NNN). Dibuat otomatis oleh aplikasi saat NIS pertama terisi; data lama berasal dari SiPaksa. Nama kolom historis.';
