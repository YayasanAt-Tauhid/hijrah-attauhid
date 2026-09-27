-- Rencana SPP berulang sampai akhir jenjang.
-- Tidak membuat tagihan bertahun-tahun sekaligus: satu rencana diproses
-- idempotent setiap hari, sehingga kelas/tarif/diskon saat itu yang dipakai.

CREATE TABLE IF NOT EXISTS public.rencana_tagihan_siswa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  jenis_id uuid NOT NULL REFERENCES public.jenis_pembayaran(id) ON DELETE RESTRICT,
  nominal numeric NOT NULL CHECK (nominal > 0),
  mulai date NOT NULL,
  selesai date NOT NULL,
  sampai_akhir_jenjang boolean NOT NULL DEFAULT true,
  aktif boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  dinonaktifkan_at timestamptz,
  dinonaktifkan_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dinonaktifkan_alasan text,
  CONSTRAINT rencana_tagihan_periode_check CHECK (selesai >= mulai)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rencana_tagihan_siswa_aktif
  ON public.rencana_tagihan_siswa(siswa_id, jenis_id)
  WHERE aktif = true;

CREATE INDEX IF NOT EXISTS idx_rencana_tagihan_aktif_periode
  ON public.rencana_tagihan_siswa(aktif, mulai, selesai);

ALTER TABLE public.rencana_tagihan_siswa ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.rencana_tagihan_siswa TO authenticated;
GRANT ALL ON public.rencana_tagihan_siswa TO service_role;

DROP POLICY IF EXISTS rencana_tagihan_select_finance ON public.rencana_tagihan_siswa;
CREATE POLICY rencana_tagihan_select_finance
  ON public.rencana_tagihan_siswa
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'keuangan')
  );

CREATE OR REPLACE FUNCTION public.hitung_akhir_jenjang_siswa(
  p_siswa_id uuid,
  p_tahun_akademik_id uuid DEFAULT NULL,
  p_kelas_id uuid DEFAULT NULL
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kelas_id uuid := p_kelas_id;
  v_ta_id uuid := p_tahun_akademik_id;
  v_dept text;
  v_kelas text;
  v_tingkat text;
  v_ta_selesai date;
  v_level integer;
  v_level_akhir integer;
BEGIN
  IF v_kelas_id IS NULL THEN
    SELECT ks.kelas_id, ks.tahun_ajaran_id
      INTO v_kelas_id, v_ta_id
    FROM public.kelas_siswa ks
    WHERE ks.siswa_id = p_siswa_id
      AND ks.aktif = true
      AND (p_tahun_akademik_id IS NULL OR ks.tahun_ajaran_id = p_tahun_akademik_id)
    ORDER BY ks.id DESC
    LIMIT 1;
  ELSIF v_ta_id IS NULL THEN
    SELECT ks.tahun_ajaran_id
      INTO v_ta_id
    FROM public.kelas_siswa ks
    WHERE ks.siswa_id = p_siswa_id
      AND ks.kelas_id = v_kelas_id
    ORDER BY ks.aktif DESC, ks.id DESC
    LIMIT 1;
  END IF;

  IF v_kelas_id IS NULL OR v_ta_id IS NULL THEN
    RAISE EXCEPTION 'Kelas aktif/tahun ajaran siswa belum tersedia';
  END IF;

  SELECT upper(btrim(d.kode)), k.nama, t.nama, ta.tanggal_selesai
    INTO v_dept, v_kelas, v_tingkat, v_ta_selesai
  FROM public.kelas k
  JOIN public.departemen d ON d.id = k.departemen_id
  LEFT JOIN public.tingkat t ON t.id = k.tingkat_id
  JOIN public.tahun_ajaran ta ON ta.id = v_ta_id
  WHERE k.id = v_kelas_id;

  IF v_ta_selesai IS NULL THEN
    RAISE EXCEPTION 'Tanggal selesai tahun ajaran belum tersedia';
  END IF;

  IF v_dept = 'MTA' THEN
    v_level := NULLIF(substring(v_kelas from '([0-9]+)'), '')::integer;
    v_level_akhir := 6;
  ELSIF v_dept = 'SD' THEN
    v_level := NULLIF(substring(COALESCE(v_tingkat, v_kelas) from '([0-9]+)'), '')::integer;
    v_level_akhir := 6;
  ELSIF v_dept = 'SMP' THEN
    v_level := NULLIF(substring(COALESCE(v_tingkat, v_kelas) from '([0-9]+)'), '')::integer;
    v_level_akhir := 9;
  ELSIF v_dept = 'SMA' THEN
    v_level := NULLIF(substring(COALESCE(v_tingkat, v_kelas) from '([0-9]+)'), '')::integer;
    v_level_akhir := 12;
  ELSE
    RAISE EXCEPTION 'Rencana sampai akhir jenjang belum didukung untuk lembaga %', COALESCE(v_dept, '-');
  END IF;

  IF v_level IS NULL OR v_level > v_level_akhir THEN
    RAISE EXCEPTION 'Tingkat kelas tidak dapat ditentukan dari kelas %', COALESCE(v_kelas, '-');
  END IF;

  RETURN (v_ta_selesai + make_interval(years => (v_level_akhir - v_level)))::date;
END;
$function$;

REVOKE ALL ON FUNCTION public.hitung_akhir_jenjang_siswa(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hitung_akhir_jenjang_siswa(uuid,uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_nominal numeric,
  p_mulai date,
  p_tahun_akademik_id uuid,
  p_kelas_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_selesai date;
  v_id uuid;
  v_tarif_id uuid;
  v_tipe text;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'keuangan')
  ) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk membuat rencana tagihan';
  END IF;

  IF p_nominal IS NULL OR p_nominal <= 0 THEN
    RAISE EXCEPTION 'Nominal rencana harus lebih dari 0';
  END IF;

  IF p_mulai IS NULL OR p_tahun_akademik_id IS NULL THEN
    RAISE EXCEPTION 'Periode mulai dan tahun ajaran wajib diisi';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.siswa s
    WHERE s.id = p_siswa_id AND s.status = 'aktif'
  ) THEN
    RAISE EXCEPTION 'Rencana hanya dapat dibuat untuk siswa aktif';
  END IF;

  SELECT tipe INTO v_tipe
  FROM public.jenis_pembayaran
  WHERE id = p_jenis_id AND aktif = true;

  IF v_tipe IS DISTINCT FROM 'bulanan' THEN
    RAISE EXCEPTION 'Rencana sampai akhir jenjang hanya berlaku untuk pembayaran bulanan';
  END IF;

  v_selesai := public.hitung_akhir_jenjang_siswa(
    p_siswa_id, p_tahun_akademik_id, p_kelas_id
  );

  IF p_mulai > v_selesai THEN
    RAISE EXCEPTION 'Tanggal mulai rencana melewati akhir jenjang';
  END IF;

  UPDATE public.rencana_tagihan_siswa
  SET nominal = p_nominal,
      mulai = LEAST(mulai, p_mulai),
      selesai = v_selesai,
      sampai_akhir_jenjang = true,
      updated_at = now()
  WHERE siswa_id = p_siswa_id
    AND jenis_id = p_jenis_id
    AND aktif = true
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.rencana_tagihan_siswa(
      siswa_id, jenis_id, nominal, mulai, selesai,
      sampai_akhir_jenjang, aktif, created_by
    )
    VALUES(
      p_siswa_id, p_jenis_id, p_nominal, p_mulai, v_selesai,
      true, true, v_uid
    )
    RETURNING id INTO v_id;
  END IF;

  SELECT id INTO v_tarif_id
  FROM public.tarif_tagihan
  WHERE jenis_id = p_jenis_id
    AND siswa_id = p_siswa_id
    AND kelas_id IS NULL
    AND tahun_ajaran_id IS NULL
    AND aktif = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_tarif_id IS NULL THEN
    INSERT INTO public.tarif_tagihan(
      jenis_id, siswa_id, kelas_id, angkatan_id, tahun_ajaran_id,
      nominal, keterangan, aktif
    )
    VALUES(
      p_jenis_id, p_siswa_id, NULL, NULL, NULL,
      p_nominal, 'Tarif dasar otomatis sampai akhir jenjang', true
    )
    RETURNING id INTO v_tarif_id;
  ELSE
    UPDATE public.tarif_tagihan
    SET nominal = p_nominal,
        keterangan = concat_ws(
          ' · ',
          NULLIF(keterangan,''),
          'Aktif sebagai tarif dasar rencana sampai akhir jenjang'
        ),
        updated_at = now()
    WHERE id = v_tarif_id;
  END IF;

  RETURN jsonb_build_object(
    'rencana_id', v_id,
    'mulai', p_mulai,
    'selesai', v_selesai,
    'tarif_id', v_tarif_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(uuid,uuid,numeric,date,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(uuid,uuid,numeric,date,uuid,uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(
  p_tanggal date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mulai date := date_trunc('month', p_tanggal)::date;
  v_selesai date := (date_trunc('month', p_tanggal) + interval '1 month - 1 day')::date;
  v_row record;
  v_skema_id uuid;
  v_diskon_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_applied integer := 0;
BEGIN
  FOR v_row IN
    WITH anggota AS (
      SELECT
        s.id AS siswa_id,
        s.keluarga_id,
        s.tanggal_lahir,
        row_number() OVER (
          PARTITION BY s.keluarga_id
          ORDER BY s.tanggal_lahir ASC NULLS LAST, s.id
        ) AS urutan,
        count(*) OVER (PARTITION BY s.keluarga_id) AS jumlah,
        count(s.tanggal_lahir) OVER (PARTITION BY s.keluarga_id) AS jumlah_lahir
      FROM public.siswa s
      WHERE s.status = 'aktif'
        AND s.keluarga_id IS NOT NULL
    )
    SELECT
      a.siswa_id,
      a.keluarga_id,
      a.urutan,
      r.jenis_id
    FROM anggota a
    JOIN public.rencana_tagihan_siswa r
      ON r.siswa_id = a.siswa_id
     AND r.aktif = true
     AND v_mulai BETWEEN date_trunc('month', r.mulai)::date
                     AND date_trunc('month', r.selesai)::date
    WHERE a.jumlah >= 2
      AND a.jumlah_lahir = a.jumlah
      AND a.urutan >= 2
    ORDER BY a.keluarga_id, a.urutan, r.jenis_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.siswa_diskon sd
      WHERE sd.siswa_id = v_row.siswa_id
        AND sd.jenis_id = v_row.jenis_id
        AND sd.status IN ('diajukan','disetujui')
        AND daterange(sd.periode_mulai, sd.periode_selesai, '[]')
            && daterange(v_mulai, v_selesai, '[]')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT sk.id INTO v_skema_id
    FROM public.skema_diskon sk
    WHERE sk.aktif = true
      AND sk.kategori = 'kakak_adik'
      AND sk.nama = CASE
        WHEN v_row.urutan = 2 THEN 'Potongan Anak ke-2'
        ELSE 'Potongan Anak ke-3 dst'
      END
    LIMIT 1;

    IF v_skema_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.siswa_diskon(
      siswa_id, skema_diskon_id, jenis_id,
      periode_mulai, periode_selesai, nilai,
      status, catatan, diputuskan_at
    )
    VALUES(
      v_row.siswa_id, v_skema_id, v_row.jenis_id,
      v_mulai, v_selesai, 50000,
      'disetujui',
      'Potongan kakak/adik otomatis Rp50.000 setelah kelompok keluarga terverifikasi; tidak ditumpuk dengan potongan lain.',
      now()
    )
    RETURNING id INTO v_diskon_id;

    v_created := v_created + 1;

    IF EXISTS (
      SELECT 1 FROM public.tagihan t
      WHERE t.siswa_id = v_row.siswa_id
        AND t.jenis_id = v_row.jenis_id
        AND t.status IN ('terjadwal','belum_bayar')
        AND public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            BETWEEN v_mulai AND v_selesai
    ) THEN
      PERFORM public.terapkan_diskon_siswa(v_diskon_id, NULL);
      v_applied := v_applied + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'periode_mulai', v_mulai,
    'periode_selesai', v_selesai,
    'dibuat', v_created,
    'dilewati_karena_diskon_lain', v_skipped,
    'diterapkan_ke_tagihan_existing', v_applied
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sinkronkan_diskon_kakak_adik_bulanan(date)
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

  SELECT tb.id INTO v_tahun_buku_id
  FROM public.tahun_buku tb
  WHERE tb.tanggal_mulai <= v_mulai
    AND tb.tanggal_selesai >= v_mulai
    AND COALESCE(tb.ditutup,false) = false
  ORDER BY tb.tanggal_mulai DESC
  LIMIT 1;

  IF v_tahun_buku_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'periode', v_mulai,
      'generated', 0,
      'skipped', 0,
      'scheduled', 0,
      'diskon_kakak_adik', v_diskon,
      'errors', jsonb_build_array('Tahun Buku untuk periode ini belum tersedia atau sudah ditutup')
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

CREATE OR REPLACE FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(
  p_tarif_rows jsonb,
  p_tahun_akademik_id uuid,
  p_jenis_id uuid,
  p_generate_groups jsonb,
  p_departemen_id uuid DEFAULT NULL,
  p_siswa_ids uuid[] DEFAULT NULL,
  p_siswa_id uuid DEFAULT NULL,
  p_kelas_id uuid DEFAULT NULL,
  p_angkatan_id uuid DEFAULT NULL,
  p_sampai_akhir_jenjang boolean DEFAULT false,
  p_rencana_mulai date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hasil jsonb;
  v_rencana jsonb := NULL;
  v_nominal numeric;
BEGIN
  v_hasil := public.simpan_tarif_dan_generate_atomik(
    p_tarif_rows,
    p_tahun_akademik_id,
    p_jenis_id,
    p_generate_groups,
    p_departemen_id,
    p_siswa_ids,
    p_siswa_id,
    p_kelas_id,
    p_angkatan_id
  );

  IF p_sampai_akhir_jenjang THEN
    IF p_siswa_id IS NULL OR p_siswa_ids IS NOT NULL THEN
      RAISE EXCEPTION 'Rencana sampai akhir jenjang hanya dapat diaktifkan untuk satu siswa';
    END IF;
    IF p_rencana_mulai IS NULL THEN
      RAISE EXCEPTION 'Bulan mulai rencana wajib ditentukan';
    END IF;

    SELECT (x->>'nominal')::numeric
    INTO v_nominal
    FROM jsonb_array_elements(p_tarif_rows) x
    WHERE (x->>'siswa_id')::uuid = p_siswa_id
    ORDER BY (x->>'tahun_ajaran_id') NULLS LAST
    LIMIT 1;

    IF v_nominal IS NULL THEN
      RAISE EXCEPTION 'Nominal tarif siswa untuk rencana tidak ditemukan';
    END IF;

    v_rencana := public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(
      p_siswa_id,
      p_jenis_id,
      v_nominal,
      p_rencana_mulai,
      p_tahun_akademik_id,
      p_kelas_id
    );
  END IF;

  RETURN v_hasil || jsonb_build_object(
    'sampai_akhir_jenjang', p_sampai_akhir_jenjang,
    'rencana', v_rencana
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(
  jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,boolean,date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simpan_tarif_generate_dan_rencana_atomik(
  jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,boolean,date
) TO authenticated, service_role;
