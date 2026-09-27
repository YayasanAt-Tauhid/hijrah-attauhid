-- Reconciled production migration for recurring SPP, family discounts, and academic exit cleanup.

-- Replaces the later experimental 20260927 migration files that were never recorded in production migration history.

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


-- Kebijakan keluarga + mutasi finansial siswa
-- 2026-09-27
--
-- 1. Saran keluarga memakai identitas kuat (No. KK/NIK orang tua) sebelum
--    fallback akun/nama orang tua.
-- 2. Pindah keluar memakai tanggal efektif dan otomatis menghentikan tagihan
--    masa depan. Potongan kakak-adik dihentikan bila keluarga tinggal <2 siswa
--    aktif di yayasan.
-- 3. RPC akademik_mutasi lama tetap kompatibel dan menerapkan cleanup yang sama
--    untuk action pindah/alumni.
--
-- Aturan siswa_diskon_no_overlap yang sudah ada TIDAK diubah: satu siswa
-- hanya boleh punya satu keringanan aktif per jenis pembayaran dan periode.

CREATE OR REPLACE FUNCTION public.saran_kelompok_keluarga(p_limit integer DEFAULT 200)
RETURNS TABLE(sumber text, kunci text, skor integer, jumlah_siswa integer, siswa jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'keuangan')
    OR public.is_penyetuju_diskon(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Tidak diizinkan melihat saran kelompok keluarga';
  END IF;

  RETURN QUERY
  WITH identitas AS (
    SELECT
      s.id,
      s.nama,
      s.nis,
      s.tanggal_lahir,
      s.keluarga_id,
      s.status,
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
    SELECT
      'no_kk'::text AS sumber,
      md5('kk:' || i.no_kk) AS kunci,
      100 AS skor,
      i.id AS siswa_id,
      i.nama AS siswa_nama,
      i.nis AS siswa_nis,
      i.tanggal_lahir AS siswa_tanggal_lahir
    FROM identitas i
    WHERE i.no_kk ~ '^[0-9]{16}$'

    UNION ALL

    SELECT
      'nik_ortu'::text,
      md5('ortu:' || i.nik_ayah || ':' || i.nik_ibu),
      95,
      i.id, i.nama, i.nis, i.tanggal_lahir
    FROM identitas i
    WHERE i.nik_ayah ~ '^[0-9]{16}$'
      AND i.nik_ibu ~ '^[0-9]{16}$'

    UNION ALL

    SELECT
      'akun_ortu'::text,
      md5('akun:' || os.user_id::text),
      90,
      s.id, s.nama, s.nis, s.tanggal_lahir
    FROM public.ortu_siswa os
    JOIN public.siswa s ON s.id = os.siswa_id
    WHERE s.keluarga_id IS NULL
      AND s.status = 'aktif'

    UNION ALL

    SELECT
      'nama_ortu'::text,
      md5('nama:' || i.nama_ayah || ':' || i.nama_ibu),
      60,
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

REVOKE ALL ON FUNCTION public.saran_kelompok_keluarga(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saran_kelompok_keluarga(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.akademik_akhiri_siswa(
  p_ids uuid[],
  p_status text,
  p_tanggal_efektif date,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  v_processed integer := 0;
  v_tagihan record;
  v_keluarga_id uuid;
  v_aktif_keluarga integer;
  v_diskon record;
  v_alasan text;
BEGIN
  IF p_status NOT IN ('pindah','alumni') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  IF p_tanggal_efektif IS NULL THEN
    RAISE EXCEPTION 'Tanggal efektif wajib diisi';
  END IF;
  IF p_user_id IS NULL OR NOT (
    public.has_role(p_user_id,'admin') OR public.has_role(p_user_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF COALESCE(cardinality(p_ids),0)=0 THEN
    RAISE EXCEPTION 'Pilih siswa terlebih dahulu';
  END IF;

  FOR s IN
    SELECT * FROM public.siswa
    WHERE id = ANY(p_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF s.status <> 'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat diubah statusnya';
    END IF;

    v_keluarga_id := s.keluarga_id;
    v_alasan := CASE WHEN p_status='pindah'
      THEN 'Siswa pindah keluar efektif ' || p_tanggal_efektif::text
      ELSE 'Siswa menjadi alumni efektif ' || p_tanggal_efektif::text
    END;

    FOR v_tagihan IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id = s.id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(
              t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            ) >= p_tanggal_efektif
      ORDER BY t.jatuh_tempo NULLS LAST, t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan.id, 'batal', v_alasan, current_date, p_user_id, NULL
      );
    END LOOP;

    UPDATE public.siswa_diskon
    SET status = CASE
          WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
          ELSE status
        END,
        periode_selesai = CASE
          WHEN periode_mulai < p_tanggal_efektif
            AND periode_selesai >= p_tanggal_efektif
          THEN p_tanggal_efektif - 1
          ELSE periode_selesai
        END,
        catatan = concat_ws(
          E'\n',
          NULLIF(catatan,''),
          'Otomatis diakhiri karena ' || p_status || ' efektif ' || p_tanggal_efektif::text
        )
    WHERE siswa_id = s.id
      AND status IN ('diajukan','disetujui')
      AND periode_selesai >= p_tanggal_efektif;

    UPDATE public.siswa SET status = p_status WHERE id = s.id;
    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = s.id AND aktif;

    IF v_keluarga_id IS NOT NULL THEN
      SELECT count(*) INTO v_aktif_keluarga
      FROM public.siswa
      WHERE keluarga_id = v_keluarga_id
        AND status = 'aktif';

      IF v_aktif_keluarga < 2 THEN
        FOR v_diskon IN
          SELECT sd.id, sd.siswa_id, sd.jenis_id, sd.periode_mulai
          FROM public.siswa_diskon sd
          JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
          JOIN public.siswa sx ON sx.id = sd.siswa_id
          WHERE sx.keluarga_id = v_keluarga_id
            AND sx.status = 'aktif'
            AND sk.kategori = 'kakak_adik'
            AND sd.status IN ('diajukan','disetujui')
            AND sd.periode_selesai >= p_tanggal_efektif
        LOOP
          UPDATE public.tagihan t
          SET nominal = COALESCE(t.nominal_bruto,t.nominal),
              nominal_diskon = 0,
              siswa_diskon_id = NULL
          WHERE t.siswa_id = v_diskon.siswa_id
            AND t.jenis_id = v_diskon.jenis_id
            AND t.status = 'terjadwal'
            AND t.siswa_diskon_id = v_diskon.id
            AND COALESCE(
                  t.jatuh_tempo,
                  public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
                ) >= p_tanggal_efektif;

          UPDATE public.siswa_diskon
          SET status = CASE
                WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
                ELSE status
              END,
              periode_selesai = CASE
                WHEN periode_mulai < p_tanggal_efektif
                  AND periode_selesai >= p_tanggal_efektif
                THEN p_tanggal_efektif - 1
                ELSE periode_selesai
              END,
              catatan = concat_ws(
                E'\n',
                NULLIF(catatan,''),
                'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || p_tanggal_efektif::text
              )
          WHERE id = v_diskon.id;
        END LOOP;
      END IF;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  IF v_processed <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.akademik_pindah_keluar(
  p_ids uuid[],
  p_tanggal_efektif date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid,'admin') OR public.has_role(v_uid,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  RETURN public.akademik_akhiri_siswa(
    p_ids, 'pindah', p_tanggal_efektif, v_uid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_pindah_keluar(uuid[],date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_pindah_keluar(uuid[],date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.akademik_mutasi(
  p_ids uuid[],
  p_action text,
  p_kelas_id uuid DEFAULT NULL::uuid,
  p_tahun_ajaran_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  target uuid;
  processed integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid,'admin') OR public.has_role(v_uid,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF COALESCE(cardinality(p_ids),0)=0
     OR p_action NOT IN ('kelas','tinggal','alumni','pindah') THEN
    RAISE EXCEPTION 'Pilih siswa dan aksi yang valid';
  END IF;

  IF p_action IN ('alumni','pindah') THEN
    RETURN public.akademik_akhiri_siswa(
      p_ids, p_action, current_date, v_uid
    );
  END IF;

  FOR s IN
    SELECT * FROM public.siswa WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE
  LOOP
    IF s.status<>'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat dimutasi';
    END IF;

    IF p_tahun_ajaran_id IS NULL THEN
      RAISE EXCEPTION 'Tahun ajaran wajib dipilih';
    END IF;

    target := p_kelas_id;
    IF p_action='tinggal' THEN
      SELECT kelas_id INTO STRICT target
      FROM public.kelas_siswa WHERE siswa_id=s.id AND aktif;
    END IF;

    IF target IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.kelas WHERE id=target AND departemen_id=s.departemen_id
    ) THEN
      RAISE EXCEPTION 'Kelas tujuan harus sesuai lembaga siswa';
    END IF;

    UPDATE public.kelas_siswa SET aktif=false WHERE siswa_id=s.id AND aktif;
    INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
    VALUES(s.id,target,p_tahun_ajaran_id,true)
    ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id)
    DO UPDATE SET aktif=true;

    UPDATE public.tagihan t
    SET kelas_id = target
    WHERE t.siswa_id = s.id
      AND t.status = 'terjadwal'
      AND public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
          BETWEEN
            (SELECT tanggal_mulai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id)
            AND
            (SELECT tanggal_selesai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id);

    processed := processed + 1;
  END LOOP;

  IF processed<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;
  RETURN processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  TO authenticated, service_role;


-- Integrasikan rencana SPP dengan mutasi akademik.
-- Pindah/lulus menghentikan rencana. Kenaikan/tidak naik menghitung ulang akhir
-- jenjang. Cron harian menjalankan akrual dan rencana tagihan secara idempotent.

CREATE OR REPLACE FUNCTION public.akademik_akhiri_siswa(
  p_ids uuid[],
  p_status text,
  p_tanggal_efektif date,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  v_processed integer := 0;
  v_tagihan record;
  v_keluarga_id uuid;
  v_aktif_keluarga integer;
  v_diskon record;
  v_alasan text;
BEGIN
  IF p_status NOT IN ('pindah','alumni') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  IF p_tanggal_efektif IS NULL THEN
    RAISE EXCEPTION 'Tanggal efektif wajib diisi';
  END IF;
  IF p_user_id IS NULL OR NOT (
    public.has_role(p_user_id,'admin') OR public.has_role(p_user_id,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF COALESCE(cardinality(p_ids),0)=0 THEN
    RAISE EXCEPTION 'Pilih siswa terlebih dahulu';
  END IF;

  FOR s IN
    SELECT * FROM public.siswa
    WHERE id = ANY(p_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF s.status <> 'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat diubah statusnya';
    END IF;

    v_keluarga_id := s.keluarga_id;
    v_alasan := CASE WHEN p_status='pindah'
      THEN 'Siswa pindah keluar efektif ' || p_tanggal_efektif::text
      ELSE 'Siswa menjadi alumni efektif ' || p_tanggal_efektif::text
    END;

    FOR v_tagihan IN
      SELECT t.id
      FROM public.tagihan t
      WHERE t.siswa_id = s.id
        AND t.status IN ('terjadwal','belum_bayar')
        AND COALESCE(
              t.jatuh_tempo,
              public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
            ) >= p_tanggal_efektif
      ORDER BY t.jatuh_tempo NULLS LAST, t.id
    LOOP
      PERFORM public.batalkan_tagihan_atomik(
        v_tagihan.id, 'batal', v_alasan, current_date, p_user_id, NULL
      );
    END LOOP;

    UPDATE public.rencana_tagihan_siswa
    SET aktif = false,
        updated_at = now(),
        dinonaktifkan_at = now(),
        dinonaktifkan_oleh = p_user_id,
        dinonaktifkan_alasan = v_alasan
    WHERE siswa_id = s.id
      AND aktif = true;

    UPDATE public.siswa_diskon
    SET status = CASE
          WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
          ELSE status
        END,
        periode_selesai = CASE
          WHEN periode_mulai < p_tanggal_efektif
            AND periode_selesai >= p_tanggal_efektif
          THEN p_tanggal_efektif - 1
          ELSE periode_selesai
        END,
        catatan = concat_ws(
          E'\n',
          NULLIF(catatan,''),
          'Otomatis diakhiri karena ' || p_status || ' efektif ' || p_tanggal_efektif::text
        )
    WHERE siswa_id = s.id
      AND status IN ('diajukan','disetujui')
      AND periode_selesai >= p_tanggal_efektif;

    UPDATE public.siswa SET status = p_status WHERE id = s.id;
    UPDATE public.kelas_siswa SET aktif = false WHERE siswa_id = s.id AND aktif;

    IF v_keluarga_id IS NOT NULL THEN
      SELECT count(*) INTO v_aktif_keluarga
      FROM public.siswa
      WHERE keluarga_id = v_keluarga_id
        AND status = 'aktif';

      IF v_aktif_keluarga < 2 THEN
        FOR v_diskon IN
          SELECT sd.id, sd.siswa_id, sd.jenis_id, sd.periode_mulai
          FROM public.siswa_diskon sd
          JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
          JOIN public.siswa sx ON sx.id = sd.siswa_id
          WHERE sx.keluarga_id = v_keluarga_id
            AND sx.status = 'aktif'
            AND sk.kategori = 'kakak_adik'
            AND sd.status IN ('diajukan','disetujui')
            AND sd.periode_selesai >= p_tanggal_efektif
        LOOP
          UPDATE public.tagihan t
          SET nominal = COALESCE(t.nominal_bruto,t.nominal),
              nominal_diskon = 0,
              siswa_diskon_id = NULL
          WHERE t.siswa_id = v_diskon.siswa_id
            AND t.jenis_id = v_diskon.jenis_id
            AND t.status = 'terjadwal'
            AND t.siswa_diskon_id = v_diskon.id
            AND COALESCE(
                  t.jatuh_tempo,
                  public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
                ) >= p_tanggal_efektif;

          UPDATE public.siswa_diskon
          SET status = CASE
                WHEN periode_mulai >= p_tanggal_efektif THEN 'dibatalkan'
                ELSE status
              END,
              periode_selesai = CASE
                WHEN periode_mulai < p_tanggal_efektif
                  AND periode_selesai >= p_tanggal_efektif
                THEN p_tanggal_efektif - 1
                ELSE periode_selesai
              END,
              catatan = concat_ws(
                E'\n',
                NULLIF(catatan,''),
                'Otomatis diakhiri: saudara aktif di yayasan kurang dari 2 sejak ' || p_tanggal_efektif::text
              )
          WHERE id = v_diskon.id;
        END LOOP;
      END IF;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  IF v_processed <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akademik_akhiri_siswa(uuid[],text,date,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.akademik_mutasi(
  p_ids uuid[],
  p_action text,
  p_kelas_id uuid DEFAULT NULL::uuid,
  p_tahun_ajaran_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.siswa;
  target uuid;
  processed integer := 0;
  v_uid uuid := auth.uid();
  v_akhir date;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid,'admin') OR public.has_role(v_uid,'admin_tu')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  IF COALESCE(cardinality(p_ids),0)=0
     OR p_action NOT IN ('kelas','tinggal','alumni','pindah') THEN
    RAISE EXCEPTION 'Pilih siswa dan aksi yang valid';
  END IF;

  IF p_action IN ('alumni','pindah') THEN
    RETURN public.akademik_akhiri_siswa(
      p_ids, p_action, current_date, v_uid
    );
  END IF;

  FOR s IN
    SELECT * FROM public.siswa WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE
  LOOP
    IF s.status<>'aktif' THEN
      RAISE EXCEPTION 'Hanya siswa aktif yang dapat dimutasi';
    END IF;

    IF p_tahun_ajaran_id IS NULL THEN
      RAISE EXCEPTION 'Tahun ajaran wajib dipilih';
    END IF;

    target := p_kelas_id;
    IF p_action='tinggal' THEN
      SELECT kelas_id INTO STRICT target
      FROM public.kelas_siswa WHERE siswa_id=s.id AND aktif;
    END IF;

    IF target IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.kelas WHERE id=target AND departemen_id=s.departemen_id
    ) THEN
      RAISE EXCEPTION 'Kelas tujuan harus sesuai lembaga siswa';
    END IF;

    UPDATE public.kelas_siswa SET aktif=false WHERE siswa_id=s.id AND aktif;
    INSERT INTO public.kelas_siswa(siswa_id,kelas_id,tahun_ajaran_id,aktif)
    VALUES(s.id,target,p_tahun_ajaran_id,true)
    ON CONFLICT(siswa_id,kelas_id,tahun_ajaran_id)
    DO UPDATE SET aktif=true;

    UPDATE public.tagihan t
    SET kelas_id = target
    WHERE t.siswa_id = s.id
      AND t.status = 'terjadwal'
      AND public.hitung_bulan_periode_tagihan(t.tahun_ajaran_id,t.bulan)
          BETWEEN
            (SELECT tanggal_mulai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id)
            AND
            (SELECT tanggal_selesai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id);

    IF EXISTS (
      SELECT 1 FROM public.rencana_tagihan_siswa
      WHERE siswa_id = s.id
        AND aktif = true
        AND sampai_akhir_jenjang = true
    ) THEN
      v_akhir := public.hitung_akhir_jenjang_siswa(
        s.id, p_tahun_ajaran_id, target
      );

      UPDATE public.rencana_tagihan_siswa
      SET selesai = v_akhir,
          updated_at = now()
      WHERE siswa_id = s.id
        AND aktif = true
        AND sampai_akhir_jenjang = true;
    END IF;

    processed := processed + 1;
  END LOOP;

  IF processed<>(SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Sebagian siswa tidak ditemukan';
  END IF;

  RETURN processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.akademik_mutasi(uuid[],text,uuid,uuid)
  TO authenticated, service_role;



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


-- Kunci RPC keuangan/diskon yang hanya dipanggil melalui server admin client.
-- Menutup grant lama ke anon/authenticated tanpa mengubah logika bisnis.

REVOKE ALL ON FUNCTION public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.batalkan_tagihan_batch(uuid[],text,date,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batalkan_tagihan_atomik(uuid,text,text,date,uuid,numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.batalkan_tagihan_batch(uuid[],text,date,uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.saran_kelompok_keluarga(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.konfirmasi_kelompok_keluarga(text,uuid[],uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.putuskan_diskon_siswa(uuid,boolean,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hitung_bulan_periode_tagihan(uuid,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.saran_kelompok_keluarga(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.konfirmasi_kelompok_keluarga(text,uuid[],uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.terapkan_diskon_siswa(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.putuskan_diskon_siswa(uuid,boolean,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hitung_bulan_periode_tagihan(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hitung_diskon_tagihan(uuid,uuid,uuid,integer,numeric) TO service_role;



DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='akrual-jatuh-tempo-harian') THEN
      PERFORM cron.schedule(
        'akrual-jatuh-tempo-harian',
        '5 0 * * *',
        'select public.jalankan_akrual_jatuh_tempo();'
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='rencana-tagihan-siswa-harian') THEN
      PERFORM cron.schedule(
        'rencana-tagihan-siswa-harian',
        '15 0 * * *',
        'select public.jalankan_rencana_tagihan_siswa(current_date);'
      );
    END IF;
  END IF;
END
$cron$;
