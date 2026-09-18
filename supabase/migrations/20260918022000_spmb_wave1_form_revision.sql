-- Revisi SPMB Gelombang 1 2027/2028:
-- 23 Sep 2026 00:00 WIB s.d. 30 Okt 2026 23:59:59 WIB.
-- Tambah NISN, link grup calon siswa, keputusan kelulusan, kategori pindahan,
-- MTA wajib asrama (kecuali murid lama/alumni_internal), dan validasi data wajib.

ALTER TABLE public.siswa
  ADD COLUMN IF NOT EXISTS nisn text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_nisn_format_check'
      AND conrelid = 'public.siswa'::regclass
  ) THEN
    ALTER TABLE public.siswa
      ADD CONSTRAINT siswa_nisn_format_check
      CHECK (nisn IS NULL OR nisn = '' OR nisn ~ '^[0-9]{10}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS siswa_nisn_unique_nonempty
  ON public.siswa(nisn)
  WHERE nisn IS NOT NULL AND nisn <> '';

ALTER TABLE public.konfigurasi_pmb
  ADD COLUMN IF NOT EXISTS group_calon_siswa_url text;

ALTER TABLE public.siswa_detail
  ADD COLUMN IF NOT EXISTS spmb_status_kelulusan text,
  ADD COLUMN IF NOT EXISTS spmb_tanggal_keputusan timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'siswa_detail_spmb_status_kelulusan_check'
      AND conrelid = 'public.siswa_detail'::regclass
  ) THEN
    ALTER TABLE public.siswa_detail
      ADD CONSTRAINT siswa_detail_spmb_status_kelulusan_check
      CHECK (spmb_status_kelulusan IS NULL OR spmb_status_kelulusan IN ('lulus','tidak_lulus'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.spmb_is_first_wave_free(p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_created_at >= timestamptz '2026-09-22 17:00:00+00'
     AND p_created_at <  timestamptz '2026-10-30 17:00:00+00'
$$;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_payment_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sid uuid;
  registered_at timestamptz;
  current_at timestamptz;
BEGIN
  IF COALESCE(NEW.metadata->>'source', '') <> 'pmb_public' THEN
    RETURN NEW;
  END IF;

  BEGIN
    sid := NULLIF(NEW.metadata->>'siswa_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak valid';
  END;

  IF sid IS NULL THEN
    RAISE EXCEPTION 'Metadata siswa SPMB tidak lengkap';
  END IF;

  SELECT created_at INTO registered_at
  FROM public.siswa
  WHERE id = sid;

  IF registered_at IS NULL THEN
    RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan';
  END IF;

  IF public.spmb_is_first_wave_free(registered_at) THEN
    RAISE EXCEPTION 'Pendaftar Gelombang Pertama berhak gratis biaya pendaftaran; transaksi tidak dibuat';
  END IF;

  current_at := clock_timestamp();
  IF current_at >= timestamptz '2026-09-22 17:00:00+00'
     AND current_at < timestamptz '2026-10-30 17:00:00+00' THEN
    RAISE EXCEPTION 'Pembayaran biaya pendaftaran ditutup selama promo Gelombang Pertama dan tersedia kembali mulai 31 Oktober 2026 (Asia/Jakarta)';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_spmb_public_registration_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  dep public.departemen;
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

  IF current_at < timestamptz '2026-09-22 17:00:00+00'
     OR current_at >= timestamptz '2026-10-30 17:00:00+00' THEN
    RAISE EXCEPTION 'SPMB Gelombang 1 dibuka 23 September sampai 30 Oktober 2026 (Asia/Jakarta)';
  END IF;

  SELECT * INTO s FROM public.siswa WHERE id = NEW.siswa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data calon murid tidak ditemukan';
  END IF;
  SELECT * INTO dep FROM public.departemen WHERE id = s.departemen_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lembaga calon murid tidak ditemukan';
  END IF;

  SELECT id INTO target_year
  FROM public.tahun_ajaran
  WHERE nama = 'Tahun Ajaran 2027-2028'
  ORDER BY tanggal_mulai DESC NULLS LAST, id
  LIMIT 1;
  IF target_year IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Tahun Ajaran 2027-2028 belum tersedia';
  END IF;

  SELECT id INTO target_cohort
  FROM public.angkatan
  WHERE departemen_id = s.departemen_id
    AND nama = 'Angkatan 2027'
    AND aktif = true
  ORDER BY id
  LIMIT 1;
  IF target_cohort IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi Angkatan 2027 untuk lembaga yang dipilih belum tersedia';
  END IF;

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
  IF length(normalized_nik) <> 16 THEN
    RAISE EXCEPTION 'NIK Calon Murid harus terdiri dari 16 digit';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.siswa_detail d
    WHERE d.siswa_id <> NEW.siswa_id
      AND length(regexp_replace(COALESCE(d.nik, ''), '[^0-9]', '', 'g')) = 16
      AND regexp_replace(d.nik, '[^0-9]', '', 'g') = normalized_nik
  ) THEN
    RAISE EXCEPTION 'NIK Calon Murid sudah terdaftar pada data siswa lain';
  END IF;
  NEW.nik := normalized_nik;

  IF NULLIF(trim(COALESCE(s.alamat,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Alamat rumah wajib diisi';
  END IF;
  IF NULLIF(trim(COALESCE(s.telepon,'')), '') IS NULL THEN
    RAISE EXCEPTION 'No. HP/WhatsApp yang bisa dihubungi wajib diisi';
  END IF;

  IF upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
     OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)' THEN
    normalized_nisn := regexp_replace(COALESCE(s.nisn,''), '[^0-9]', '', 'g');
    IF length(normalized_nisn) <> 10 THEN
      RAISE EXCEPTION 'NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA';
    END IF;
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
    IF COALESCE(NEW.jenis_pendaftaran,'baru') <> 'alumni_internal' THEN
      NEW.status_asrama := 'asrama';
    END IF;
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
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.spmb_mark_milestone(p_siswa_id uuid, p_action text)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d public.siswa_detail;
  marked_at timestamptz := now();
BEGIN
  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data SPMB tidak ditemukan atau akses ditolak';
  END IF;

  CASE p_action
    WHEN 'tes' THEN
      IF d.spmb_tanggal_tes IS NOT NULL THEN
        RETURN d.spmb_tanggal_tes;
      END IF;
      UPDATE public.siswa_detail
      SET spmb_tanggal_tes = marked_at
      WHERE siswa_id = p_siswa_id;

    WHEN 'lulus' THEN
      IF d.spmb_tanggal_tes IS NULL THEN
        RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu';
      END IF;
      UPDATE public.siswa_detail
      SET spmb_status_kelulusan = 'lulus',
          spmb_tanggal_lulus = COALESCE(spmb_tanggal_lulus, marked_at),
          spmb_tanggal_keputusan = marked_at
      WHERE siswa_id = p_siswa_id;

    WHEN 'tidak_lulus' THEN
      IF d.spmb_tanggal_tes IS NULL THEN
        RAISE EXCEPTION 'Calon murid harus ditandai Sudah Tes terlebih dahulu';
      END IF;
      UPDATE public.siswa_detail
      SET spmb_status_kelulusan = 'tidak_lulus',
          spmb_tanggal_lulus = NULL,
          spmb_tanggal_daftar_ulang = NULL,
          spmb_tanggal_keputusan = marked_at
      WHERE siswa_id = p_siswa_id;

    WHEN 'daftar_ulang' THEN
      IF COALESCE(d.spmb_status_kelulusan,'') <> 'lulus' OR d.spmb_tanggal_lulus IS NULL THEN
        RAISE EXCEPTION 'Calon murid harus dinyatakan Lulus terlebih dahulu';
      END IF;
      IF d.spmb_tanggal_daftar_ulang IS NOT NULL THEN
        RETURN d.spmb_tanggal_daftar_ulang;
      END IF;
      UPDATE public.siswa_detail
      SET spmb_tanggal_daftar_ulang = marked_at
      WHERE siswa_id = p_siswa_id;

    ELSE
      RAISE EXCEPTION 'Aksi SPMB tidak valid';
  END CASE;

  RETURN marked_at;
END
$$;

CREATE OR REPLACE FUNCTION public.spmb_verification_payload(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  dep public.departemen;
  ang public.angkatan;
  ta public.tahun_ajaran;
  need_asrama boolean := false;
  mta_new boolean := false;
  need_nisn boolean := false;
  is_transfer boolean := false;
  snapshot jsonb;
  requirements jsonb;
  version_value text;
BEGIN
  SELECT * INTO s FROM public.siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Siswa tidak ditemukan'; END IF;
  SELECT * INTO d FROM public.siswa_detail WHERE siswa_id = p_siswa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data SPMB tidak ditemukan'; END IF;
  SELECT * INTO dep FROM public.departemen WHERE id = s.departemen_id;
  SELECT * INTO ang FROM public.angkatan WHERE id = s.angkatan_id;
  SELECT * INTO ta FROM public.tahun_ajaran WHERE id = d.tahun_ajaran_id;

  need_asrama := dep.id IS NOT NULL AND (
    upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
    OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)'
  );
  mta_new := (
    upper(trim(COALESCE(dep.kode,''))) = 'MTA'
    OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)MTA(\s|$)'
  ) AND COALESCE(d.jenis_pendaftaran,'baru') <> 'alumni_internal';
  need_nisn := dep.id IS NOT NULL AND (
    upper(trim(COALESCE(dep.kode,''))) IN ('SMP','SMA','MTA')
    OR upper(COALESCE(dep.nama,'')) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)'
  );
  is_transfer := COALESCE(d.kategori,'') = 'MURID PINDAHAN'
    OR COALESCE(d.jenis_pendaftaran,'') = 'pindahan';

  snapshot := jsonb_build_object(
    'nama',s.nama,'nisn',s.nisn,'jenis_kelamin',s.jenis_kelamin,
    'tempat_lahir',s.tempat_lahir,'tanggal_lahir',s.tanggal_lahir,
    'alamat',s.alamat,'telepon',s.telepon,'departemen_id',s.departemen_id,
    'angkatan_id',s.angkatan_id,'tahun_ajaran_id',d.tahun_ajaran_id,
    'nik',d.nik,'no_kk',d.no_kk,'kategori',d.kategori,
    'jenis_pendaftaran',d.jenis_pendaftaran,'status_asrama',CASE WHEN need_asrama THEN d.status_asrama ELSE NULL END,
    'anak_ke',d.anak_ke,'jumlah_bersaudara',d.jumlah_bersaudara,
    'jarak_rumah_km',d.jarak_rumah_km,'waktu_perjalanan_menit',d.waktu_perjalanan_menit,
    'transportasi',d.transportasi,'kemampuan_iqro',d.kemampuan_iqro,
    'membaca_latin',d.membaca_latin,'menulis_latin',d.menulis_latin,'hafalan_quran',d.hafalan_quran,
    'nama_ayah',d.nama_ayah,'nik_ayah',d.nik_ayah,'tempat_lahir_ayah',d.tempat_lahir_ayah,
    'tanggal_lahir_ayah',d.tanggal_lahir_ayah,'pendidikan_ayah',d.pendidikan_ayah,
    'pekerjaan_ayah',d.pekerjaan_ayah,'penghasilan_ayah',d.penghasilan_ayah,
    'telepon_ayah',d.telepon_ayah,'alamat_ayah',d.alamat_ayah,
    'nama_ibu',d.nama_ibu,'nik_ibu',d.nik_ibu,'tempat_lahir_ibu',d.tempat_lahir_ibu,
    'tanggal_lahir_ibu',d.tanggal_lahir_ibu,'pendidikan_ibu',d.pendidikan_ibu,
    'pekerjaan_ibu',d.pekerjaan_ibu,'penghasilan_ibu',d.penghasilan_ibu,
    'telepon_ibu',d.telepon_ibu,'alamat_ibu',d.alamat_ibu,
    'dokumen_kk_path',d.dokumen_kk_path,'dokumen_akta_path',d.dokumen_akta_path,
    'dokumen_rapor_path',CASE WHEN is_transfer THEN d.dokumen_rapor_path ELSE NULL END,
    'dokumen_ijazah_path',CASE WHEN is_transfer THEN d.dokumen_ijazah_path ELSE NULL END
  );
  version_value := md5(snapshot::text);

  requirements := jsonb_build_array(
    jsonb_build_object('key','nama','label','Nama lengkap calon murid','kind','field','required',true,'valid',COALESCE(char_length(trim(s.nama)) >= 2,false),'display_value',COALESCE(s.nama,'-')),
    jsonb_build_object('key','jenis_kelamin','label','Jenis kelamin','kind','field','required',true,'valid',COALESCE(s.jenis_kelamin IN ('L','P'),false),'display_value',CASE s.jenis_kelamin WHEN 'L' THEN 'Laki-laki' WHEN 'P' THEN 'Perempuan' ELSE '-' END),
    jsonb_build_object('key','tempat_lahir','label','Tempat lahir','kind','field','required',true,'valid',NULLIF(trim(COALESCE(s.tempat_lahir,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(s.tempat_lahir),''),'-')),
    jsonb_build_object('key','tanggal_lahir','label','Tanggal lahir','kind','field','required',true,'valid',s.tanggal_lahir IS NOT NULL,'display_value',COALESCE(to_char(s.tanggal_lahir,'DD-MM-YYYY'),'-')),
    jsonb_build_object('key','alamat','label','Alamat rumah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(s.alamat,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(s.alamat),''),'-')),
    jsonb_build_object('key','telepon','label','No. HP/WhatsApp yang bisa dihubungi','kind','field','required',true,'valid',NULLIF(trim(COALESCE(s.telepon,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(s.telepon),''),'-')),
    jsonb_build_object('key','departemen_id','label','Lembaga tujuan','kind','field','required',true,'valid',dep.id IS NOT NULL,'display_value',COALESCE(dep.nama,'-')),
    jsonb_build_object('key','angkatan_id','label','Angkatan sesuai lembaga','kind','field','required',true,'valid',ang.id IS NOT NULL AND ang.departemen_id = s.departemen_id,'display_value',COALESCE(ang.nama,'-')),
    jsonb_build_object('key','tahun_ajaran_id','label','Periode Tahun Ajaran SPMB','kind','field','required',true,'valid',ta.id IS NOT NULL,'display_value',COALESCE(ta.nama,'-')),
    jsonb_build_object('key','nik','label','NIK Calon Murid (16 digit)','kind','field','required',true,'valid',COALESCE(d.nik ~ '^[0-9]{16}$',false),'display_value',COALESCE(d.nik,'-')),
    jsonb_build_object('key','no_kk','label','Nomor Kartu Keluarga','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.no_kk,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(d.no_kk),''),'-')),
    jsonb_build_object('key','kategori','label','Kategori pendaftaran','kind','field','required',true,'valid',COALESCE(d.kategori IN ('MURID BARU','MURID PINDAHAN'),false),'display_value',COALESCE(d.kategori,'-')),
    jsonb_build_object('key','anak_ke','label','Anak ke','kind','field','required',true,'valid',d.anak_ke IS NOT NULL AND d.anak_ke >= 0,'display_value',COALESCE(d.anak_ke::text,'-')),
    jsonb_build_object('key','jumlah_bersaudara','label','Jumlah bersaudara','kind','field','required',true,'valid',d.jumlah_bersaudara IS NOT NULL AND d.jumlah_bersaudara >= 0,'display_value',COALESCE(d.jumlah_bersaudara::text,'-')),
    jsonb_build_object('key','jarak_rumah_km','label','Jarak rumah ke sekolah','kind','field','required',true,'valid',d.jarak_rumah_km IS NOT NULL AND d.jarak_rumah_km >= 0,'display_value',CASE WHEN d.jarak_rumah_km IS NULL THEN '-' ELSE d.jarak_rumah_km::text || ' km' END),
    jsonb_build_object('key','waktu_perjalanan_menit','label','Waktu perjalanan','kind','field','required',true,'valid',d.waktu_perjalanan_menit IS NOT NULL AND d.waktu_perjalanan_menit >= 0,'display_value',CASE WHEN d.waktu_perjalanan_menit IS NULL THEN '-' ELSE d.waktu_perjalanan_menit::text || ' menit' END),
    jsonb_build_object('key','transportasi','label','Transportasi','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.transportasi,'')),'') IS NOT NULL,'display_value',COALESCE(d.transportasi,'-')),
    jsonb_build_object('key','kemampuan_iqro','label','Kemampuan Iqro','kind','field','required',true,'valid',COALESCE(d.kemampuan_iqro IN ('0','1','2','3','4','5','6','7'),false),'display_value',COALESCE(d.kemampuan_iqro,'-')),
    jsonb_build_object('key','membaca_latin','label','Kemampuan membaca Latin','kind','field','required',true,'valid',COALESCE(d.membaca_latin IN ('BAIK','CUKUP','KURANG'),false),'display_value',COALESCE(d.membaca_latin,'-')),
    jsonb_build_object('key','menulis_latin','label','Kemampuan menulis Latin','kind','field','required',true,'valid',COALESCE(d.menulis_latin IN ('BAIK','CUKUP','KURANG'),false),'display_value',COALESCE(d.menulis_latin,'-')),
    jsonb_build_object('key','hafalan_quran','label','Hafalan Qur''an','kind','field','required',true,'valid',COALESCE(d.hafalan_quran IN ('0','1','2','3'),false),'display_value',COALESCE(d.hafalan_quran,'-')),

    jsonb_build_object('key','nama_ayah','label','Nama Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.nama_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(NULLIF(trim(d.nama_ayah),''),'-')),
    jsonb_build_object('key','nik_ayah','label','NIK Ayah (16 digit)','kind','field','required',true,'valid',COALESCE(d.nik_ayah ~ '^[0-9]{16}$',false),'display_value',COALESCE(d.nik_ayah,'-')),
    jsonb_build_object('key','tempat_lahir_ayah','label','Tempat lahir Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.tempat_lahir_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(d.tempat_lahir_ayah,'-')),
    jsonb_build_object('key','tanggal_lahir_ayah','label','Tanggal lahir Ayah','kind','field','required',true,'valid',d.tanggal_lahir_ayah IS NOT NULL,'display_value',COALESCE(to_char(d.tanggal_lahir_ayah,'DD-MM-YYYY'),'-')),
    jsonb_build_object('key','pendidikan_ayah','label','Pendidikan Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.pendidikan_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(d.pendidikan_ayah,'-')),
    jsonb_build_object('key','pekerjaan_ayah','label','Pekerjaan Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.pekerjaan_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(d.pekerjaan_ayah,'-')),
    jsonb_build_object('key','penghasilan_ayah','label','Penghasilan Ayah','kind','field','required',true,'valid',d.penghasilan_ayah IS NOT NULL AND d.penghasilan_ayah >= 0,'display_value',COALESCE(d.penghasilan_ayah::text,'-')),
    jsonb_build_object('key','telepon_ayah','label','No. HP/WA Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.telepon_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(d.telepon_ayah,'-')),
    jsonb_build_object('key','alamat_ayah','label','Alamat Ayah','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.alamat_ayah,'')),'') IS NOT NULL,'display_value',COALESCE(d.alamat_ayah,'-')),

    jsonb_build_object('key','nama_ibu','label','Nama Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.nama_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.nama_ibu,'-')),
    jsonb_build_object('key','nik_ibu','label','NIK Ibu (16 digit)','kind','field','required',true,'valid',COALESCE(d.nik_ibu ~ '^[0-9]{16}$',false),'display_value',COALESCE(d.nik_ibu,'-')),
    jsonb_build_object('key','tempat_lahir_ibu','label','Tempat lahir Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.tempat_lahir_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.tempat_lahir_ibu,'-')),
    jsonb_build_object('key','tanggal_lahir_ibu','label','Tanggal lahir Ibu','kind','field','required',true,'valid',d.tanggal_lahir_ibu IS NOT NULL,'display_value',COALESCE(to_char(d.tanggal_lahir_ibu,'DD-MM-YYYY'),'-')),
    jsonb_build_object('key','pendidikan_ibu','label','Pendidikan Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.pendidikan_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.pendidikan_ibu,'-')),
    jsonb_build_object('key','pekerjaan_ibu','label','Pekerjaan Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.pekerjaan_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.pekerjaan_ibu,'-')),
    jsonb_build_object('key','penghasilan_ibu','label','Penghasilan Ibu','kind','field','required',true,'valid',d.penghasilan_ibu IS NOT NULL AND d.penghasilan_ibu >= 0,'display_value',COALESCE(d.penghasilan_ibu::text,'-')),
    jsonb_build_object('key','telepon_ibu','label','No. HP/WA Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.telepon_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.telepon_ibu,'-')),
    jsonb_build_object('key','alamat_ibu','label','Alamat Ibu','kind','field','required',true,'valid',NULLIF(trim(COALESCE(d.alamat_ibu,'')),'') IS NOT NULL,'display_value',COALESCE(d.alamat_ibu,'-')),

    jsonb_build_object('key','dokumen_kk_path','label','Kartu Keluarga','kind','document','required',true,'valid',COALESCE(d.dokumen_kk_path ~* '^kk/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_kk_path,'display_value',CASE WHEN d.dokumen_kk_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END),
    jsonb_build_object('key','dokumen_akta_path','label','Akta Kelahiran','kind','document','required',true,'valid',COALESCE(d.dokumen_akta_path ~* '^akta/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_akta_path,'display_value',CASE WHEN d.dokumen_akta_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END)
  );

  IF need_nisn THEN
    requirements := requirements || jsonb_build_array(
      jsonb_build_object('key','nisn','label','NISN (10 digit)','kind','field','required',true,'valid',COALESCE(s.nisn ~ '^[0-9]{10}$',false),'display_value',COALESCE(s.nisn,'-'))
    );
  END IF;

  IF need_asrama THEN
    requirements := requirements || jsonb_build_array(
      jsonb_build_object(
        'key','status_asrama','label',CASE WHEN mta_new THEN 'Asrama MTA (wajib)' ELSE 'Asrama / Non Asrama' END,
        'kind','field','required',true,
        'valid',CASE WHEN mta_new THEN COALESCE(d.status_asrama = 'asrama',false) ELSE COALESCE(d.status_asrama IN ('asrama','non_asrama'),false) END,
        'display_value',CASE d.status_asrama WHEN 'asrama' THEN 'Asrama' WHEN 'non_asrama' THEN 'Non Asrama' ELSE '-' END
      )
    );
  END IF;

  IF is_transfer THEN
    requirements := requirements || jsonb_build_array(
      jsonb_build_object('key','dokumen_rapor_path','label','Rapor siswa pindahan','kind','document','required',true,'valid',COALESCE(d.dokumen_rapor_path ~* '^rapor/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_rapor_path,'display_value',CASE WHEN d.dokumen_rapor_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END),
      jsonb_build_object('key','dokumen_ijazah_path','label','Ijazah/SKHUN siswa pindahan','kind','document','required',true,'valid',COALESCE(d.dokumen_ijazah_path ~* '^ijazah/[0-9a-f-]+\.(pdf|jpg|jpeg|png)$',false),'path',d.dokumen_ijazah_path,'display_value',CASE WHEN d.dokumen_ijazah_path IS NULL THEN 'Belum diunggah' ELSE 'Dokumen tersedia' END)
    );
  END IF;

  RETURN jsonb_build_object('version',version_value,'requirements',requirements);
END
$$;

DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.akademik_save_siswa(jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO f;
  f := replace(f,
    '''nama'',''nis'',''jenis_kelamin''',
    '''nama'',''nis'',''nisn'',''jenis_kelamin'''
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_apply_first_wave_promo(uuid)'::regprocedure) INTO f;
  f := replace(f,
    'OR COALESCE(d.kategori, '''') <> ''MURID BARU''
     OR COALESCE(d.jenis_pendaftaran, ''baru'') <> ''baru''',
    'OR COALESCE(d.kategori, '''') NOT IN (''MURID BARU'',''MURID PINDAHAN'')
     OR COALESCE(d.jenis_pendaftaran, ''baru'') NOT IN (''baru'',''pindahan'')'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_verification_state(uuid)'::regprocedure) INTO f;
  f := replace(f,
    'requirements := payload->''requirements'' || public.spmb_optional_verification_requirements(p_siswa_id);',
    'requirements := payload->''requirements'' || COALESCE((
       SELECT jsonb_agg(opt)
       FROM jsonb_array_elements(public.spmb_optional_verification_requirements(p_siswa_id)) opt
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(payload->''requirements'') req
         WHERE req->>''key'' = opt->>''key''
       )
     ), ''[]''::jsonb);'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_readiness(uuid)'::regprocedure) INTO f;
  f := replace(f,
    'IF NOT has_class THEN
    missing := array_append(missing, ''kelas dan tahun ajaran sesuai lembaga'');
  END IF;',
    'IF NOT has_class THEN
    missing := array_append(missing, ''kelas dan tahun ajaran sesuai lembaga'');
  END IF;
  IF COALESCE(d.spmb_status_kelulusan, '''') <> ''lulus'' THEN
    missing := array_append(missing, ''status kelulusan: Lulus'');
  END IF;'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_mark_verified(uuid,text)'::regprocedure) INTO f;
  f := replace(f,
    'IF d.dokumen_akta_path IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = ''pmb-dokumen'' AND o.name = d.dokumen_akta_path) THEN
    RAISE EXCEPTION ''Dokumen wajib belum tersedia di penyimpanan: Akta Kelahiran'';
  END IF;',
    'IF d.dokumen_akta_path IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = ''pmb-dokumen'' AND o.name = d.dokumen_akta_path) THEN
    RAISE EXCEPTION ''Dokumen wajib belum tersedia di penyimpanan: Akta Kelahiran'';
  END IF;
  IF COALESCE(d.kategori, '''') = ''MURID PINDAHAN'' THEN
    IF d.dokumen_rapor_path IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = ''pmb-dokumen'' AND o.name = d.dokumen_rapor_path) THEN
      RAISE EXCEPTION ''Dokumen wajib siswa pindahan belum tersedia: Rapor'';
    END IF;
    IF d.dokumen_ijazah_path IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = ''pmb-dokumen'' AND o.name = d.dokumen_ijazah_path) THEN
      RAISE EXCEPTION ''Dokumen wajib siswa pindahan belum tersedia: Ijazah/SKHUN'';
    END IF;
  END IF;'
  );
  EXECUTE f;
END
$patch$;
