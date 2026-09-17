-- Cross-book payment semantics:
--   * tagihan and its target period remain in the selected Tahun Buku;
--   * pembayaran and the cash journal belong to the Tahun Buku containing
--     tanggal_bayar.
-- Keep this migration deliberately self-contained by transforming the live
-- function definitions, so it remains safe when earlier function bodies have
-- received unrelated fixes.

DO $$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.proses_pembayaran_atomik(uuid,uuid,integer,numeric,date,text,uuid,uuid,boolean,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure;

  IF position('v_tahun_target' IN v_sql) = 0 THEN
    v_sql := replace(
      v_sql,
      E'  v_periode_bayar   uuid;\n',
      E'  v_periode_bayar   uuid;\n  v_tahun_target    uuid;\n'
    );
    v_sql := replace(
      v_sql,
      E'  IF p_is_bayar_dimuka THEN\n',
      E'  SELECT tahun_ajaran_id INTO v_tahun_target\n'
      || E'  FROM public.tagihan\n'
      || E'  WHERE id = p_tagihan_id;\n\n'
      || E'  IF p_is_bayar_dimuka THEN\n'
    );
    v_sql := replace(
      v_sql,
      E'      COALESCE(v_periode_bayar, p_tahun_ajaran_id), p_tahun_ajaran_id,\n',
      E'      COALESCE(v_periode_bayar, p_tahun_ajaran_id),\n'
      || E'      COALESCE(v_tahun_target, p_tahun_ajaran_id),\n'
    );
    EXECUTE v_sql;
  END IF;
END
$$;

DO $$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.proses_pembayaran_midtrans_atomik(uuid,uuid,uuid,integer,numeric,date,uuid,uuid,text,text,uuid,uuid,text)'::regprocedure;

  IF position('COALESCE(v_periode_bayar, p_tahun_ajaran_id), v_bulan_norm' IN v_sql) = 0 THEN
    v_sql := replace(
      v_sql,
      E'  INSERT INTO public.pembayaran (\n',
      E'  SELECT id INTO v_periode_bayar\n'
      || E'  FROM public.tahun_buku\n'
      || E'  WHERE p_tanggal_bayar >= tanggal_mulai\n'
      || E'    AND p_tanggal_bayar <= tanggal_selesai\n'
      || E'  ORDER BY tanggal_mulai DESC\n'
      || E'  LIMIT 1;\n\n'
      || E'  INSERT INTO public.pembayaran (\n'
    );
    v_sql := replace(
      v_sql,
      E'    p_siswa_id, p_jenis_id, p_tahun_ajaran_id, v_bulan_norm,\n',
      E'    p_siswa_id, p_jenis_id, COALESCE(v_periode_bayar, p_tahun_ajaran_id), v_bulan_norm,\n'
    );
    EXECUTE v_sql;
  END IF;
END
$$;
