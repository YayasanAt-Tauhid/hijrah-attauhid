-- Flexible installments for one-time bills (e.g. Uang Pangkal) and
-- explicit payment -> bill linkage.
--
-- Rules:
--   * one-time bills that are already due may be paid in any positive amount
--     up to the remaining balance, as many times as needed;
--   * future scheduled bills remain full-payment-only to preserve the existing
--     deferred-revenue / due-date accounting flow;
--   * monthly bills remain full-payment-only;
--   * every payment is linked to its exact bill so cancellation and remaining
--     balance calculation are deterministic.

ALTER TABLE public.pembayaran
  ADD COLUMN IF NOT EXISTS tagihan_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pembayaran_tagihan_id_fkey'
      AND conrelid = 'public.pembayaran'::regclass
  ) THEN
    ALTER TABLE public.pembayaran
      ADD CONSTRAINT pembayaran_tagihan_id_fkey
      FOREIGN KEY (tagihan_id) REFERENCES public.tagihan(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pembayaran_tagihan_id
  ON public.pembayaran(tagihan_id)
  WHERE tagihan_id IS NOT NULL;

-- Safe backfill for payments that were already explicitly referenced by a bill.
UPDATE public.pembayaran p
SET tagihan_id = t.id
FROM public.tagihan t
WHERE t.pembayaran_id = p.id
  AND p.tagihan_id IS NULL;

ALTER TABLE public.transaksi_midtrans_item
  ADD COLUMN IF NOT EXISTS tagihan_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transaksi_midtrans_item_tagihan_id_fkey'
      AND conrelid = 'public.transaksi_midtrans_item'::regclass
  ) THEN
    ALTER TABLE public.transaksi_midtrans_item
      ADD CONSTRAINT transaksi_midtrans_item_tagihan_id_fkey
      FOREIGN KEY (tagihan_id) REFERENCES public.tagihan(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transaksi_midtrans_item_tagihan_id
  ON public.transaksi_midtrans_item(tagihan_id)
  WHERE tagihan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_atomik(
  p_siswa_id          uuid,
  p_jenis_id          uuid,
  p_bulan             int,
  p_jumlah            numeric,
  p_tanggal_bayar     date,
  p_keterangan        text,
  p_departemen_id     uuid,
  p_tahun_ajaran_id   uuid,
  p_is_bayar_dimuka   boolean,
  p_tagihan_id        uuid,
  p_kas_akun_id       uuid,
  p_kredit_akun_id    uuid,
  p_kredit_label      text,
  p_prefix_jurnal     text,
  p_petugas_id        uuid,
  p_jenis_nama        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.proses_pembayaran_atomik(
  uuid, uuid, integer, numeric, date, text, uuid, uuid, boolean,
  uuid, uuid, uuid, text, text, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proses_pembayaran_atomik(
  uuid, uuid, integer, numeric, date, text, uuid, uuid, boolean,
  uuid, uuid, uuid, text, text, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proses_pembayaran_atomik(
  uuid, uuid, integer, numeric, date, text, uuid, uuid, boolean,
  uuid, uuid, uuid, text, text, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_midtrans_atomik(
  p_transaksi_item_id uuid,
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_bulan integer,
  p_jumlah numeric,
  p_tanggal_bayar date,
  p_departemen_id uuid,
  p_tahun_ajaran_id uuid,
  p_order_id text,
  p_payment_type text,
  p_kas_akun_id uuid,
  p_kredit_akun_id uuid,
  p_jenis_nama text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.proses_pembayaran_midtrans_atomik(
  uuid, uuid, uuid, integer, numeric, date, uuid, uuid, text, text, uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proses_pembayaran_midtrans_atomik(
  uuid, uuid, uuid, integer, numeric, date, uuid, uuid, text, text, uuid, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proses_pembayaran_midtrans_atomik(
  uuid, uuid, uuid, integer, numeric, date, uuid, uuid, text, text, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.batalkan_pembayaran_atomik(
  p_pembayaran_id uuid,
  p_alasan        text,
  p_tanggal       date,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pb                    public.pembayaran;
  v_jurnal                public.jurnal;
  v_dimuka                public.pendapatan_dimuka;
  v_nomor                 text;
  v_tahun                 integer;
  v_pembalik_id           uuid;
  v_pembalik_pengakuan_id uuid;
  v_tagihan               public.tagihan;
  v_total_sisa            numeric := 0;
  v_payment_sisa_id       uuid;
  v_status_baru           text;
BEGIN
  SELECT * INTO v_pb FROM public.pembayaran WHERE id = p_pembayaran_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan'; END IF;

  v_tahun := EXTRACT(year FROM p_tanggal)::integer;

  SELECT * INTO v_dimuka
  FROM public.pendapatan_dimuka
  WHERE pembayaran_id = p_pembayaran_id
  LIMIT 1;

  IF FOUND THEN
    IF v_dimuka.jurnal_pengakuan_id IS NOT NULL THEN
      SELECT * INTO v_jurnal FROM public.jurnal WHERE id = v_dimuka.jurnal_pengakuan_id;
      IF FOUND THEN
        SELECT public.generate_nomor_jurnal('JU', v_tahun) INTO v_nomor;
        INSERT INTO public.jurnal (
          nomor, tanggal, keterangan, referensi, departemen_id, program_dana_id,
          total_debit, total_kredit, status, tipe, jurnal_asal_id
        ) VALUES (
          v_nomor, p_tanggal, 'PEMBATALAN PENGAKUAN: ' || v_jurnal.keterangan, v_jurnal.nomor,
          v_jurnal.departemen_id, v_jurnal.program_dana_id,
          v_jurnal.total_debit, v_jurnal.total_kredit, 'posted', 'pembalik', v_jurnal.id
        ) RETURNING id INTO v_pembalik_pengakuan_id;

        INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan)
        SELECT v_pembalik_pengakuan_id, akun_id, kredit, debit,
               COALESCE('[BALIK] ' || keterangan, '[BALIK]'), urutan
        FROM public.jurnal_detail
        WHERE jurnal_id = v_jurnal.id;
      END IF;
    END IF;
    DELETE FROM public.pendapatan_dimuka WHERE id = v_dimuka.id;
  END IF;

  IF v_pb.jurnal_id IS NOT NULL THEN
    SELECT * INTO v_jurnal FROM public.jurnal WHERE id = v_pb.jurnal_id;
    IF FOUND THEN
      SELECT public.generate_nomor_jurnal('JU', v_tahun) INTO v_nomor;
      INSERT INTO public.jurnal (
        nomor, tanggal, keterangan, referensi, departemen_id, program_dana_id,
        total_debit, total_kredit, status, tipe, jurnal_asal_id
      ) VALUES (
        v_nomor, p_tanggal, 'PEMBATALAN: ' || v_jurnal.keterangan, v_jurnal.nomor,
        v_jurnal.departemen_id, v_jurnal.program_dana_id,
        v_jurnal.total_debit, v_jurnal.total_kredit, 'posted', 'pembalik', v_jurnal.id
      ) RETURNING id INTO v_pembalik_id;

      INSERT INTO public.jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan, urutan)
      SELECT v_pembalik_id, akun_id, kredit, debit,
             COALESCE('[BALIK] ' || keterangan, '[BALIK]'), urutan
      FROM public.jurnal_detail
      WHERE jurnal_id = v_jurnal.id;
    END IF;
  END IF;

  IF v_pb.tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan
    FROM public.tagihan
    WHERE id = v_pb.tagihan_id
    FOR UPDATE;
  ELSE
    UPDATE public.tagihan
    SET status = CASE
          WHEN jatuh_tempo IS NOT NULL AND jatuh_tempo > CURRENT_DATE THEN 'terjadwal'
          ELSE 'belum_bayar'
        END,
        pembayaran_id = NULL
    WHERE pembayaran_id = p_pembayaran_id;
  END IF;

  DELETE FROM public.pembayaran WHERE id = p_pembayaran_id;

  IF v_pb.tagihan_id IS NOT NULL AND v_tagihan.id IS NOT NULL THEN
    SELECT COALESCE(SUM(jumlah), 0)
    INTO v_total_sisa
    FROM public.pembayaran
    WHERE tagihan_id = v_pb.tagihan_id;

    SELECT id INTO v_payment_sisa_id
    FROM public.pembayaran
    WHERE tagihan_id = v_pb.tagihan_id
    ORDER BY tanggal_bayar DESC NULLS LAST, id DESC
    LIMIT 1;

    v_status_baru := CASE
      WHEN v_total_sisa >= v_tagihan.nominal THEN 'lunas'
      WHEN v_total_sisa > 0 THEN 'sebagian'
      WHEN v_tagihan.jatuh_tempo IS NOT NULL AND v_tagihan.jatuh_tempo > CURRENT_DATE THEN 'terjadwal'
      ELSE 'belum_bayar'
    END;

    UPDATE public.tagihan
    SET status = v_status_baru,
        pembayaran_id = v_payment_sisa_id
    WHERE id = v_pb.tagihan_id;
  END IF;

  RETURN jsonb_build_object(
    'pembayaran_id', p_pembayaran_id,
    'jurnal_pembalik_id', v_pembalik_id,
    'jurnal_pembalik_pengakuan_id', v_pembalik_pengakuan_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.batalkan_pembayaran_atomik(uuid, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.batalkan_pembayaran_atomik(uuid, text, date, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batalkan_pembayaran_atomik(uuid, text, date, uuid) TO service_role;

CREATE OR REPLACE VIEW public.v_tagihan_belum_bayar AS
SELECT
  t.siswa_id,
  s.nis,
  s.nama AS nama_siswa,
  s.jenis_kelamin,
  k.nama AS kelas_nama,
  d.id AS departemen_id,
  d.nama AS departemen_nama,
  d.kode AS departemen_kode,
  jp.id AS jenis_id,
  jp.nama AS jenis_nama,
  GREATEST(t.nominal - COALESCE(pay.total_bayar, 0), 0)::numeric(15,2) AS nominal,
  ta.id AS tahun_ajaran_id,
  ta.nama AS tahun_ajaran_nama,
  COALESCE(t.bulan, 0) AS bulan,
  t.status = 'lunas' AS sudah_bayar,
  t.pembayaran_id,
  p.tanggal_bayar,
  ta.tanggal_mulai AS tahun_ajaran_mulai,
  t.id AS tagihan_id,
  t.status,
  t.jatuh_tempo,
  t.status <> 'lunas'
    AND t.jatuh_tempo IS NOT NULL
    AND t.jatuh_tempo < CURRENT_DATE AS menunggak
FROM public.tagihan t
JOIN public.siswa s ON s.id = t.siswa_id
LEFT JOIN public.kelas k ON k.id = t.kelas_id
LEFT JOIN public.departemen d ON d.id = k.departemen_id
JOIN public.jenis_pembayaran jp ON jp.id = t.jenis_id
JOIN public.tahun_ajaran ta ON ta.id = t.tahun_ajaran_id
LEFT JOIN public.pembayaran p ON p.id = t.pembayaran_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(px.jumlah), 0) AS total_bayar
  FROM public.pembayaran px
  WHERE px.tagihan_id = t.id
) pay ON true
WHERE s.status = 'aktif'
  AND t.status IN ('terjadwal', 'belum_bayar', 'sebagian', 'lunas');

COMMENT ON COLUMN public.pembayaran.tagihan_id IS
  'Tagihan exact yang dibayar; memungkinkan beberapa cicilan untuk satu tagihan dan rekalkulasi status yang deterministik.';
COMMENT ON COLUMN public.transaksi_midtrans_item.tagihan_id IS
  'Tagihan exact yang menjadi sumber item Midtrans.';