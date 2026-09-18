-- Admin quick registration still creates a minimal SPMB record, but the
-- two fields needed for follow-up communication are mandatory.

DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.spmb_admin_register(jsonb)'::regprocedure) INTO f;
  f := replace(
    f,
    'clean_phone := NULLIF(trim(COALESCE(p_payload->>''telepon'', '''')), '''');
  clean_address := NULLIF(trim(COALESCE(p_payload->>''alamat'', '''')), '''');',
    'clean_phone := NULLIF(trim(COALESCE(p_payload->>''telepon'', '''')), '''');
  clean_address := NULLIF(trim(COALESCE(p_payload->>''alamat'', '''')), '''');
  IF clean_phone IS NULL THEN
    RAISE EXCEPTION ''No. HP / WhatsApp yang bisa dihubungi wajib diisi'';
  END IF;
  IF clean_phone !~ ''^(\+62|62|0)[0-9]{7,16}$'' THEN
    RAISE EXCEPTION ''No. HP / WhatsApp tidak valid'';
  END IF;
  IF clean_address IS NULL THEN
    RAISE EXCEPTION ''Alamat rumah wajib diisi'';
  END IF;'
  );
  EXECUTE f;
END
$patch$;
