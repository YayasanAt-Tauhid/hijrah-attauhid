-- Harga seragam dari vendor per tahun ajaran (halaman Biaya Seragam SPMB).
-- Satu baris = satu nama stel + satu kelompok ukuran (ukuran kosong = semua ukuran).
-- Tanpa data awal: harga dimasukkan lewat skrip bergerbang terpisah setelah pemetaan stel dikonfirmasi.
-- Rollback: DROP TABLE public.harga_seragam_vendor; DROP FUNCTION public.harga_seragam_vendor_sebelum_tulis();

CREATE TABLE public.harga_seragam_vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tahun_ajaran_id uuid NOT NULL REFERENCES public.tahun_ajaran(id),
  departemen_id uuid NOT NULL REFERENCES public.departemen(id),
  jenis_kelamin text NOT NULL CHECK (jenis_kelamin IN ('L', 'P', 'semua')),
  nama_stel text NOT NULL CHECK (btrim(nama_stel) <> '' AND char_length(nama_stel) <= 80),
  ukuran text[] NOT NULL DEFAULT '{}',
  harga bigint NOT NULL CHECK (harga >= 0),
  catatan text,
  aktif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE INDEX harga_seragam_vendor_tahun_lembaga_idx
  ON public.harga_seragam_vendor (tahun_ajaran_id, departemen_id);

CREATE OR REPLACE FUNCTION public.harga_seragam_vendor_sebelum_tulis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ukuran text[];
BEGIN
  NEW.nama_stel := regexp_replace(btrim(NEW.nama_stel), '\s+', ' ', 'g');

  SELECT COALESCE(array_agg(DISTINCT s.x ORDER BY s.x), '{}')
    INTO v_ukuran
    FROM (
      SELECT CASE upper(regexp_replace(btrim(u), '\s+', ' ', 'g'))
               WHEN 'X3L' THEN '3XL'
               WHEN 'X4L' THEN '4XL'
               WHEN 'X5L' THEN '5XL'
               ELSE upper(regexp_replace(btrim(u), '\s+', ' ', 'g'))
             END AS x
        FROM unnest(COALESCE(NEW.ukuran, '{}')) AS u
       WHERE btrim(u) <> ''
    ) s;
  NEW.ukuran := v_ukuran;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();

  IF NEW.aktif THEN
    -- Serialkan penulisan per tahun ajaran + lembaga agar dua sesi tidak lolos bersamaan.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tahun_ajaran_id::text || ':' || NEW.departemen_id::text, 0));
    IF EXISTS (
      SELECT 1
        FROM public.harga_seragam_vendor h
       WHERE h.id <> NEW.id
         AND h.aktif
         AND h.tahun_ajaran_id = NEW.tahun_ajaran_id
         AND h.departemen_id = NEW.departemen_id
         AND lower(h.nama_stel) = lower(NEW.nama_stel)
         AND (h.jenis_kelamin = 'semua' OR NEW.jenis_kelamin = 'semua' OR h.jenis_kelamin = NEW.jenis_kelamin)
         AND (cardinality(h.ukuran) = 0 OR cardinality(NEW.ukuran) = 0 OR h.ukuran && NEW.ukuran)
    ) THEN
      RAISE EXCEPTION 'Harga seragam bertabrakan dengan baris aktif lain (stel, jenis kelamin, dan ukuran beririsan)'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_harga_seragam_vendor_sebelum_tulis
  BEFORE INSERT OR UPDATE ON public.harga_seragam_vendor
  FOR EACH ROW EXECUTE FUNCTION public.harga_seragam_vendor_sebelum_tulis();

ALTER TABLE public.harga_seragam_vendor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.harga_seragam_vendor FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.harga_seragam_vendor TO authenticated;
GRANT ALL ON public.harga_seragam_vendor TO service_role;

DROP POLICY IF EXISTS "admin_keuangan_baca_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_baca_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS "admin_keuangan_tambah_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_tambah_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));

DROP POLICY IF EXISTS "admin_keuangan_ubah_harga_seragam_vendor" ON public.harga_seragam_vendor;
CREATE POLICY "admin_keuangan_ubah_harga_seragam_vendor" ON public.harga_seragam_vendor
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan'));
