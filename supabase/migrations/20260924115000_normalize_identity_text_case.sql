-- Normalize human-readable identity/location text consistently across SPMB,
-- academic forms, imports, and internal writes.
--
-- Identifiers (NIK/NISN/NIS/KK), phone numbers, document paths, statuses, and
-- other machine-readable fields are intentionally not changed.

CREATE OR REPLACE FUNCTION public.normalize_proper_case(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  source_text text;
  result_text text := '';
  ch text;
  capitalize_next boolean := true;
  token text;
  target text;
  i integer;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  source_text := lower(btrim(regexp_replace(p_value, '\s+', ' ', 'g')));
  IF source_text = '' THEN
    RETURN '';
  END IF;

  -- Capitalize the beginning of words while retaining punctuation. A hyphen,
  -- dot, slash, or opening bracket starts a new segment; apostrophes stay
  -- inside a word (Qur'an -> Qur'an).
  FOR i IN 1..char_length(source_text) LOOP
    ch := substr(source_text, i, 1);

    IF ch ~ '[[:alpha:]]' THEN
      result_text := result_text || CASE WHEN capitalize_next THEN upper(ch) ELSE ch END;
      capitalize_next := false;
    ELSE
      result_text := result_text || ch;
      IF ch IN (' ', '-', '.', '/', '(', '[', '{') THEN
        capitalize_next := true;
      END IF;
    END IF;
  END LOOP;

  -- Restore common education/address/institution abbreviations that ordinary
  -- Proper Case would otherwise turn into Smp, Rt, Sdit, etc.
  FOREACH token IN ARRAY ARRAY[
    'TKIT','SDIT','SDN','SMPIT','SMPN','SMAIT','SMAN','SMKN',
    'PAUD','TKQ','TPQ','SMP','SMA','SMK','MTA','MTsN','MTs','MIN','MI','MAN','MA','TK','SD','RA',
    'RT','RW','KH','DKI','DIY','PNS','TNI','POLRI','BUMN','BUMD','IT','PT','CV','UD',
    'II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'
  ] LOOP
    target := initcap(lower(token));
    result_text := regexp_replace(result_text, '\m' || target || '\M', token, 'g');
  END LOOP;

  RETURN result_text;
END;
$$;

COMMENT ON FUNCTION public.normalize_proper_case(text) IS
  'Normalisasi Proper Case untuk nama, sekolah, dan lokasi; mempertahankan singkatan umum seperti SMP, SMA, MTA, RT, RW, dan SDIT.';

CREATE OR REPLACE FUNCTION public.normalize_siswa_identity_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.nama := public.normalize_proper_case(NEW.nama);
  NEW.tempat_lahir := public.normalize_proper_case(NEW.tempat_lahir);
  NEW.alamat := public.normalize_proper_case(NEW.alamat);

  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(btrim(NEW.email));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_siswa_identity_text_insert ON public.siswa;
CREATE TRIGGER normalize_siswa_identity_text_insert
BEFORE INSERT ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.normalize_siswa_identity_text();

DROP TRIGGER IF EXISTS normalize_siswa_identity_text_update ON public.siswa;
CREATE TRIGGER normalize_siswa_identity_text_update
BEFORE UPDATE OF nama, tempat_lahir, alamat, email ON public.siswa
FOR EACH ROW
EXECUTE FUNCTION public.normalize_siswa_identity_text();

CREATE OR REPLACE FUNCTION public.normalize_siswa_detail_identity_text()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.nama_ayah := public.normalize_proper_case(NEW.nama_ayah);
  NEW.tempat_lahir_ayah := public.normalize_proper_case(NEW.tempat_lahir_ayah);
  NEW.alamat_ayah := public.normalize_proper_case(NEW.alamat_ayah);

  NEW.nama_ibu := public.normalize_proper_case(NEW.nama_ibu);
  NEW.tempat_lahir_ibu := public.normalize_proper_case(NEW.tempat_lahir_ibu);
  NEW.alamat_ibu := public.normalize_proper_case(NEW.alamat_ibu);

  NEW.alamat_ortu := public.normalize_proper_case(NEW.alamat_ortu);
  NEW.asal_sekolah := public.normalize_proper_case(NEW.asal_sekolah);
  NEW.alamat_sekolah_asal := public.normalize_proper_case(NEW.alamat_sekolah_asal);
  NEW.kabupaten_sekolah_asal := public.normalize_proper_case(NEW.kabupaten_sekolah_asal);
  NEW.kecamatan_sekolah_asal := public.normalize_proper_case(NEW.kecamatan_sekolah_asal);
  NEW.kelurahan_sekolah_asal := public.normalize_proper_case(NEW.kelurahan_sekolah_asal);
  NEW.spmb_inputer_nama := public.normalize_proper_case(NEW.spmb_inputer_nama);

  IF NEW.spmb_inputer_email IS NOT NULL THEN
    NEW.spmb_inputer_email := lower(btrim(NEW.spmb_inputer_email));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_siswa_detail_identity_text_insert ON public.siswa_detail;
CREATE TRIGGER normalize_siswa_detail_identity_text_insert
BEFORE INSERT ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.normalize_siswa_detail_identity_text();

DROP TRIGGER IF EXISTS normalize_siswa_detail_identity_text_update ON public.siswa_detail;
CREATE TRIGGER normalize_siswa_detail_identity_text_update
BEFORE UPDATE OF
  nama_ayah, tempat_lahir_ayah, alamat_ayah,
  nama_ibu, tempat_lahir_ibu, alamat_ibu,
  alamat_ortu, asal_sekolah, alamat_sekolah_asal,
  kabupaten_sekolah_asal, kecamatan_sekolah_asal, kelurahan_sekolah_asal,
  spmb_inputer_nama, spmb_inputer_email
ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.normalize_siswa_detail_identity_text();

-- Existing rows are deliberately not rewritten in bulk. They are normalized
-- naturally the next time the relevant identity/location fields are edited.
