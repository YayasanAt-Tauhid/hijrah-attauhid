-- Hilangkan tanda "-" hanya pada NIS; jangan mengubah NISN, NIK, UUID, atau nominal.
-- NIS legacy yang panjangnya bervariasi tetap dipertahankan sebagai teks.
-- Jejak audit identitas yang bersifat historis tidak ditulis ulang.
SET lock_timeout = '10s';
SET statement_timeout = '60s';

LOCK TABLE public.siswa, public.siswa_tahun_masuk_departemen,
  public.payment_receipt_items, public.siswa_mutasi_departemen_audit,
  public.spmb_tujuan_audit IN SHARE ROW EXCLUSIVE MODE;

-- Validasi unik sebelum pembaruan tabel berindeks unik.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.siswa
    WHERE nis IS NOT NULL
    GROUP BY replace(nis, '-', '')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'NIS siswa bertabrakan setelah menghapus tanda hubung';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.siswa_tahun_masuk_departemen
    WHERE nis IS NOT NULL
    GROUP BY replace(nis, '-', '')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'NIS riwayat bertabrakan setelah menghapus tanda hubung';
  END IF;
END $$;

-- Cadangan tingkat baris untuk pemulihan, tidak diekspos ke Data API.
CREATE SCHEMA IF NOT EXISTS maintenance;
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC, anon, authenticated;
CREATE TABLE maintenance.nis_backup_20261021 (
  source_table text NOT NULL,
  row_id uuid NOT NULL,
  column_name text NOT NULL,
  old_nis text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, row_id, column_name)
);
REVOKE ALL ON TABLE maintenance.nis_backup_20261021 FROM PUBLIC, anon, authenticated;
INSERT INTO maintenance.nis_backup_20261021 (source_table, row_id, column_name, old_nis)
SELECT 'siswa', id, 'nis', nis FROM public.siswa WHERE nis LIKE '%-%'
UNION ALL
SELECT 'siswa_tahun_masuk_departemen', id, 'nis', nis
  FROM public.siswa_tahun_masuk_departemen WHERE nis LIKE '%-%'
UNION ALL
SELECT 'payment_receipt_items', id, 'student_nis', student_nis
  FROM public.payment_receipt_items WHERE student_nis LIKE '%-%'
UNION ALL
SELECT 'siswa_mutasi_departemen_audit', id, 'nis_baru', nis_baru
  FROM public.siswa_mutasi_departemen_audit WHERE nis_baru LIKE '%-%'
UNION ALL
SELECT 'siswa_mutasi_departemen_audit', id, 'nis_lama', nis_lama
  FROM public.siswa_mutasi_departemen_audit WHERE nis_lama LIKE '%-%'
UNION ALL
SELECT 'spmb_tujuan_audit', id, 'nis_sebelum', nis_sebelum
  FROM public.spmb_tujuan_audit WHERE nis_sebelum LIKE '%-%';

UPDATE public.siswa SET nis = replace(nis, '-', '') WHERE nis LIKE '%-%';
UPDATE public.siswa_tahun_masuk_departemen SET nis = replace(nis, '-', '') WHERE nis LIKE '%-%';
UPDATE public.payment_receipt_items SET student_nis = replace(student_nis, '-', '')
WHERE student_nis LIKE '%-%';
UPDATE public.siswa_mutasi_departemen_audit
SET nis_baru = replace(nis_baru, '-', ''), nis_lama = replace(nis_lama, '-', '')
WHERE nis_baru LIKE '%-%' OR nis_lama LIKE '%-%';
UPDATE public.spmb_tujuan_audit SET nis_sebelum = replace(nis_sebelum, '-', '')
WHERE nis_sebelum LIKE '%-%';

-- Normalisasi di gerbang database, termasuk impor dan integrasi lama.
CREATE OR REPLACE FUNCTION public.normalisasi_nis_tanpa_hubung()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'payment_receipt_items' THEN
    NEW.student_nis := replace(NEW.student_nis, '-', '');
  ELSE
    NEW.nis := replace(NEW.nis, '-', '');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalisasi_nis_tanpa_hubung() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER normalisasi_nis_siswa_tanpa_hubung
BEFORE INSERT OR UPDATE OF nis ON public.siswa
FOR EACH ROW EXECUTE FUNCTION public.normalisasi_nis_tanpa_hubung();

CREATE TRIGGER normalisasi_nis_riwayat_tanpa_hubung
BEFORE INSERT OR UPDATE OF nis ON public.siswa_tahun_masuk_departemen
FOR EACH ROW EXECUTE FUNCTION public.normalisasi_nis_tanpa_hubung();

CREATE TRIGGER normalisasi_nis_kuitansi_tanpa_hubung
BEFORE INSERT OR UPDATE OF student_nis ON public.payment_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.normalisasi_nis_tanpa_hubung();

ALTER TABLE public.siswa
  ADD CONSTRAINT siswa_nis_tanpa_tanda_hubung CHECK (nis IS NULL OR position('-' IN nis) = 0);
ALTER TABLE public.siswa_tahun_masuk_departemen
  ADD CONSTRAINT riwayat_nis_tanpa_tanda_hubung CHECK (nis IS NULL OR position('-' IN nis) = 0);
ALTER TABLE public.payment_receipt_items
  ADD CONSTRAINT kuitansi_nis_tanpa_tanda_hubung CHECK (student_nis IS NULL OR position('-' IN student_nis) = 0);

-- Generator atomik YYKKNNN, dengan lock per angkatan/lembaga.
-- Mengecek tabel historis dan siswa untuk mencegah penggunaan ulang NIS.
CREATE OR REPLACE FUNCTION public.nis_get_or_create_for_department(
  p_siswa_id uuid,
  p_departemen_id uuid,
  p_angkatan_id uuid,
  p_sumber text DEFAULT 'otomatis',
  p_keterangan text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_tahun integer;
  v_year4 text;
  v_year2 text;
  v_kode text;
  v_prefix text;
  v_next integer;
  v_nis text;
BEGIN
  IF p_siswa_id IS NULL OR p_departemen_id IS NULL OR p_angkatan_id IS NULL THEN
    RAISE EXCEPTION 'Siswa, lembaga, dan angkatan wajib diisi untuk membuat NIS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siswa WHERE id = p_siswa_id) THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan';
  END IF;

  SELECT h.nis, h.tahun_masuk
  INTO v_existing, v_tahun
  FROM public.siswa_tahun_masuk_departemen h
  WHERE h.siswa_id = p_siswa_id AND h.departemen_id = p_departemen_id
  FOR UPDATE;

  IF NULLIF(BTRIM(v_existing), '') IS NOT NULL THEN
    RETURN replace(v_existing, '-', '');
  END IF;

  IF v_tahun IS NULL THEN
    SELECT (regexp_match(a.nama, '([0-9]{4})'))[1]
    INTO v_year4
    FROM public.angkatan a
    WHERE a.id = p_angkatan_id AND a.departemen_id = p_departemen_id
      AND COALESCE(a.aktif, true);
    IF v_year4 IS NULL THEN
      RAISE EXCEPTION 'Angkatan tidak sesuai lembaga atau nama angkatan tidak memuat tahun 4 digit';
    END IF;
    v_tahun := v_year4::integer;
  END IF;

  IF v_tahun < 1900 OR v_tahun > 2200 THEN
    RAISE EXCEPTION 'Tahun masuk tidak valid';
  END IF;

  v_year2 := right(v_tahun::text, 2);
  v_kode := public.nis_kode_lembaga(p_departemen_id);
  v_prefix := v_year2 || v_kode;
  PERFORM pg_advisory_xact_lock(hashtext('nis:' || v_prefix));

  SELECT h.nis INTO v_existing
  FROM public.siswa_tahun_masuk_departemen h
  WHERE h.siswa_id = p_siswa_id AND h.departemen_id = p_departemen_id;
  IF NULLIF(BTRIM(v_existing), '') IS NOT NULL THEN
    RETURN replace(v_existing, '-', '');
  END IF;

  SELECT COALESCE(MAX(right(t.nis, 3)::integer), 0) + 1
  INTO v_next
  FROM (
    SELECT nis FROM public.siswa_tahun_masuk_departemen
    UNION ALL
    SELECT nis FROM public.siswa
  ) t
  WHERE t.nis ~ ('^' || v_prefix || '[0-9]{3}$');

  IF v_next > 999 THEN
    RAISE EXCEPTION 'Nomor urut NIS % untuk tahun % sudah penuh (maksimal 999)', v_kode, v_tahun;
  END IF;
  v_nis := v_prefix || lpad(v_next::text, 3, '0');

  INSERT INTO public.siswa_tahun_masuk_departemen
    (siswa_id, departemen_id, tahun_masuk, sumber, keterangan, nis)
  VALUES (
    p_siswa_id, p_departemen_id, v_tahun,
    COALESCE(NULLIF(BTRIM(p_sumber), ''), 'otomatis'), p_keterangan, v_nis
  )
  ON CONFLICT (siswa_id, departemen_id)
  DO UPDATE SET
    nis = COALESCE(public.siswa_tahun_masuk_departemen.nis, EXCLUDED.nis),
    updated_at = now()
  RETURNING nis INTO v_nis;

  RETURN replace(v_nis, '-', '');
END $$;

-- Tidak mengubah grants RPC existing dan audit identitas historis.
COMMENT ON FUNCTION public.nis_get_or_create_for_department(uuid,uuid,uuid,text,text)
IS 'Menghasilkan NIS YYKKNNN tanpa tanda hubung, unik per tahun masuk dan lembaga.';
