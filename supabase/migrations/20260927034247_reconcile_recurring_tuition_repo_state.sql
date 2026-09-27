-- Final permission/eligibility fix for recurring tuition + family discounts.
-- Server functions authorize the human user first, then call these RPCs with
-- the service-role client. Therefore service-only RPCs must not depend on auth.uid().

CREATE OR REPLACE FUNCTION public.saran_kelompok_keluarga(p_limit integer DEFAULT 200)
RETURNS TABLE(sumber text, kunci text, skor integer, jumlah_siswa integer, siswa jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH identitas AS (
    SELECT
      s.id,
      s.nama,
      s.nis,
      s.tanggal_lahir,
      regexp_replace(COALESCE(sd.no_kk, ''), '\D', '', 'g') AS no_kk,
      regexp_replace(COALESCE(sd.nik_ayah, ''), '\D', '', 'g') AS nik_ayah,
      regexp_replace(COALESCE(sd.nik_ibu, ''), '\D', '', 'g') AS nik_ibu,
      lower(btrim(regexp_replace(COALESCE(sd.nama_ayah, ''), '\s+', ' ', 'g'))) AS nama_ayah,
      lower(btrim(regexp_replace(COALESCE(sd.nama_ibu,  ''), '\s+', ' ', 'g'))) AS nama_ibu
    FROM public.siswa s
    LEFT JOIN public.siswa_detail sd ON sd.siswa_id = s.id
    WHERE s.keluarga_id IS NULL
      AND s.status = 'aktif'
  ),
  kandidat AS (
    SELECT 'no_kk'::text AS sumber, md5('kk:' || i.no_kk) AS kunci, 100 AS skor,
           i.id AS siswa_id, i.nama AS siswa_nama, i.nis AS siswa_nis,
           i.tanggal_lahir AS siswa_tanggal_lahir
    FROM identitas i
    WHERE i.no_kk ~ '^[0-9]{16}$'

    UNION ALL

    SELECT 'nik_ortu'::text, md5('ortu:' || i.nik_ayah || ':' || i.nik_ibu), 95,
           i.id, i.nama, i.nis, i.tanggal_lahir
    FROM identitas i
    WHERE i.nik_ayah ~ '^[0-9]{16}$'
      AND i.nik_ibu ~ '^[0-9]{16}$'

    UNION ALL

    SELECT 'akun_ortu'::text, md5('akun:' || os.user_id::text), 90,
           s.id, s.nama, s.nis, s.tanggal_lahir
    FROM public.ortu_siswa os
    JOIN public.siswa s ON s.id = os.siswa_id
    WHERE s.keluarga_id IS NULL
      AND s.status = 'aktif'

    UNION ALL

    SELECT 'nama_ortu'::text, md5('nama:' || i.nama_ayah || ':' || i.nama_ibu), 60,
           i.id, i.nama, i.nis, i.tanggal_lahir
    FROM identitas i
    WHERE i.nama_ayah <> ''
      AND i.nama_ibu <> ''
  ),
  digrup AS (
    SELECT
      k.sumber,
      k.kunci,
      max(k.skor)::integer AS skor,
      count(*)::integer AS jumlah_siswa,
      array_agg(k.siswa_id ORDER BY k.siswa_id) AS ids,
      jsonb_agg(
        jsonb_build_object(
          'siswa_id', k.siswa_id,
          'nama', k.siswa_nama,
          'nis', k.siswa_nis,
          'tanggal_lahir', k.siswa_tanggal_lahir
        )
        ORDER BY k.siswa_tanggal_lahir NULLS LAST, k.siswa_nama
      ) AS siswa
    FROM kandidat k
    GROUP BY k.sumber, k.kunci
    HAVING count(*) > 1
  ),
  dedup AS (
    SELECT DISTINCT ON (d.ids)
      d.sumber, d.kunci, d.skor, d.jumlah_siswa, d.siswa, d.ids
    FROM digrup d
    ORDER BY d.ids, d.skor DESC,
      CASE d.sumber
        WHEN 'no_kk' THEN 1
        WHEN 'nik_ortu' THEN 2
        WHEN 'akun_ortu' THEN 3
        ELSE 4
      END
  )
  SELECT d.sumber, d.kunci, d.skor, d.jumlah_siswa, d.siswa
  FROM dedup d
  ORDER BY d.skor DESC, d.jumlah_siswa DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.saran_kelompok_keluarga(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saran_kelompok_keluarga(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.validasi_diskon_kakak_adik()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_kategori text;
  v_keluarga_id uuid;
  v_saudara_aktif integer;
BEGIN
  SELECT kategori INTO v_kategori
  FROM public.skema_diskon
  WHERE id = NEW.skema_diskon_id;

  IF v_kategori IS DISTINCT FROM 'kakak_adik' THEN
    RETURN NEW;
  END IF;

  SELECT keluarga_id INTO v_keluarga_id
  FROM public.siswa
  WHERE id = NEW.siswa_id
    AND status = 'aktif';

  IF v_keluarga_id IS NULL THEN
    RAISE EXCEPTION
      'Potongan kakak-adik membutuhkan siswa aktif yang sudah dikelompokkan ke keluarga';
  END IF;

  SELECT count(*) INTO v_saudara_aktif
  FROM public.siswa
  WHERE keluarga_id = v_keluarga_id
    AND status = 'aktif';

  IF v_saudara_aktif < 2 THEN
    RAISE EXCEPTION
      'Potongan kakak-adik hanya berlaku bila minimal 2 bersaudara masih aktif di yayasan';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validasi_diskon_kakak_adik ON public.siswa_diskon;
CREATE TRIGGER trg_validasi_diskon_kakak_adik
BEFORE INSERT OR UPDATE OF siswa_id, skema_diskon_id
ON public.siswa_diskon
FOR EACH ROW
EXECUTE FUNCTION public.validasi_diskon_kakak_adik();
