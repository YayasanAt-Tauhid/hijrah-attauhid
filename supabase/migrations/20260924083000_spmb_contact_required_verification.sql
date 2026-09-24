-- No. HP / WhatsApp yang bisa dihubungi wajib dalam verifikasi Edit Siswa.
-- Field ini bukan data KK, tetapi wajib karena menjadi kontak operasional sekolah.

CREATE OR REPLACE FUNCTION public.spmb_kk_verification_required_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT ARRAY[
    'nama',
    'jenis_kelamin',
    'tempat_lahir',
    'tanggal_lahir',
    'alamat',
    'telepon',
    'nik',
    'no_kk',
    'nama_ayah',
    'pekerjaan_ayah',
    'nama_ibu',
    'pekerjaan_ibu',
    'dokumen_kk_path'
  ]::text[]
$$;

REVOKE ALL ON FUNCTION public.spmb_kk_verification_required_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_kk_verification_version(p_siswa_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT md5(jsonb_build_object(
    'nama', s.nama,
    'jenis_kelamin', s.jenis_kelamin,
    'tempat_lahir', s.tempat_lahir,
    'tanggal_lahir', s.tanggal_lahir,
    'alamat', s.alamat,
    'telepon', s.telepon,
    'nik', d.nik,
    'no_kk', d.no_kk,
    'nama_ayah', d.nama_ayah,
    'pekerjaan_ayah', d.pekerjaan_ayah,
    'nama_ibu', d.nama_ibu,
    'pekerjaan_ibu', d.pekerjaan_ibu,
    'dokumen_kk_path', d.dokumen_kk_path
  )::text)
  FROM public.siswa s
  JOIN public.siswa_detail d ON d.siswa_id = s.id
  WHERE s.id = p_siswa_id
$$;

REVOKE ALL ON FUNCTION public.spmb_kk_verification_version(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spmb_invalidate_on_siswa_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed text[] := '{}'::text[];
BEGIN
  IF NEW.nama IS DISTINCT FROM OLD.nama THEN changed := array_append(changed,'nama'); END IF;
  IF NEW.jenis_kelamin IS DISTINCT FROM OLD.jenis_kelamin THEN changed := array_append(changed,'jenis_kelamin'); END IF;
  IF NEW.tempat_lahir IS DISTINCT FROM OLD.tempat_lahir THEN changed := array_append(changed,'tempat_lahir'); END IF;
  IF NEW.tanggal_lahir IS DISTINCT FROM OLD.tanggal_lahir THEN changed := array_append(changed,'tanggal_lahir'); END IF;
  IF NEW.alamat IS DISTINCT FROM OLD.alamat THEN changed := array_append(changed,'alamat'); END IF;
  IF NEW.telepon IS DISTINCT FROM OLD.telepon THEN changed := array_append(changed,'telepon'); END IF;

  PERFORM public.spmb_invalidate_verification(NEW.id, changed);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS spmb_invalidate_siswa_verification ON public.siswa;
CREATE TRIGGER spmb_invalidate_siswa_verification
AFTER UPDATE OF nama, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat, telepon
ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.spmb_invalidate_on_siswa_change();

DO $patch$
DECLARE
  f text;
BEGIN
  SELECT pg_get_functiondef('public.spmb_mark_verified(uuid,text)'::regprocedure) INTO f;
  f := replace(f,
    'Data wajib berdasarkan KK belum tersedia atau tidak valid: %',
    'Data wajib verifikasi belum tersedia atau tidak valid: %'
  );
  f := replace(f,
    'Checklist wajib berdasarkan KK belum lengkap: %',
    'Checklist wajib verifikasi belum lengkap: %'
  );
  f := replace(f,
    'Data KK berubah sejak diperiksa. Muat ulang halaman dan lakukan pemeriksaan ulang',
    'Data wajib verifikasi berubah sejak diperiksa. Muat ulang halaman dan lakukan pemeriksaan ulang'
  );
  f := replace(f,
    'Petugas menyelesaikan pemeriksaan data inti berdasarkan Kartu Keluarga',
    'Petugas menyelesaikan pemeriksaan data inti Kartu Keluarga dan nomor kontak'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_set_field_verification(uuid,text,boolean,text)'::regprocedure) INTO f;
  f := replace(f,
    'Data KK berubah. Muat ulang halaman dan periksa kembali perubahan tersebut',
    'Data wajib verifikasi berubah. Muat ulang halaman dan periksa kembali perubahan tersebut'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_set_field_verifications(uuid,jsonb,text)'::regprocedure) INTO f;
  f := replace(f,
    'Data KK berubah. Muat ulang halaman dan periksa kembali perubahan tersebut',
    'Data wajib verifikasi berubah. Muat ulang halaman dan periksa kembali perubahan tersebut'
  );
  EXECUTE f;
END
$patch$;

COMMENT ON FUNCTION public.spmb_kk_verification_required_keys() IS
  'Daftar field wajib verifikasi Edit Siswa: data inti yang dicocokkan dengan KK ditambah No. HP/WhatsApp yang bisa dihubungi.';
