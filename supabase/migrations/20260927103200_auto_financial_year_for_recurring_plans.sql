-- Pastikan rencana SPP tidak berhenti hanya karena Tahun Buku kalender berikutnya
-- belum dibuat jauh-jauh hari. Tahun Buku yang dibuat otomatis tidak dijadikan aktif.

CREATE OR REPLACE FUNCTION public.pastikan_tahun_buku_kalender(
  p_tanggal date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tahun integer := extract(year from p_tanggal)::integer;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('tahun_buku_kalender:' || v_tahun::text));

  SELECT id INTO v_id
  FROM public.tahun_buku
  WHERE tanggal_mulai <= p_tanggal
    AND tanggal_selesai >= p_tanggal
  ORDER BY tanggal_mulai DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.tahun_buku(
    nama, tanggal_mulai, tanggal_selesai, aktif, ditutup, keterangan
  )
  VALUES(
    'Tahun ' || v_tahun::text,
    make_date(v_tahun,1,1),
    make_date(v_tahun,12,31),
    false,
    false,
    'Dibuat otomatis untuk mendukung rencana tagihan siswa. Tidak otomatis dijadikan Tahun Buku aktif.'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pastikan_tahun_buku_kalender(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pastikan_tahun_buku_kalender(date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.jalankan_rencana_tagihan_siswa(
  p_tanggal date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mulai date := date_trunc('month', p_tanggal)::date;
  v_tahun_buku_id uuid;
  v_row record;
  v_result record;
  v_siswa_list jsonb;
  v_generated integer := 0;
  v_skipped integer := 0;
  v_scheduled integer := 0;
  v_errors text[] := '{}';
  v_diskon jsonb;
BEGIN
  v_diskon := public.sinkronkan_diskon_kakak_adik_bulanan(p_tanggal);
  v_tahun_buku_id := public.pastikan_tahun_buku_kalender(v_mulai);

  IF EXISTS (
    SELECT 1 FROM public.tahun_buku
    WHERE id=v_tahun_buku_id AND COALESCE(ditutup,false)=true
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'periode', v_mulai,
      'generated', 0,
      'skipped', 0,
      'scheduled', 0,
      'diskon_kakak_adik', v_diskon,
      'errors', jsonb_build_array('Tahun Buku untuk periode ini sudah ditutup')
    );
  END IF;

  FOR v_row IN
    SELECT
      r.id AS rencana_id,
      r.siswa_id,
      r.jenis_id,
      r.created_by,
      ks.kelas_id,
      k.departemen_id
    FROM public.rencana_tagihan_siswa r
    JOIN public.siswa s ON s.id = r.siswa_id AND s.status = 'aktif'
    JOIN LATERAL (
      SELECT ks0.kelas_id
      FROM public.kelas_siswa ks0
      WHERE ks0.siswa_id = r.siswa_id
        AND ks0.aktif = true
      ORDER BY ks0.id DESC
      LIMIT 1
    ) ks ON true
    JOIN public.kelas k ON k.id = ks.kelas_id
    WHERE r.aktif = true
      AND v_mulai BETWEEN date_trunc('month',r.mulai)::date
                      AND date_trunc('month',r.selesai)::date
    ORDER BY r.siswa_id, r.jenis_id
  LOOP
    BEGIN
      v_siswa_list := jsonb_build_array(
        jsonb_build_object('siswa_id',v_row.siswa_id,'kelas_id',v_row.kelas_id)
      );

      SELECT x.generated, x.skipped, x.scheduled, x.errors
      INTO v_result
      FROM public.generate_tagihan_batch(
        v_row.jenis_id,
        v_tahun_buku_id,
        extract(month from v_mulai)::integer,
        v_row.departemen_id,
        v_siswa_list,
        v_row.created_by
      ) x;

      v_generated := v_generated + COALESCE(v_result.generated,0);
      v_skipped := v_skipped + COALESCE(v_result.skipped,0);
      v_scheduled := v_scheduled + COALESCE(v_result.scheduled,0);

      IF v_result.errors IS NOT NULL AND cardinality(v_result.errors) > 0 THEN
        v_errors := v_errors || v_result.errors;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || (
        'Rencana ' || v_row.rencana_id::text || ': ' || SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', cardinality(v_errors) = 0,
    'periode', v_mulai,
    'tahun_buku_id', v_tahun_buku_id,
    'generated', v_generated,
    'skipped', v_skipped,
    'scheduled', v_scheduled,
    'diskon_kakak_adik', v_diskon,
    'errors', to_jsonb(v_errors)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.jalankan_rencana_tagihan_siswa(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jalankan_rencana_tagihan_siswa(date)
  TO service_role;
