-- Katalog skema untuk scripts/db-types/generate.py. HANYA MEMBACA (SELECT).
--
-- Pakai (dari VM Rustbase), nama dipisah koma tanpa spasi:
--   psql -U rustbase -d proj_kqylkreswang -X -At \
--     -v tabel=siswa,spmb_gelombang -v rpc=spmb_mark_verified -f katalog.sql > katalog.json
--
-- Keluaran: satu objek JSON { "tables": [...], "functions": [...] }.
-- Nama tabel/view/fungsi yang tidak ditemukan di skema `public` tidak muncul di keluaran;
-- generate.py melaporkannya.
SELECT json_build_object(
  'tables', COALESCE((
    SELECT json_agg(t ORDER BY t.name) FROM (
      SELECT
        c.relname AS name,
        c.relkind::text AS kind,
        (
          SELECT json_agg(json_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, NULL),
            'nullable', NOT a.attnotnull,
            'has_default', a.atthasdef,
            'generated', a.attgenerated::text,
            'identity', a.attidentity::text
          ) ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ) AS columns,
        COALESCE((
          SELECT json_agg(json_build_object(
            'name', k.conname,
            'columns', (SELECT json_agg(att.attname ORDER BY u.ord)
                        FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord)
                        JOIN pg_attribute att ON att.attrelid = k.conrelid AND att.attnum = u.attnum),
            'ref_table', fc.relname,
            'ref_columns', (SELECT json_agg(att.attname ORDER BY u.ord)
                            FROM unnest(k.confkey) WITH ORDINALITY u(attnum, ord)
                            JOIN pg_attribute att ON att.attrelid = k.confrelid AND att.attnum = u.attnum),
            'one_to_one', EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = k.conrelid AND (i.indisunique OR i.indisprimary)
                AND i.indnatts = cardinality(k.conkey)
                AND (SELECT array_agg(x ORDER BY x) FROM unnest(i.indkey::int2[]) x) =
                    (SELECT array_agg(x ORDER BY x) FROM unnest(k.conkey) x)
            )
          ) ORDER BY k.conname)
          FROM pg_constraint k
          JOIN pg_class fc ON fc.oid = k.confrelid
          WHERE k.conrelid = c.oid AND k.contype = 'f'
        ), '[]'::json) AS fks
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'v', 'm', 'p')
        AND c.relname = ANY (string_to_array(:'tabel', ','))
    ) t
  ), '[]'::json),
  'functions', COALESCE((
    SELECT json_agg(f ORDER BY f.name) FROM (
      SELECT
        p.proname AS name,
        (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS overloads,
        p.pronargdefaults AS n_defaults,
        p.proretset AS returns_set,
        format_type(p.prorettype, NULL) AS returns_type,
        p.proargnames AS arg_names,
        p.proargmodes::text[] AS arg_modes,
        (SELECT json_agg(format_type(t, NULL) ORDER BY ord)
         FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) WITH ORDINALITY u(t, ord)) AS arg_types,
        p.pronargs AS n_in_args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND p.proname = ANY (string_to_array(:'rpc', ','))
    ) f
  ), '[]'::json)
);
