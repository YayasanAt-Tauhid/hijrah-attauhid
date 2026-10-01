-- Tolak perubahan definisi RPC sejak audit; jangan timpa pekerjaan sesi lain.
DO $preflight$
DECLARE v_row record;
BEGIN
  FOR v_row IN SELECT * FROM (VALUES
    ('public.akui_pendapatan_dimuka_jatuh_tempo(date,uuid,integer)', 'b9f289a0fefa9f4f97a3d50a83606172'),
    ('public.generate_tagihan_batch(uuid,uuid,integer,uuid,jsonb,uuid)', 'f1601add2906eb36d0ca41d878ad75ea'),
    ('public.posting_piutang_jatuh_tempo(date,uuid,integer)', 'df33fce0dced33500e00ce2474cb6b81'),
    ('public.proses_pembayaran_atomik(uuid,uuid,integer,numeric,date,text,uuid,uuid,boolean,uuid,uuid,uuid,text,text,uuid,text)', 'afeb08368b19129428742d8cdc37a96c'),
    ('public.proses_pembayaran_midtrans_atomik(uuid,uuid,uuid,integer,numeric,date,uuid,uuid,text,text,uuid,uuid,text)', 'd32332e561f4618bef7386f2e8df4357'),
    ('public.simpan_tarif_dan_generate_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid)', '1ee6efdfcbfac88fdf930785cb6cc483')
  ) AS expected(signature, definition_md5)
  LOOP
    IF md5(pg_get_functiondef(v_row.signature::regprocedure)) <> v_row.definition_md5 THEN
      RAISE EXCEPTION 'Definisi RPC berubah sejak audit: %. Tinjau ulang migration sebelum menerapkan.', v_row.signature;
    END IF;
  END LOOP;
END;
$preflight$;

-- Uang pangkal: kas mengikuti tanggal bayar, akademik mengikuti tahun ajaran.
-- Hanya pengaturan jenis utama yang diperbarui; jurnal/tagihan lama tidak diubah.
ALTER TABLE public.tagihan
  ADD COLUMN IF NOT EXISTS tahun_akademik_id uuid REFERENCES public.tahun_ajaran(id);
-- Setiap baris pembayaran menunjuk satu jenis/periode, satu kewajiban.
CREATE UNIQUE INDEX IF NOT EXISTS pendapatan_dimuka_pembayaran_unique
  ON public.pendapatan_dimuka(pembayaran_id);

COMMENT ON COLUMN public.tagihan.tahun_akademik_id IS
  'Tahun ajaran akademik uang pangkal; tahun_ajaran_id tetap FK tahun_buku.';
CREATE INDEX IF NOT EXISTS tagihan_tahun_akademik_idx
  ON public.tagihan(tahun_akademik_id) WHERE tahun_akademik_id IS NOT NULL;

DO $config$
DECLARE v_akun uuid;
BEGIN
  SELECT id INTO STRICT v_akun FROM public.akun_rekening
  WHERE kode = '2106' AND jenis = 'liabilitas' AND saldo_normal = 'K' AND aktif;
  UPDATE public.jenis_pembayaran
  SET perlu_dimuka = true, akun_dimuka_id = v_akun
  WHERE nama IN ('UANG PANGKAL TK', 'UANG PANGKAL SD', 'UANG PANGKAL SMP',
                 'UANG PANGKAL SMA', 'UANG PANGKAL MTA');
END;
$config$;

CREATE OR REPLACE FUNCTION public.generate_tagihan_batch(p_jenis_id uuid, p_tahun_ajaran_id uuid, p_bulan integer, p_departemen_id uuid, p_siswa_list jsonb, p_created_by uuid)
 RETURNS TABLE(generated integer, skipped integer, scheduled integer, errors text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jenis record;
  v_piutang_akun_id uuid;
  v_potongan_akun_id uuid;
  v_potongan_global_id uuid;
  v_tahun_sekarang integer := extract(year from now() AT TIME ZONE 'Asia/Jakarta');
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row record;
  v_bruto numeric;
  v_diskon numeric;
  v_netto numeric;
  v_siswa_diskon_id uuid;
  v_jurnal_id uuid;
  v_nomor text;
  v_generated integer := 0;
  v_skipped integer := 0;
  v_scheduled integer := 0;
  v_errors text[] := '{}';
  v_bulan_label text;
  v_dept_id uuid;
  v_angkatan_id uuid;
  v_tahun_masuk integer;
  v_jatuh_tempo date;
  v_belum_jatuh_tempo boolean;
  v_status text;
  v_urutan integer;
  v_nama_siswa text;
  v_akademik_id uuid;
  v_akademik_mulai date;
  v_akademik_count integer;
  v_is_pangkal boolean;
BEGIN
  SELECT id, nama, tipe, departemen_id, nominal, akun_pendapatan_id, tahun_masuk_dari, tahun_masuk_sampai,
         hari_jatuh_tempo, akun_potongan_id
  INTO v_jenis
  FROM jenis_pembayaran WHERE id = p_jenis_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jenis pembayaran tidak ditemukan';
  END IF;

  IF v_jenis.akun_pendapatan_id IS NULL THEN
    RAISE EXCEPTION 'Akun pendapatan belum diset untuk jenis "%"', v_jenis.nama;
  END IF;

  SELECT akun_id INTO v_piutang_akun_id
  FROM pengaturan_akun WHERE kode_setting = 'piutang_siswa';

  IF v_piutang_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun piutang siswa belum dikonfigurasi di Pengaturan Akun';
  END IF;

  SELECT akun_id INTO v_potongan_global_id
  FROM pengaturan_akun WHERE kode_setting = 'AKUN_POTONGAN_PENDAPATAN';

  v_potongan_akun_id := COALESCE(v_jenis.akun_potongan_id, v_potongan_global_id);

  v_is_pangkal := upper(btrim(v_jenis.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$';

  v_bulan_label := CASE WHEN p_bulan IS NOT NULL THEN '-B' || p_bulan ELSE '' END;

  -- Jatuh tempo hanya bergantung pada periode + bulan + jenis, jadi cukup
  -- dihitung sekali untuk seluruh batch (satu panggilan = satu bulan).
  v_jatuh_tempo := hitung_jatuh_tempo_tagihan(
    p_tahun_ajaran_id, p_bulan, v_jenis.hari_jatuh_tempo
  );
  -- Periode tanpa tanggal_mulai -> jatuh tempo tak bisa dihitung. Jangan
  -- diperlakukan sebagai "belum jatuh tempo" (tagihan bisa menggantung selamanya
  -- tanpa pernah jadi piutang); pakai perilaku lama = langsung diakui.
  v_belum_jatuh_tempo := v_jatuh_tempo IS NOT NULL AND v_jatuh_tempo > v_tanggal;
  v_status := CASE WHEN v_belum_jatuh_tempo THEN 'terjadwal' ELSE 'belum_bayar' END;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_siswa_list) AS x(siswa_id uuid, kelas_id uuid, tahun_akademik_id uuid)
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM tagihan
        WHERE siswa_id = v_row.siswa_id
          AND jenis_id = p_jenis_id
          AND tahun_ajaran_id = p_tahun_ajaran_id
          AND (bulan IS NOT DISTINCT FROM p_bulan)
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_akademik_id := NULL;
      IF v_is_pangkal THEN
        IF p_bulan IS NOT NULL THEN
          RAISE EXCEPTION 'Uang pangkal harus menggunakan tagihan sekali bayar';
        END IF;
        v_akademik_id := v_row.tahun_akademik_id;
        IF v_akademik_id IS NULL THEN
          -- Kompatibilitas caller lama: hanya pilih bila tepat satu TA
          -- dimulai dalam Tahun Buku target, tidak memakai TA aktif.
          SELECT count(*), (array_agg(ta.id))[1]
          INTO v_akademik_count, v_akademik_id
          FROM public.tahun_ajaran ta JOIN public.tahun_buku tb
            ON ta.tanggal_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
          WHERE tb.id = p_tahun_ajaran_id;
          IF v_akademik_count <> 1 THEN
            RAISE EXCEPTION 'Pilih tahun ajaran akademik uang pangkal secara eksplisit';
          END IF;
        END IF;
        SELECT ta.tanggal_mulai INTO v_akademik_mulai
        FROM public.tahun_ajaran ta JOIN public.tahun_buku tb
          ON ta.tanggal_mulai BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
        WHERE ta.id = v_akademik_id AND tb.id = p_tahun_ajaran_id;
        IF v_akademik_mulai IS NULL THEN
          RAISE EXCEPTION 'Tahun Buku uang pangkal harus memuat awal tahun ajaran target';
        END IF;
        v_jatuh_tempo := v_akademik_mulai;
      ELSE
        v_jatuh_tempo := hitung_jatuh_tempo_tagihan(
          p_tahun_ajaran_id, p_bulan, v_jenis.hari_jatuh_tempo
        );
      END IF;
      v_belum_jatuh_tempo := v_jatuh_tempo IS NOT NULL AND v_jatuh_tempo > v_tanggal;
      v_status := CASE WHEN v_belum_jatuh_tempo THEN 'terjadwal' ELSE 'belum_bayar' END;

      -- Dipakai untuk tier "angkatan" di get_tarif_siswa (override nominal
      -- per angkatan di tarif_tagihan) -- fix bug lama yang selalu kirim NULL.
      SELECT angkatan_id, nama INTO v_angkatan_id, v_nama_siswa FROM siswa WHERE id = v_row.siswa_id;

      -- Scoping tahun masuk: kalau jenis ini punya batas tahun_masuk_dari
      -- dan/atau tahun_masuk_sampai, siswa yang tahun masuknya di luar
      -- rentang (atau tidak bisa ditentukan sama sekali) di-skip.
      IF v_jenis.tahun_masuk_dari IS NOT NULL OR v_jenis.tahun_masuk_sampai IS NOT NULL THEN
        v_tahun_masuk := get_siswa_tahun_masuk(v_row.siswa_id);
        IF v_tahun_masuk IS NULL
           OR (v_jenis.tahun_masuk_dari IS NOT NULL AND v_tahun_masuk < v_jenis.tahun_masuk_dari)
           OR (v_jenis.tahun_masuk_sampai IS NOT NULL AND v_tahun_masuk > v_jenis.tahun_masuk_sampai)
        THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      END IF;

      -- SPP wajib memakai tarif efektif yang sudah ditetapkan. Master SPP
      -- tidak boleh menjadi sumber nominal agar perbedaan tarif antar siswa
      -- tidak menimbulkan tagihan salah atau "default" yang tak disengaja.
      IF v_jenis.tipe = 'bulanan'
         AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)'
      THEN
        v_bruto := get_tarif_siswa(
          p_jenis_id, v_row.siswa_id, v_row.kelas_id,
          p_tahun_ajaran_id, v_angkatan_id
        );

        IF v_bruto IS NULL OR v_bruto <= 0 THEN
          v_errors := v_errors || (
            'Tarif SPP belum dikonfigurasi untuk ' ||
            COALESCE(v_nama_siswa, v_row.siswa_id::text) ||
            '. Tetapkan tarif siswa/kelas/angkatan terlebih dahulu.'
          );
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      ELSE
        v_bruto := COALESCE(
          get_tarif_siswa(
            p_jenis_id, v_row.siswa_id, v_row.kelas_id,
            p_tahun_ajaran_id, v_angkatan_id
          ),
          v_jenis.nominal,
          0
        );

        IF v_bruto <= 0 THEN
          CONTINUE;
        END IF;
      END IF;

      -- Potongan/keringanan yang berlaku untuk siswa+jenis+bulan ini.
      SELECT d.nominal_diskon, d.siswa_diskon_id
      INTO v_diskon, v_siswa_diskon_id
      FROM hitung_diskon_tagihan(
        v_row.siswa_id, p_jenis_id, p_tahun_ajaran_id, p_bulan, v_bruto
      ) d;

      v_diskon := COALESCE(v_diskon, 0);
      v_netto  := v_bruto - v_diskon;

      IF v_diskon > 0 AND v_potongan_akun_id IS NULL THEN
        v_errors := v_errors ||
          ('Siswa ' || v_row.siswa_id || ': akun potongan/keringanan belum dikonfigurasi');
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Tentukan departemen per-siswa: parameter eksplisit > kelas siswa > data siswa
      v_dept_id := p_departemen_id;
      IF v_dept_id IS NULL AND v_row.kelas_id IS NOT NULL THEN
        SELECT departemen_id INTO v_dept_id FROM kelas WHERE id = v_row.kelas_id;
      END IF;
      IF v_dept_id IS NULL THEN
        SELECT departemen_id INTO v_dept_id FROM siswa WHERE id = v_row.siswa_id;
      END IF;

      -- Tagihan periode mendatang: jadwal saja, belum ada jurnal.
      IF v_belum_jatuh_tempo THEN
        v_jurnal_id := NULL;
      ELSE
        v_nomor := generate_nomor_jurnal('JPI', v_tahun_sekarang);

        -- Pendapatan diakui BRUTO; potongan berdiri sebagai kontra-pendapatan.
        INSERT INTO jurnal (nomor, tanggal, keterangan, departemen_id, total_debit, total_kredit, status)
        VALUES (
          v_nomor, v_tanggal,
          'Piutang ' || v_jenis.nama || v_bulan_label || ' - ' || COALESCE(v_nama_siswa, v_row.siswa_id::text),
          v_dept_id, v_bruto, v_bruto, 'posted'
        )
        RETURNING id INTO v_jurnal_id;

        v_urutan := 0;

        -- Beasiswa 100% -> netto 0: baris piutang nol tidak perlu dicatat.
        IF v_netto > 0 THEN
          v_urutan := v_urutan + 1;
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES (v_jurnal_id, v_piutang_akun_id, 'Piutang ' || v_jenis.nama, v_netto, 0, v_urutan);
        END IF;

        IF v_diskon > 0 THEN
          v_urutan := v_urutan + 1;
          INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
          VALUES (v_jurnal_id, v_potongan_akun_id, 'Keringanan ' || v_jenis.nama, v_diskon, 0, v_urutan);
        END IF;

        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_jenis.akun_pendapatan_id, 'Pendapatan ' || v_jenis.nama, 0, v_bruto, v_urutan);
      END IF;

      INSERT INTO tagihan (siswa_id, jenis_id, tahun_ajaran_id, kelas_id, bulan, nominal,
                           nominal_bruto, nominal_diskon, siswa_diskon_id,
                           status, jatuh_tempo, jurnal_piutang_id, created_by, tahun_akademik_id)
      VALUES (v_row.siswa_id, p_jenis_id, p_tahun_ajaran_id, v_row.kelas_id, p_bulan, v_netto,
              v_bruto, v_diskon, v_siswa_diskon_id,
              v_status, v_jatuh_tempo, v_jurnal_id, p_created_by, v_akademik_id)
      ON CONFLICT (siswa_id, jenis_id, tahun_ajaran_id, (COALESCE(bulan, 0))) DO NOTHING;

      IF FOUND THEN
        v_generated := v_generated + 1;
        IF v_belum_jatuh_tempo THEN
          v_scheduled := v_scheduled + 1;
        END IF;
      ELSE
        -- Baris tagihan kalah balapan dengan proses lain: buang jurnal yang
        -- terlanjur dibuat (kalau memang ada) supaya tidak jadi jurnal yatim.
        IF v_jurnal_id IS NOT NULL THEN
          DELETE FROM jurnal_detail WHERE jurnal_id = v_jurnal_id;
          DELETE FROM jurnal WHERE id = v_jurnal_id;
        END IF;
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || (('Siswa ' || v_row.siswa_id || ': ' || SQLERRM));
    END;
  END LOOP;

  RETURN QUERY SELECT v_generated, v_skipped, v_scheduled, v_errors;
END;
$function$;

-- Pertahankan definisi live wrapper (termasuk auth/validasi terbaru),
-- lalu teruskan konteks akademik yang sudah dipilih ke setiap siswa batch.
DO $wrapper$
DECLARE v_sql text; v_old text := '        v_siswa_list,
        v_uid';
BEGIN
  SELECT pg_get_functiondef('public.simpan_tarif_dan_generate_atomik(jsonb,uuid,uuid,jsonb,uuid,uuid[],uuid,uuid,uuid)'::regprocedure)
  INTO v_sql;
  IF strpos(v_sql, v_old) = 0 THEN
    RAISE EXCEPTION 'Definisi simpan_tarif_dan_generate_atomik berubah; tinjau migration';
  END IF;
  v_sql := replace(v_sql, v_old,
    '        (SELECT jsonb_agg(x || jsonb_build_object(''tahun_akademik_id'', p_tahun_akademik_id))
         FROM jsonb_array_elements(v_siswa_list) x),
        v_uid');
  EXECUTE v_sql;
END;
$wrapper$;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_atomik(p_siswa_id uuid, p_jenis_id uuid, p_bulan integer, p_jumlah numeric, p_tanggal_bayar date, p_keterangan text, p_departemen_id uuid, p_tahun_ajaran_id uuid, p_is_bayar_dimuka boolean, p_tagihan_id uuid, p_kas_akun_id uuid, p_kredit_akun_id uuid, p_kredit_label text, p_prefix_jurnal text, p_petugas_id uuid, p_jenis_nama text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pembayaran_id       uuid;
  v_jurnal_id           uuid;
  v_nomor_jurnal        text;
  v_tahun               int := EXTRACT(YEAR FROM p_tanggal_bayar)::int;
  v_pegawai_id          uuid;
  v_periode_bayar       uuid;
  v_tahun_target        uuid;
  v_departemen_efektif  uuid := p_departemen_id;
  v_departemen_asal     uuid;
  v_tagihan             public.tagihan;
  v_total_sebelum       numeric := 0;
  v_total_sesudah       numeric := 0;
  v_sisa_sesudah        numeric := 0;
  v_status_sesudah      text;
BEGIN
  IF p_jumlah IS NULL OR p_jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
  END IF;

  IF p_tagihan_id IS NULL AND EXISTS (
    SELECT 1 FROM public.jenis_pembayaran jp WHERE jp.id = p_jenis_id
      AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$'
  ) THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan uang pangkal dengan tahun ajaran target terlebih dahulu';
  END IF;

  SELECT pegawai_id INTO v_pegawai_id
  FROM public.users_profile
  WHERE id = p_petugas_id;

  IF v_pegawai_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pegawai WHERE id = v_pegawai_id) THEN
    v_pegawai_id := NULL;
  END IF;

  IF p_tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan
    FROM public.tagihan
    WHERE id = p_tagihan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tagihan tidak ditemukan';
    END IF;

    IF v_tagihan.siswa_id <> p_siswa_id
       OR v_tagihan.jenis_id <> p_jenis_id
       OR v_tagihan.bulan IS DISTINCT FROM p_bulan THEN
      RAISE EXCEPTION 'Tagihan tidak sesuai dengan siswa, jenis, atau periode pembayaran';
    END IF;

    IF v_tagihan.status NOT IN ('belum_bayar', 'sebagian', 'terjadwal') THEN
      RAISE EXCEPTION 'Tagihan sudah lunas atau tidak dapat dibayar';
    END IF;

    SELECT COALESCE(SUM(jumlah), 0)
    INTO v_total_sebelum
    FROM public.pembayaran
    WHERE tagihan_id = p_tagihan_id;

    IF v_total_sebelum >= v_tagihan.nominal THEN
      RAISE EXCEPTION 'Tagihan sudah lunas';
    END IF;

    IF p_jumlah > (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Jumlah pembayaran melebihi sisa tagihan';
    END IF;

    -- Partial advance payment is intentionally not enabled yet because the
    -- scheduled-bill recognition flow currently expects either unpaid or fully
    -- paid before maturity.
    IF v_tagihan.status = 'terjadwal'
       AND p_jumlah < (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Tagihan yang belum jatuh tempo harus dibayar penuh';
    END IF;

    SELECT j.departemen_id
    INTO v_departemen_asal
    FROM public.jurnal j
    WHERE j.id = v_tagihan.jurnal_piutang_id;

    IF v_departemen_asal IS NOT NULL THEN
      v_departemen_efektif := v_departemen_asal;
    END IF;
  END IF;

  INSERT INTO public.pembayaran (
    siswa_id, jenis_id, tahun_ajaran_id, bulan,
    jumlah, tanggal_bayar, petugas_id, keterangan, tagihan_id
  )
  VALUES (
    p_siswa_id, p_jenis_id, p_tahun_ajaran_id, p_bulan,
    p_jumlah, p_tanggal_bayar, v_pegawai_id, p_keterangan, p_tagihan_id
  )
  RETURNING id INTO v_pembayaran_id;

  v_nomor_jurnal := public.generate_nomor_jurnal(p_prefix_jurnal, v_tahun);

  INSERT INTO public.jurnal (
    nomor, tanggal, keterangan, referensi,
    total_debit, total_kredit, status,
    dibuat_oleh, departemen_id
  )
  VALUES (
    v_nomor_jurnal,
    p_tanggal_bayar,
    p_keterangan,
    v_pembayaran_id::text,
    p_jumlah,
    p_jumlah,
    'posted',
    v_pegawai_id,
    v_departemen_efektif
  )
  RETURNING id INTO v_jurnal_id;

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, p_kas_akun_id, 'Penerimaan ' || p_jenis_nama, p_jumlah, 0, 1);

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, p_kredit_akun_id, p_kredit_label, 0, p_jumlah, 2);

  UPDATE public.pembayaran
  SET jurnal_id = v_jurnal_id
  WHERE id = v_pembayaran_id;

  IF p_tagihan_id IS NOT NULL THEN
    v_total_sesudah := v_total_sebelum + p_jumlah;
    v_sisa_sesudah := GREATEST(v_tagihan.nominal - v_total_sesudah, 0);
    v_status_sesudah := CASE
      WHEN v_sisa_sesudah <= 0 THEN 'lunas'
      ELSE 'sebagian'
    END;

    UPDATE public.tagihan
    SET status = v_status_sesudah,
        pembayaran_id = v_pembayaran_id
    WHERE id = p_tagihan_id;
  ELSE
    UPDATE public.tagihan
    SET status = 'lunas', pembayaran_id = v_pembayaran_id
    WHERE siswa_id        = p_siswa_id
      AND jenis_id        = p_jenis_id
      AND tahun_ajaran_id = p_tahun_ajaran_id
      AND (
        (p_bulan IS NULL AND bulan IS NULL) OR
        (bulan = p_bulan)
      )
      AND status IN ('belum_bayar', 'terjadwal');
  END IF;

  SELECT tahun_ajaran_id INTO v_tahun_target
  FROM public.tagihan
  WHERE id = p_tagihan_id;

  IF p_is_bayar_dimuka THEN
    SELECT id INTO v_periode_bayar
    FROM public.tahun_buku
    WHERE p_tanggal_bayar >= tanggal_mulai
      AND p_tanggal_bayar <= tanggal_selesai
    ORDER BY tanggal_mulai DESC
    LIMIT 1;

    INSERT INTO public.pendapatan_dimuka (
      pembayaran_id, siswa_id, jenis_id,
      tahun_ajaran_pembayaran_id, tahun_ajaran_target_id,
      bulan, jumlah, status, departemen_id
    )
    VALUES (
      v_pembayaran_id, p_siswa_id, p_jenis_id,
      COALESCE(v_periode_bayar, p_tahun_ajaran_id),
      COALESCE(v_tahun_target, p_tahun_ajaran_id),
      p_bulan, p_jumlah, 'pending', v_departemen_efektif
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'pembayaran_id', v_pembayaran_id,
    'jurnal_id',     v_jurnal_id,
    'nomor_jurnal',  v_nomor_jurnal,
    'status_tagihan', COALESCE(v_status_sesudah, 'lunas'),
    'sisa_tagihan', COALESCE(v_sisa_sesudah, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_midtrans_atomik(p_transaksi_item_id uuid, p_siswa_id uuid, p_jenis_id uuid, p_bulan integer, p_jumlah numeric, p_tanggal_bayar date, p_departemen_id uuid, p_tahun_ajaran_id uuid, p_order_id text, p_payment_type text, p_kas_akun_id uuid, p_kredit_akun_id uuid, p_jenis_nama text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pembayaran_id   uuid;
  v_jurnal_id       uuid;
  v_nomor_jurnal    text;
  v_tahun           int := EXTRACT(YEAR FROM p_tanggal_bayar)::int;
  v_bulan_norm      int := NULLIF(p_bulan, 0);
  v_keterangan      text;
  v_tagihan         public.tagihan;
  v_tagihan_id      uuid;
  v_dimuka          boolean := false;
  v_perlu_dimuka    boolean := true;
  v_kredit_akun_id  uuid := p_kredit_akun_id;
  v_kredit_label    text;
  v_piutang_akun_id uuid;
  v_periode_bayar   uuid;
  v_nama_siswa      text;
  v_identitas       text;
  v_total_sebelum   numeric := 0;
  v_total_sesudah   numeric := 0;
  v_sisa_sesudah    numeric := 0;
  v_status_sesudah  text;
BEGIN
  IF p_kas_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun Bank Midtrans belum dikonfigurasi di Pengaturan Akun';
  END IF;
  IF p_kredit_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun Pendapatan untuk jenis "%" belum dikonfigurasi', p_jenis_nama;
  END IF;
  IF p_jumlah IS NULL OR p_jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
  END IF;

  SELECT tagihan_id INTO v_tagihan_id
  FROM public.transaksi_midtrans_item
  WHERE id = p_transaksi_item_id;

  SELECT nama INTO v_nama_siswa FROM public.siswa WHERE id = p_siswa_id;

  SELECT COALESCE(perlu_dimuka, true)
  INTO v_perlu_dimuka
  FROM public.jenis_pembayaran
  WHERE id = p_jenis_id;

  v_identitas := p_jenis_nama
    || CASE WHEN v_bulan_norm IS NOT NULL THEN '-B' || v_bulan_norm ELSE '' END
    || ' - ' || COALESCE(v_nama_siswa, p_siswa_id::text);

  IF v_tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan
    FROM public.tagihan
    WHERE id = v_tagihan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tagihan transaksi online tidak ditemukan';
    END IF;

    IF v_tagihan.siswa_id <> p_siswa_id
       OR v_tagihan.jenis_id <> p_jenis_id
       OR v_tagihan.bulan IS DISTINCT FROM v_bulan_norm THEN
      RAISE EXCEPTION 'Tagihan transaksi online tidak sesuai';
    END IF;

    IF v_tagihan.status NOT IN ('belum_bayar', 'sebagian', 'terjadwal') THEN
      RAISE EXCEPTION 'Tagihan transaksi online sudah lunas atau tidak dapat dibayar';
    END IF;

    SELECT COALESCE(SUM(jumlah), 0)
    INTO v_total_sebelum
    FROM public.pembayaran
    WHERE tagihan_id = v_tagihan_id;

    IF p_jumlah > (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Jumlah transaksi online melebihi sisa tagihan';
    END IF;

    IF v_tagihan.status = 'terjadwal'
       AND p_jumlah < (v_tagihan.nominal - v_total_sebelum) THEN
      RAISE EXCEPTION 'Tagihan yang belum jatuh tempo harus dibayar penuh';
    END IF;
  ELSE
    SELECT t.* INTO v_tagihan
    FROM public.tagihan t
    WHERE t.siswa_id        = p_siswa_id
      AND t.jenis_id        = p_jenis_id
      AND t.tahun_ajaran_id = p_tahun_ajaran_id
      AND (
        (v_bulan_norm IS NULL AND t.bulan IS NULL) OR
        (t.bulan = v_bulan_norm)
      )
      AND t.status IN ('belum_bayar', 'sebagian', 'terjadwal')
    LIMIT 1;

    IF FOUND THEN
      v_tagihan_id := v_tagihan.id;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.jenis_pembayaran jp WHERE jp.id = p_jenis_id
             AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$')
     AND v_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan uang pangkal dengan tahun ajaran target terlebih dahulu';
  END IF;

  IF v_bulan_norm IS NOT NULL THEN
    PERFORM 1 FROM public.pembayaran
    WHERE siswa_id = p_siswa_id
      AND jenis_id = p_jenis_id
      AND bulan = v_bulan_norm
      AND tagihan_id IS DISTINCT FROM v_tagihan_id;
    IF FOUND THEN
      RAISE EXCEPTION 'Pembayaran bulan % untuk jenis ini sudah ada', v_bulan_norm;
    END IF;
  END IF;

  v_dimuka := COALESCE(v_perlu_dimuka, true)
              AND COALESCE(v_tagihan.status = 'terjadwal', false);

  IF v_dimuka THEN
    SELECT COALESCE(
             (SELECT akun_dimuka_id FROM public.jenis_pembayaran WHERE id = p_jenis_id),
             (SELECT akun_id FROM public.pengaturan_akun WHERE kode_setting = 'AKUN_PENDAPATAN_DIMUKA')
           )
    INTO v_kredit_akun_id;

    IF v_kredit_akun_id IS NULL THEN
      RAISE EXCEPTION 'Akun Pendapatan Diterima di Muka belum dikonfigurasi (pembayaran sebelum jatuh tempo untuk jenis "%")', p_jenis_nama;
    END IF;

    v_keterangan := 'Pembayaran Diterima di Muka ' || v_identitas
      || ' [Online - ' || p_order_id || ' via ' || COALESCE(p_payment_type, '-') || ']';
    v_kredit_label := 'Pendapatan Diterima di Muka - ' || v_identitas;
  ELSE
    SELECT akun_id INTO v_piutang_akun_id
    FROM public.pengaturan_akun WHERE kode_setting = 'piutang_siswa';

    IF v_tagihan.id IS NOT NULL
       AND v_tagihan.status IN ('belum_bayar', 'sebagian')
       AND v_piutang_akun_id IS NOT NULL THEN
      v_kredit_akun_id := v_piutang_akun_id;
      v_keterangan := 'Pembayaran Piutang ' || v_identitas
        || ' [Online - ' || p_order_id || ' via ' || COALESCE(p_payment_type, '-') || ']';
      v_kredit_label := 'Piutang Siswa - ' || v_identitas;
    ELSE
      v_keterangan := 'Pembayaran ' || v_identitas
        || ' [Online - ' || p_order_id || ' via ' || COALESCE(p_payment_type, '-') || ']';
      v_kredit_label := 'Pendapatan - ' || v_identitas;
    END IF;
  END IF;

  SELECT id INTO v_periode_bayar
  FROM public.tahun_buku
  WHERE p_tanggal_bayar >= tanggal_mulai
    AND p_tanggal_bayar <= tanggal_selesai
  ORDER BY tanggal_mulai DESC
  LIMIT 1;

  INSERT INTO public.pembayaran (
    siswa_id, jenis_id, tahun_ajaran_id, bulan,
    jumlah, tanggal_bayar, departemen_id, keterangan, tagihan_id
  )
  VALUES (
    p_siswa_id, p_jenis_id, COALESCE(v_periode_bayar, p_tahun_ajaran_id), v_bulan_norm,
    p_jumlah, p_tanggal_bayar, p_departemen_id, v_keterangan, v_tagihan_id
  )
  RETURNING id INTO v_pembayaran_id;

  v_nomor_jurnal := public.generate_nomor_jurnal(CASE WHEN v_dimuka THEN 'JD' ELSE 'JP' END, v_tahun);

  INSERT INTO public.jurnal (
    nomor, tanggal, keterangan, referensi,
    total_debit, total_kredit, status, departemen_id
  )
  VALUES (
    v_nomor_jurnal,
    p_tanggal_bayar,
    v_keterangan,
    p_order_id,
    p_jumlah,
    p_jumlah,
    'posted',
    p_departemen_id
  )
  RETURNING id INTO v_jurnal_id;

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, p_kas_akun_id, v_keterangan, p_jumlah, 0, 1);

  INSERT INTO public.jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal_id, v_kredit_akun_id, v_kredit_label, 0, p_jumlah, 2);

  UPDATE public.pembayaran
  SET jurnal_id = v_jurnal_id
  WHERE id = v_pembayaran_id;

  IF v_tagihan_id IS NOT NULL THEN
    v_total_sesudah := v_total_sebelum + p_jumlah;
    v_sisa_sesudah := GREATEST(v_tagihan.nominal - v_total_sesudah, 0);
    v_status_sesudah := CASE
      WHEN v_sisa_sesudah <= 0 THEN 'lunas'
      ELSE 'sebagian'
    END;

    UPDATE public.tagihan
    SET status = v_status_sesudah,
        pembayaran_id = v_pembayaran_id
    WHERE id = v_tagihan_id;
  END IF;

  IF v_dimuka THEN
    INSERT INTO public.pendapatan_dimuka (
      pembayaran_id, siswa_id, jenis_id,
      tahun_ajaran_pembayaran_id, tahun_ajaran_target_id,
      bulan, jumlah, status, departemen_id
    )
    VALUES (
      v_pembayaran_id, p_siswa_id, p_jenis_id,
      COALESCE(v_periode_bayar, p_tahun_ajaran_id), v_tagihan.tahun_ajaran_id,
      v_bulan_norm, p_jumlah, 'pending', p_departemen_id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.transaksi_midtrans_item
  SET pembayaran_id = v_pembayaran_id
  WHERE id = p_transaksi_item_id;

  RETURN jsonb_build_object(
    'pembayaran_id',   v_pembayaran_id,
    'jurnal_id',       v_jurnal_id,
    'nomor_jurnal',    v_nomor_jurnal,
    'diterima_dimuka', v_dimuka,
    'status_tagihan',  v_status_sesudah,
    'sisa_tagihan',    v_sisa_sesudah
  );
END;
$function$;

-- Pengakuan satu pembayaran atomik, idempoten, dan tidak bisa mendahului jatuh tempo.
-- INVOKER: hanya service_role yang boleh memanggil langsung; cron lama memanggil
-- sebagai pemilik melalui fungsi batch yang sudah SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.akui_pendapatan_dimuka_atomik(
  p_dimuka_id uuid, p_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_pd public.pendapatan_dimuka;
  v_p public.pembayaran;
  v_t public.tagihan;
  v_jenis public.jenis_pembayaran;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_due date;
  v_payment_id uuid;
  v_liability uuid;
  v_liability_count integer;
  v_potongan uuid;
  v_discount numeric := 0;
  v_gross numeric;
  v_jurnal uuid;
  v_nomor text;
  v_pegawai uuid;
BEGIN
  -- Urutan lock sama dengan pembatalan: pembayaran dahulu, lalu pendapatan.
  SELECT pembayaran_id INTO v_payment_id FROM public.pendapatan_dimuka WHERE id = p_dimuka_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendapatan diterima di muka tidak ditemukan'; END IF;
  SELECT * INTO v_p FROM public.pembayaran WHERE id = v_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran sudah dibatalkan'; END IF;
  SELECT * INTO v_pd FROM public.pendapatan_dimuka WHERE id = p_dimuka_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendapatan diterima di muka sudah dibatalkan'; END IF;
  IF v_pd.status = 'diakui' AND v_pd.jurnal_pengakuan_id IS NOT NULL THEN
    RETURN jsonb_build_object('diakui', false, 'jurnal_id', v_pd.jurnal_pengakuan_id);
  END IF;
  IF v_pd.status <> 'pending' OR v_pd.jurnal_pengakuan_id IS NOT NULL THEN
    RAISE EXCEPTION 'Status pendapatan diterima di muka tidak dapat diakui';
  END IF;
  SELECT * INTO STRICT v_jenis FROM public.jenis_pembayaran WHERE id = v_pd.jenis_id;
  IF v_p.tagihan_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.tagihan WHERE id = v_p.tagihan_id;
  END IF;
  v_due := COALESCE(v_t.jatuh_tempo,
    public.hitung_jatuh_tempo_tagihan(v_pd.tahun_ajaran_target_id, v_pd.bulan, v_jenis.hari_jatuh_tempo));
  IF v_due IS NULL OR v_due > v_today THEN
    RAISE EXCEPTION 'Pendapatan belum dapat diakui sebelum %', COALESCE(v_due::text, 'tanggal pengakuan ditentukan');
  END IF;
  IF v_t.status = 'dibatalkan' THEN RAISE EXCEPTION 'Tagihan sudah dibatalkan'; END IF;
  IF v_jenis.akun_pendapatan_id IS NULL THEN RAISE EXCEPTION 'Akun pendapatan belum dikonfigurasi'; END IF;

  -- Gunakan akun kewajiban di jurnal penerimaan, bukan konfigurasi yang mungkin berubah.
  SELECT count(*), (array_agg(jd.akun_id))[1] INTO v_liability_count, v_liability
  FROM public.jurnal_detail jd
  JOIN public.akun_rekening a ON a.id = jd.akun_id
  JOIN public.jurnal j ON j.id = jd.jurnal_id
  WHERE jd.jurnal_id = v_p.jurnal_id AND j.status = 'posted'
    AND jd.kredit = v_pd.jumlah AND jd.debit = 0 AND a.jenis = 'liabilitas';
  IF v_liability_count <> 1 THEN
    RAISE EXCEPTION 'Jurnal penerimaan tidak memiliki akun kewajiban yang sesuai';
  END IF;

  -- Tagihan terjadwal yang dibayar penuh belum memiliki JPI.
  -- Catat potongan sebagai kontra-pendapatan saat pengakuan, satu kali.
  IF v_t.id IS NOT NULL AND v_t.jurnal_piutang_id IS NULL AND COALESCE(v_t.nominal_diskon, 0) > 0 THEN
    IF v_t.status <> 'lunas' OR v_pd.jumlah <> v_t.nominal OR
       (SELECT count(*) FROM public.pendapatan_dimuka pd
        JOIN public.pembayaran p ON p.id = pd.pembayaran_id WHERE p.tagihan_id = v_t.id) <> 1 THEN
      RAISE EXCEPTION 'Pengakuan tagihan diskon memerlukan pembayaran penuh tunggal';
    END IF;
    v_discount := v_t.nominal_diskon;
    SELECT COALESCE(v_jenis.akun_potongan_id, pa.akun_id) INTO v_potongan
      FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting = 'AKUN_POTONGAN_PENDAPATAN';
    IF v_potongan IS NULL THEN RAISE EXCEPTION 'Akun potongan pendapatan belum dikonfigurasi'; END IF;
  END IF;
  v_gross := v_pd.jumlah + v_discount;
  IF p_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_pegawai FROM public.users_profile WHERE id = p_user_id;
  END IF;
  v_nomor := public.generate_nomor_jurnal('PD', extract(year FROM v_today)::integer);
  INSERT INTO public.jurnal(nomor, tanggal, keterangan, referensi, departemen_id,
    total_debit, total_kredit, status, dibuat_oleh)
  VALUES (v_nomor, v_today, 'Pengakuan pendapatan ' || v_jenis.nama,
    v_pd.pembayaran_id::text, v_pd.departemen_id, v_gross, v_gross, 'posted', v_pegawai)
  RETURNING id INTO v_jurnal;
  INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal, v_liability, 'Pengakuan Pendapatan Diterima di Muka', v_pd.jumlah, 0, 1);
  IF v_discount > 0 THEN
    INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
    VALUES (v_jurnal, v_potongan, 'Potongan ' || v_jenis.nama, v_discount, 0, 2);
  END IF;
  INSERT INTO public.jurnal_detail(jurnal_id, akun_id, keterangan, debit, kredit, urutan)
  VALUES (v_jurnal, v_jenis.akun_pendapatan_id, 'Pendapatan ' || v_jenis.nama, 0, v_gross, 3);
  UPDATE public.pendapatan_dimuka SET status = 'diakui', jurnal_pengakuan_id = v_jurnal,
    tanggal_pengakuan = v_today WHERE id = v_pd.id;
  RETURN jsonb_build_object('diakui', true, 'jurnal_id', v_jurnal, 'jumlah', v_pd.jumlah);
END;
$function$;
REVOKE ALL ON FUNCTION public.akui_pendapatan_dimuka_atomik(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akui_pendapatan_dimuka_atomik(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.akui_pendapatan_dimuka_jatuh_tempo(
  p_sampai_tanggal date DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 5000
) RETURNS TABLE(diakui integer, total_nominal numeric, errors text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_batas date := LEAST(COALESCE(p_sampai_tanggal, v_today), v_today);
  v_row record;
  v_result jsonb;
  v_count integer := 0;
  v_total numeric := 0;
  v_errors text[] := '{}';
BEGIN
  FOR v_row IN
    SELECT pd.id FROM public.pendapatan_dimuka pd
    JOIN public.pembayaran p ON p.id = pd.pembayaran_id
    JOIN public.jenis_pembayaran jp ON jp.id = pd.jenis_id
    LEFT JOIN public.tagihan t ON t.id = p.tagihan_id
    WHERE pd.status = 'pending' AND pd.jurnal_pengakuan_id IS NULL
      AND COALESCE(t.jatuh_tempo,
        public.hitung_jatuh_tempo_tagihan(pd.tahun_ajaran_target_id, pd.bulan, jp.hari_jatuh_tempo)) <= v_batas
    ORDER BY pd.created_at, pd.id LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      v_result := public.akui_pendapatan_dimuka_atomik(v_row.id, p_user_id);
      IF (v_result->>'diakui')::boolean THEN
        v_count := v_count + 1;
        v_total := v_total + (v_result->>'jumlah')::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || ('Pendapatan dimuka ' || v_row.id || ': ' || SQLERRM);
    END;
  END LOOP;
  RETURN QUERY SELECT v_count, v_total, v_errors;
END;
$function$;
REVOKE ALL ON FUNCTION public.akui_pendapatan_dimuka_jatuh_tempo(date, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akui_pendapatan_dimuka_jatuh_tempo(date, uuid, integer) TO service_role;

-- Cutoff masa depan tidak boleh membukukan piutang/pendapatan tagihan lebih awal.
CREATE OR REPLACE FUNCTION public.posting_piutang_jatuh_tempo(p_sampai_tanggal date DEFAULT NULL::date, p_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000)
 RETURNS TABLE(diposting integer, total_nominal numeric, errors text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batas date := LEAST(COALESCE(p_sampai_tanggal, (now() AT TIME ZONE 'Asia/Jakarta')::date),
                       (now() AT TIME ZONE 'Asia/Jakarta')::date);
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_tahun integer := extract(year from (now() AT TIME ZONE 'Asia/Jakarta')::date)::integer;
  v_piutang_akun_id uuid;
  v_potongan_global_id uuid;
  v_potongan_akun_id uuid;
  v_pegawai_id uuid;
  v_row record;
  v_jurnal_id uuid;
  v_nomor text;
  v_dept_id uuid;
  v_bruto numeric;
  v_diskon numeric;
  v_netto numeric;
  v_urutan integer;
  v_diposting integer := 0;
  v_total numeric := 0;
  v_errors text[] := '{}';
BEGIN
  SELECT akun_id INTO v_piutang_akun_id
  FROM pengaturan_akun WHERE kode_setting = 'piutang_siswa';

  IF v_piutang_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun piutang siswa belum dikonfigurasi di Pengaturan Akun';
  END IF;

  SELECT akun_id INTO v_potongan_global_id
  FROM pengaturan_akun WHERE kode_setting = 'AKUN_POTONGAN_PENDAPATAN';

  IF p_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_pegawai_id FROM users_profile WHERE id = p_user_id;
  END IF;

  FOR v_row IN
    SELECT t.id, t.siswa_id, t.kelas_id, t.nominal, t.nominal_bruto, t.nominal_diskon,
           t.bulan, t.jatuh_tempo,
           jp.nama AS jenis_nama, jp.akun_pendapatan_id, jp.akun_potongan_id
    FROM tagihan t
    JOIN jenis_pembayaran jp ON jp.id = t.jenis_id
    WHERE t.status = 'terjadwal'
      AND t.jurnal_piutang_id IS NULL
      AND t.jatuh_tempo IS NOT NULL
      AND t.jatuh_tempo <= v_batas
    ORDER BY t.jatuh_tempo, t.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      IF v_row.akun_pendapatan_id IS NULL THEN
        v_errors := v_errors ||
          ('Tagihan ' || v_row.id || ': akun pendapatan belum diset untuk jenis "' || v_row.jenis_nama || '"');
        CONTINUE;
      END IF;

      v_netto  := v_row.nominal;
      v_diskon := COALESCE(v_row.nominal_diskon, 0);
      v_bruto  := COALESCE(v_row.nominal_bruto, v_row.nominal + v_diskon);

      v_potongan_akun_id := COALESCE(v_row.akun_potongan_id, v_potongan_global_id);

      IF v_diskon > 0 AND v_potongan_akun_id IS NULL THEN
        v_errors := v_errors ||
          ('Tagihan ' || v_row.id || ': akun potongan/keringanan belum dikonfigurasi di Pengaturan Akun');
        CONTINUE;
      END IF;

      v_dept_id := NULL;
      IF v_row.kelas_id IS NOT NULL THEN
        SELECT departemen_id INTO v_dept_id FROM kelas WHERE id = v_row.kelas_id;
      END IF;
      IF v_dept_id IS NULL THEN
        SELECT departemen_id INTO v_dept_id FROM siswa WHERE id = v_row.siswa_id;
      END IF;

      v_nomor := generate_nomor_jurnal('JPI', v_tahun);

      INSERT INTO jurnal (nomor, tanggal, keterangan, referensi, departemen_id,
                          total_debit, total_kredit, status, dibuat_oleh)
      VALUES (
        v_nomor, v_tanggal,
        'Piutang ' || v_row.jenis_nama
          || CASE WHEN v_row.bulan IS NOT NULL THEN '-B' || v_row.bulan ELSE '' END
          || ' jatuh tempo ' || to_char(v_row.jatuh_tempo, 'YYYY-MM-DD')
          || ' - siswa ' || v_row.siswa_id,
        v_row.id::text, v_dept_id,
        v_bruto, v_bruto, 'posted', v_pegawai_id
      )
      RETURNING id INTO v_jurnal_id;

      v_urutan := 0;

      IF v_netto > 0 THEN
        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_piutang_akun_id, 'Piutang ' || v_row.jenis_nama, v_netto, 0, v_urutan);
      END IF;

      IF v_diskon > 0 THEN
        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_potongan_akun_id, 'Keringanan ' || v_row.jenis_nama, v_diskon, 0, v_urutan);
      END IF;

      v_urutan := v_urutan + 1;
      INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
      VALUES (v_jurnal_id, v_row.akun_pendapatan_id, 'Pendapatan ' || v_row.jenis_nama, 0, v_bruto, v_urutan);

      UPDATE tagihan
      SET status = 'belum_bayar', jurnal_piutang_id = v_jurnal_id
      WHERE id = v_row.id AND status = 'terjadwal' AND jurnal_piutang_id IS NULL;

      IF NOT FOUND THEN
        DELETE FROM jurnal_detail WHERE jurnal_id = v_jurnal_id;
        DELETE FROM jurnal WHERE id = v_jurnal_id;
        CONTINUE;
      END IF;

      v_diposting := v_diposting + 1;
      v_total := v_total + v_netto;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || ('Tagihan ' || v_row.id || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN QUERY SELECT v_diposting, v_total, v_errors;
END;
$function$;
