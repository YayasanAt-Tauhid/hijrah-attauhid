-- Samakan pembentukan NIS mutasi/aktivasi internal dengan generator NIS aplikasi:
-- gunakan maksimal 4 digit terakhir NPSN, tetapi jangan memblokir data legacy
-- yang NPSN-nya sementara lebih pendek. Posisi nomor urut dihitung dinamis.

DO $$
DECLARE
  f text;
BEGIN
  SELECT pg_get_functiondef(
    'public.akademik_mutasi_antar_lembaga(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure
  ) INTO f;
  f := replace(
    f,
    'IF length(npsn_digits) < 4 THEN',
    'IF length(npsn_digits) < 1 THEN'
  );
  f := replace(
    f,
    'substring(x.nis from 5 for 3)::integer',
    'substring(x.nis from length(npsn4)+1 for 3)::integer'
  );
  EXECUTE f;

  SELECT pg_get_functiondef(
    'public.spmb_activate_internal_student(uuid,uuid,uuid)'::regprocedure
  ) INTO f;
  f := replace(
    f,
    'IF length(npsn_digits) < 4 THEN',
    'IF length(npsn_digits) < 1 THEN'
  );
  f := replace(
    f,
    'substring(x.nis from 5 for 3)::integer',
    'substring(x.nis from length(npsn4)+1 for 3)::integer'
  );
  EXECUTE f;
END
$$;
