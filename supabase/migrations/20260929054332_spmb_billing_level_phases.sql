-- Flexible SPMB billing-plan phases.
-- MTA is split into MTA 1-3 (SMP phase) and MTA 4-6 (SMA phase).
-- TK is supported through TK A -> TK B.
-- PAUD/KB and special cases may use an explicit final month/date.
-- Existing monthly billing remains generated incrementally, never all years at once.

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
  v_label text;
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
    IF v_level BETWEEN 1 AND 3 THEN
      v_level_akhir := 3;
    ELSIF v_level BETWEEN 4 AND 6 THEN
      v_level_akhir := 6;
    ELSE
      RAISE EXCEPTION 'Tingkat MTA tidak dapat ditentukan dari kelas %', COALESCE(v_kelas, '-');
    END IF;
  ELSIF v_dept = 'TK' THEN
    v_label := upper(COALESCE(v_tingkat, v_kelas, ''));
    IF v_label LIKE '%TK A%' THEN
      v_level := 1;
      v_level_akhir := 2;
    ELSIF v_label LIKE '%TK B%' THEN
      v_level := 2;
      v_level_akhir := 2;
    ELSE
      RAISE EXCEPTION 'Tingkat TK tidak dapat ditentukan dari kelas %', COALESCE(v_kelas, '-');
    END IF;
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
    RAISE EXCEPTION
      'Rencana sampai akhir jenjang belum didukung untuk lembaga %. Gunakan batas tanggal tertentu.',
      COALESCE(v_dept, '-');
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
    RAISE EXCEPTION 'Tanggal mulai rencana melewati akhir jenjang/fase';
  END IF;

  -- Arsipkan rencana fase lama yang memang sudah selesai sebelum fase baru dimulai.
  UPDATE public.rencana_tagihan_siswa
  SET aktif = false,
      updated_at = now(),
      dinonaktifkan_at = now(),
      dinonaktifkan_oleh = v_uid,
      dinonaktifkan_alasan = 'Rencana fase sebelumnya selesai sebelum periode baru dimulai'
  WHERE siswa_id = p_siswa_id
    AND jenis_id = p_jenis_id
    AND aktif = true
    AND selesai < p_mulai;

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
      p_nominal, 'Tarif dasar otomatis rencana SPP', true
    )
    RETURNING id INTO v_tarif_id;
  ELSE
    UPDATE public.tarif_tagihan
    SET nominal = p_nominal,
        keterangan = concat_ws(
          ' · ',
          NULLIF(keterangan,''),
          'Aktif sebagai tarif dasar rencana SPP'
        ),
        updated_at = now()
    WHERE id = v_tarif_id;
  END IF;

  RETURN jsonb_build_object(
    'rencana_id', v_id,
    'mode_akhir', 'akhir_jenjang',
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

CREATE OR REPLACE FUNCTION public.aktifkan_rencana_tagihan_sampai_tanggal(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_nominal numeric,
  p_mulai date,
  p_selesai date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
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
  IF p_mulai IS NULL OR p_selesai IS NULL OR p_selesai < p_mulai THEN
    RAISE EXCEPTION 'Periode rencana tidak valid';
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
    RAISE EXCEPTION 'Rencana tanggal tertentu hanya berlaku untuk pembayaran bulanan';
  END IF;

  UPDATE public.rencana_tagihan_siswa
  SET aktif = false,
      updated_at = now(),
      dinonaktifkan_at = now(),
      dinonaktifkan_oleh = v_uid,
      dinonaktifkan_alasan = 'Rencana sebelumnya selesai sebelum periode baru dimulai'
  WHERE siswa_id = p_siswa_id
    AND jenis_id = p_jenis_id
    AND aktif = true
    AND selesai < p_mulai;

  UPDATE public.rencana_tagihan_siswa
  SET nominal = p_nominal,
      mulai = p_mulai,
      selesai = p_selesai,
      sampai_akhir_jenjang = false,
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
      p_siswa_id, p_jenis_id, p_nominal, p_mulai, p_selesai,
      false, true, v_uid
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
      p_nominal, 'Tarif dasar otomatis rencana SPP', true
    )
    RETURNING id INTO v_tarif_id;
  ELSE
    UPDATE public.tarif_tagihan
    SET nominal = p_nominal,
        keterangan = concat_ws(
          ' · ',
          NULLIF(keterangan,''),
          'Aktif sebagai tarif dasar rencana SPP'
        ),
        updated_at = now()
    WHERE id = v_tarif_id;
  END IF;

  RETURN jsonb_build_object(
    'rencana_id', v_id,
    'mode_akhir', 'tanggal',
    'mulai', p_mulai,
    'selesai', p_selesai,
    'tarif_id', v_tarif_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aktifkan_rencana_tagihan_sampai_tanggal(uuid,uuid,numeric,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aktifkan_rencana_tagihan_sampai_tanggal(uuid,uuid,numeric,date,date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.simpan_tarif_generate_dan_rencana_fleksibel_atomik(
  p_tarif_rows jsonb,
  p_tahun_akademik_id uuid,
  p_jenis_id uuid,
  p_generate_groups jsonb,
  p_departemen_id uuid DEFAULT NULL,
  p_siswa_ids uuid[] DEFAULT NULL,
  p_siswa_id uuid DEFAULT NULL,
  p_kelas_id uuid DEFAULT NULL,
  p_angkatan_id uuid DEFAULT NULL,
  p_mode_akhir text DEFAULT 'akhir_jenjang',
  p_rencana_mulai date DEFAULT NULL,
  p_rencana_selesai date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hasil jsonb;
  v_rencana jsonb;
  v_nominal numeric;
BEGIN
  IF p_mode_akhir NOT IN ('akhir_jenjang','tanggal') THEN
    RAISE EXCEPTION 'Mode akhir rencana tidak valid';
  END IF;
  IF p_siswa_id IS NULL OR p_siswa_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Rencana SPP hanya dapat dibuat untuk satu siswa';
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

  IF v_nominal IS NULL OR v_nominal <= 0 THEN
    RAISE EXCEPTION 'Nominal tarif siswa untuk rencana tidak ditemukan';
  END IF;

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

  IF p_mode_akhir = 'akhir_jenjang' THEN
    v_rencana := public.aktifkan_rencana_tagihan_sampai_akhir_jenjang(
      p_siswa_id,
      p_jenis_id,
      v_nominal,
      p_rencana_mulai,
      p_tahun_akademik_id,
      p_kelas_id
    );
  ELSE
    IF p_rencana_selesai IS NULL THEN
      RAISE EXCEPTION 'Batas akhir rencana wajib ditentukan';
    END IF;
    v_rencana := public.aktifkan_rencana_tagihan_sampai_tanggal(
      p_siswa_id,
      p_jenis_id,
      v_nominal,
      p_rencana_mulai,
      p_rencana_selesai
    );
  END IF;

  RETURN v_hasil || jsonb_build_object(
    'mode_akhir', p_mode_akhir,
    'rencana', v_rencana
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.simpan_tarif_generate_dan_rencana_fleksibel_atomik(
  jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,text,date,date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.simpan_tarif_generate_dan_rencana_fleksibel_atomik(
  jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid,text,date,date
) TO authenticated, service_role;

-- Jangan memperpanjang rencana fase yang sudah selesai saat siswa naik ke fase baru.
-- Tinggal kelas tetap boleh menggeser akhir rencana.
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
  v_ta_mulai date;
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

    SELECT tanggal_mulai INTO v_ta_mulai
    FROM public.tahun_ajaran
    WHERE id = p_tahun_ajaran_id;

    IF v_ta_mulai IS NULL THEN
      RAISE EXCEPTION 'Tanggal mulai tahun ajaran belum tersedia';
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
            v_ta_mulai
            AND
            (SELECT tanggal_selesai FROM public.tahun_ajaran WHERE id=p_tahun_ajaran_id);

    IF EXISTS (
      SELECT 1
      FROM public.rencana_tagihan_siswa r
      WHERE r.siswa_id = s.id
        AND r.aktif = true
        AND r.sampai_akhir_jenjang = true
        AND (p_action = 'tinggal' OR r.selesai >= v_ta_mulai)
    ) THEN
      v_akhir := public.hitung_akhir_jenjang_siswa(
        s.id, p_tahun_ajaran_id, target
      );

      UPDATE public.rencana_tagihan_siswa r
      SET selesai = v_akhir,
          updated_at = now()
      WHERE r.siswa_id = s.id
        AND r.aktif = true
        AND r.sampai_akhir_jenjang = true
        AND (p_action = 'tinggal' OR r.selesai >= v_ta_mulai);
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