-- Dynamic SPMB waves. Each registration stores the wave it belongs to so
-- historical entitlement does not change when future schedules are edited.

CREATE TABLE IF NOT EXISTS public.spmb_gelombang (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama text NOT NULL,
  tanggal_mulai timestamptz NOT NULL,
  tanggal_selesai timestamptz NULL,
  gratis_pendaftaran boolean NOT NULL DEFAULT false,
  aktif boolean NOT NULL DEFAULT true,
  urutan integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spmb_gelombang_nama_nonempty CHECK (length(trim(nama)) > 0),
  CONSTRAINT spmb_gelombang_date_order CHECK (tanggal_selesai IS NULL OR tanggal_selesai > tanggal_mulai)
);

CREATE UNIQUE INDEX IF NOT EXISTS spmb_gelombang_nama_unique
  ON public.spmb_gelombang (lower(trim(nama)));

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_gelombang_id uuid REFERENCES public.spmb_gelombang(id);

ALTER TABLE public.spmb_gelombang ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spmb_gelombang_read_staff ON public.spmb_gelombang;
CREATE POLICY spmb_gelombang_read_staff ON public.spmb_gelombang
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'admin_tu')
);

DROP POLICY IF EXISTS spmb_gelombang_admin_write ON public.spmb_gelombang;
CREATE POLICY spmb_gelombang_admin_write ON public.spmb_gelombang
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.spmb_validate_wave_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.aktif AND EXISTS (
    SELECT 1
    FROM public.spmb_gelombang g
    WHERE g.id <> NEW.id
      AND g.aktif
      AND NEW.tanggal_mulai < COALESCE(g.tanggal_selesai, 'infinity'::timestamptz)
      AND g.tanggal_mulai < COALESCE(NEW.tanggal_selesai, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'Periode gelombang SPMB aktif tidak boleh saling tumpang tindih';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_spmb_validate_wave_schedule ON public.spmb_gelombang;
CREATE TRIGGER trg_spmb_validate_wave_schedule
BEFORE INSERT OR UPDATE ON public.spmb_gelombang
FOR EACH ROW EXECUTE FUNCTION public.spmb_validate_wave_schedule();

INSERT INTO public.spmb_gelombang
  (nama, tanggal_mulai, tanggal_selesai, gratis_pendaftaran, aktif, urutan)
VALUES
  ('Gelombang 1', timestamptz '2026-09-22 17:00:00+00', timestamptz '2026-10-30 17:00:00+00', true, true, 1)
ON CONFLICT ((lower(trim(nama)))) DO UPDATE
SET tanggal_mulai = EXCLUDED.tanggal_mulai,
    tanggal_selesai = EXCLUDED.tanggal_selesai,
    gratis_pendaftaran = EXCLUDED.gratis_pendaftaran,
    aktif = EXCLUDED.aktif,
    urutan = EXCLUDED.urutan;

INSERT INTO public.spmb_gelombang
  (nama, tanggal_mulai, tanggal_selesai, gratis_pendaftaran, aktif, urutan)
VALUES
  ('Gelombang 2', timestamptz '2026-10-30 17:00:00+00', NULL, false, true, 2)
ON CONFLICT ((lower(trim(nama)))) DO UPDATE
SET tanggal_mulai = EXCLUDED.tanggal_mulai,
    tanggal_selesai = EXCLUDED.tanggal_selesai,
    gratis_pendaftaran = EXCLUDED.gratis_pendaftaran,
    aktif = EXCLUDED.aktif,
    urutan = EXCLUDED.urutan;

CREATE OR REPLACE FUNCTION public.spmb_wave_at(p_at timestamptz, p_only_active boolean DEFAULT false)
RETURNS TABLE(
  id uuid,
  nama text,
  tanggal_mulai timestamptz,
  tanggal_selesai timestamptz,
  gratis_pendaftaran boolean,
  aktif boolean,
  urutan integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.nama, g.tanggal_mulai, g.tanggal_selesai,
         g.gratis_pendaftaran, g.aktif, g.urutan
  FROM public.spmb_gelombang g
  WHERE (NOT p_only_active OR g.aktif)
    AND p_at >= g.tanggal_mulai
    AND (g.tanggal_selesai IS NULL OR p_at < g.tanggal_selesai)
  ORDER BY g.urutan, g.tanggal_mulai
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.spmb_wave_at(timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_wave_at(timestamptz,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.spmb_is_first_wave_free(p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT w.gratis_pendaftaran
    FROM public.spmb_wave_at(p_created_at, false) w
    LIMIT 1
  ), false)
$$;

REVOKE ALL ON FUNCTION public.spmb_is_first_wave_free(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_is_first_wave_free(timestamptz) TO authenticated, service_role;

-- Backfill existing target SPMB records from their registration timestamp.
UPDATE public.siswa_detail d
SET spmb_gelombang_id = w.id
FROM public.siswa s
CROSS JOIN LATERAL public.spmb_wave_at(s.created_at, false) w
WHERE d.siswa_id = s.id
  AND d.spmb_gelombang_id IS NULL
  AND w.id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_registration_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  dep public.departemen;
  current_wave public.spmb_gelombang;
  target_year uuid;
  target_cohort uuid;
  normalized_nik text;
  normalized_nisn text;
  normalized_nik_ayah text;
  normalized_nik_ibu text;
  current_at timestamptz := clock_timestamp();
BEGIN
  IF NEW.pmb_payment_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT g.* INTO current_wave
  FROM public.spmb_gelombang g
  WHERE g.aktif
    AND current_at >= g.tanggal_mulai
    AND (g.tanggal_selesai IS NULL OR current_at < g.tanggal_selesai)
  ORDER BY g.urutan, g.tanggal_mulai
  LIMIT 1;

  IF current_wave.id IS NULL THEN
    RAISE EXCEPTION 'Pendaftaran SPMB sedang ditutup. Silakan lihat jadwal gelombang berikutnya';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = NEW.siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data calon murid tidak ditemukan'; END IF;
  SELECT * INTO dep FROM public.departemen WHERE id = s.departemen_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lembaga calon murid tidak ditemukan'; END IF;

  SELECT id INTO target_year
  FROM public.tahun_ajaran
  WHERE nama = 'Tahun Ajaran 2027-2028'
  ORDER BY tanggal_mulai DESC NULLS LAST, id
  LIMIT 1;
  IF target_year IS NULL THEN RAISE EXCEPTION 'Konfigurasi Tahun Ajaran 2027-2028 belum tersedia'; END IF;

  SELECT id INTO target_cohort
  FROM public.angkatan
  WHERE departemen_id = s.departemen_id
    AND nama = 'Angkatan 2027'
    AND aktif = true
  ORDER BY id
  LIMIT 1;
  IF target_cohort IS NULL THEN RAISE EXCEPTION 'Konfigurasi Angkatan 2027 untuk lembaga yang dipilih belum tersedia'; END IF;

  IF NEW.tahun_ajaran_id IS DISTINCT FROM target_year THEN
    RAISE EXCEPTION 'Pendaftaran SPMB saat ini hanya untuk Tahun Ajaran 2027-2028';
  END IF;
  IF s.angkatan_id IS DISTINCT FROM target_cohort THEN
    RAISE EXCEPTION 'Angkatan calon murid harus Angkatan 2027 sesuai lembaga';
  END IF;

  IF COALESCE(NEW.kategori, '') NOT IN ('MURID BARU','MURID PINDAHAN') THEN
    RAISE EXCEPTION 'Kategori harus Murid Baru atau Siswa Pindahan';
  END IF;
  IF NEW.kategori = 'MURID PINDAHAN' THEN
    NEW.jenis_pendaftaran := 'pindahan';
  ELSE
    NEW.kategori := 'MURID BARU';
    NEW.jenis_pendaftaran := 'baru';
  END IF;

  normalized_nik := regexp_replace(COALESCE(NEW.nik, ''), '[^0-9]', '', 'g');
  IF length(normalized_nik) <> 16 THEN RAISE EXCEPTION 'NIK Calon Murid harus terdiri dari 16 digit'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.siswa_detail d
    WHERE d.siswa_id <> NEW.siswa_id
      AND length(regexp_replace(COALESCE(d.nik, ''), '[^0-9]', '', 'g')) = 16
      AND regexp_replace(d.nik, '[^0-9]', '', 'g') = normalized_nik
  ) THEN
    RAISE EXCEPTION 'NIK Calon Murid sudah terdaftar pada data siswa lain';
  END IF;
  NEW.nik := normalized_nik;

  IF NULLIF(trim(COALESCE(s.alamat,'')), '') IS NULL THEN RAISE EXCEPTION 'Alamat rumah wajib diisi'; END IF;
  IF NULLIF(trim(COALESCE(s.telepon,'')), '') IS NULL THEN RAISE EXCEPTION 'No. HP/WhatsApp yang bisa dihubungi wajib diisi'; END IF;

  IF upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)' THEN
    normalized_nisn := regexp_replace(COALESCE(s.nisn,''), '[^0-9]', '', 'g');
    IF length(normalized_nisn) <> 10 THEN RAISE EXCEPTION 'NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA'; END IF;
    UPDATE public.siswa SET nisn = normalized_nisn WHERE id = s.id;
  END IF;

  normalized_nik_ayah := regexp_replace(COALESCE(NEW.nik_ayah,''), '[^0-9]', '', 'g');
  normalized_nik_ibu := regexp_replace(COALESCE(NEW.nik_ibu,''), '[^0-9]', '', 'g');

  IF NULLIF(trim(COALESCE(NEW.nama_ayah,'')), '') IS NULL
     OR length(normalized_nik_ayah) <> 16
     OR NULLIF(trim(COALESCE(NEW.tempat_lahir_ayah,'')), '') IS NULL
     OR NEW.tanggal_lahir_ayah IS NULL
     OR NULLIF(trim(COALESCE(NEW.pendidikan_ayah,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.pekerjaan_ayah,'')), '') IS NULL
     OR NEW.penghasilan_ayah IS NULL
     OR NULLIF(trim(COALESCE(NEW.telepon_ayah,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.alamat_ayah,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Data Ayah wajib diisi lengkap';
  END IF;

  IF NULLIF(trim(COALESCE(NEW.nama_ibu,'')), '') IS NULL
     OR length(normalized_nik_ibu) <> 16
     OR NULLIF(trim(COALESCE(NEW.tempat_lahir_ibu,'')), '') IS NULL
     OR NEW.tanggal_lahir_ibu IS NULL
     OR NULLIF(trim(COALESCE(NEW.pendidikan_ibu,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.pekerjaan_ibu,'')), '') IS NULL
     OR NEW.penghasilan_ibu IS NULL
     OR NULLIF(trim(COALESCE(NEW.telepon_ibu,'')), '') IS NULL
     OR NULLIF(trim(COALESCE(NEW.alamat_ibu,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Data Ibu wajib diisi lengkap';
  END IF;

  NEW.nik_ayah := normalized_nik_ayah;
  NEW.nik_ibu := normalized_nik_ibu;

  IF NEW.kategori = 'MURID PINDAHAN' THEN
    IF NULLIF(trim(COALESCE(NEW.dokumen_rapor_path,'')), '') IS NULL
       OR NULLIF(trim(COALESCE(NEW.dokumen_ijazah_path,'')), '') IS NULL THEN
      RAISE EXCEPTION 'Rapor dan Ijazah/SKHUN wajib untuk Siswa Pindahan';
    END IF;
  ELSE
    NEW.dokumen_rapor_path := NULL;
    NEW.dokumen_ijazah_path := NULL;
  END IF;

  IF upper(trim(COALESCE(dep.kode,''))) = 'MTA'
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)MTA(\s|$)' THEN
    IF COALESCE(NEW.jenis_pendaftaran,'baru') <> 'alumni_internal' THEN NEW.status_asrama := 'asrama'; END IF;
  ELSIF upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA')
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA)(\s|$)' THEN
    IF COALESCE(NEW.status_asrama,'') NOT IN ('asrama','non_asrama') THEN
      RAISE EXCEPTION 'Pilihan Asrama / Non Asrama wajib dipilih';
    END IF;
  ELSE
    NEW.status_asrama := NULL;
  END IF;

  NEW.tinggi_badan_cm := NULL;
  NEW.berat_badan_kg := NULL;
  NEW.lingkar_kepala_cm := NULL;
  NEW.ukuran_baju := NULL;
  NEW.spmb_gelombang_id := current_wave.id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_payment_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  wave_id uuid;
  wave_free boolean;
BEGIN
  IF COALESCE(NEW.metadata->>'source', '') <> 'pmb_public' THEN RETURN NEW; END IF;

  BEGIN
    sid := NULLIF(NEW.metadata->>'siswa_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak valid';
  END;
  IF sid IS NULL THEN RAISE EXCEPTION 'Metadata siswa SPMB tidak lengkap'; END IF;

  SELECT d.spmb_gelombang_id, g.gratis_pendaftaran
  INTO wave_id, wave_free
  FROM public.siswa_detail d
  LEFT JOIN public.spmb_gelombang g ON g.id = d.spmb_gelombang_id
  WHERE d.siswa_id = sid;

  IF wave_id IS NULL THEN
    RAISE EXCEPTION 'Gelombang pendaftaran SPMB tidak ditemukan';
  END IF;
  IF COALESCE(wave_free,false) THEN
    RAISE EXCEPTION 'Pendaftar pada gelombang ini berhak gratis biaya pendaftaran; transaksi tidak dibuat';
  END IF;

  RETURN NEW;
END
$$;

-- The legacy name is retained for compatibility with existing finance/reporting code,
-- but the decision now comes from the registration's configured wave.
DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.spmb_apply_first_wave_promo(uuid)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF NOT public.spmb_is_first_wave_free(s.created_at) THEN',
    'IF NOT COALESCE((SELECT g.gratis_pendaftaran FROM public.siswa_detail sd JOIN public.spmb_gelombang g ON g.id=sd.spmb_gelombang_id WHERE sd.siswa_id=s.id LIMIT 1), public.spmb_is_first_wave_free(s.created_at)) THEN'
  );
  EXECUTE f;
END
$patch$;
