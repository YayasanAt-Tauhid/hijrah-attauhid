-- Hormati flag jenis_pembayaran.perlu_dimuka pada pembayaran online.
--
-- Sebelumnya setiap tagihan berstatus `terjadwal` selalu diperlakukan sebagai
-- Pendapatan Diterima di Muka, meskipun jenis penerimaannya secara eksplisit
-- dikonfigurasi perlu_dimuka=false. Akibatnya UI "tidak menggunakan pendapatan
-- dimuka" tidak benar-benar berpengaruh pada jalur pembayaran online.
--
-- Aturan setelah migrasi:
--   1. perlu_dimuka=true + tagihan terjadwal -> kredit liabilitas pendapatan dimuka.
--   2. perlu_dimuka=false + tagihan terjadwal -> kredit akun pendapatan jenis.
--   3. tagihan belum_bayar -> kredit Piutang Siswa karena piutang sudah dibentuk.
--   4. pembayaran tanpa tagihan cocok -> kredit akun pendapatan jenis.

CREATE OR REPLACE FUNCTION public.proses_pembayaran_midtrans_atomik(
  p_transaksi_item_id  uuid,
  p_siswa_id           uuid,
  p_jenis_id           uuid,
  p_bulan              int,
  p_jumlah             numeric,
  p_tanggal_bayar      date,
  p_departemen_id      uuid,
  p_tahun_ajaran_id    uuid,
  p_order_id           text,
  p_payment_type       text,
  p_kas_akun_id        uuid,
  p_kredit_akun_id     uuid,
  p_jenis_nama         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_pembayaran_id   uuid;
  v_jurnal_id       uuid;
  v_nomor_jurnal    text;
  v_tahun           int := EXTRACT(YEAR FROM p_tanggal_bayar)::int;
  v_bulan_norm      int := NULLIF(p_bulan, 0);
  v_keterangan      text;
  v_tagihan         record;
  v_dimuka          boolean := false;
  v_perlu_dimuka    boolean := true;
  v_kredit_akun_id  uuid := p_kredit_akun_id;
  v_kredit_label    text;
  v_piutang_akun_id uuid;
  v_periode_bayar   uuid;
  v_nama_siswa      text;
  v_identitas       text;
BEGIN
  IF p_kas_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun Bank Midtrans belum dikonfigurasi di Pengaturan Akun';
  END IF;
  IF p_kredit_akun_id IS NULL THEN
    RAISE EXCEPTION 'Akun Pendapatan untuk jenis "%" belum dikonfigurasi', p_jenis_nama;
  END IF;

  SELECT nama INTO v_nama_siswa FROM public.siswa WHERE id = p_siswa_id;

  SELECT COALESCE(perlu_dimuka, true)
  INTO v_perlu_dimuka
  FROM public.jenis_pembayaran
  WHERE id = p_jenis_id;

  -- Gunakan identitas yang sama dengan jurnal pembentukan piutang (JPI).
  v_identitas := p_jenis_nama
    || CASE WHEN v_bulan_norm IS NOT NULL THEN '-B' || v_bulan_norm ELSE '' END
    || ' - ' || COALESCE(v_nama_siswa, p_siswa_id::text);

  -- Anti-duplikat.
  IF v_bulan_norm IS NOT NULL THEN
    PERFORM 1 FROM public.pembayaran
    WHERE siswa_id = p_siswa_id AND jenis_id = p_jenis_id
      AND bulan = v_bulan_norm AND tahun_ajaran_id = p_tahun_ajaran_id;
    IF FOUND THEN
      RAISE EXCEPTION 'Pembayaran bulan % untuk jenis ini sudah ada', v_bulan_norm;
    END IF;
  END IF;

  -- Tagihan sasaran menentukan apakah pembayaran melunasi piutang atau
  -- merupakan penerimaan sebelum jatuh tempo.
  SELECT t.id, t.status INTO v_tagihan
  FROM public.tagihan t
  WHERE t.siswa_id        = p_siswa_id
    AND t.jenis_id        = p_jenis_id
    AND t.tahun_ajaran_id = p_tahun_ajaran_id
    AND (
      (v_bulan_norm IS NULL AND t.bulan IS NULL) OR
      (t.bulan = v_bulan_norm)
    )
    AND t.status IN ('belum_bayar', 'terjadwal')
  LIMIT 1;

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

    -- Hanya kredit Piutang jika tagihan memang sudah jatuh tempo dan piutang
    -- sudah dibentuk. Tagihan `terjadwal` dengan perlu_dimuka=false belum pernah
    -- membentuk piutang, sehingga pembayarannya langsung menjadi pendapatan.
    IF v_tagihan.id IS NOT NULL
       AND v_tagihan.status = 'belum_bayar'
       AND v_piutang_akun_id IS NOT NULL THEN
      v_kredit_akun_id := v_piutang_akun_id;
      v_keterangan := 'Pembayaran Piutang ' || v_identitas
        || ' [Online - ' || p_order_id || ' via ' || COALESCE(p_payment_type, '-') || ']';
      v_kredit_label := 'Piutang Siswa - ' || v_identitas;
    ELSE
      -- Fallback untuk pembayaran tanpa piutang yang sudah dibentuk.
      v_keterangan := 'Pembayaran ' || v_identitas
        || ' [Online - ' || p_order_id || ' via ' || COALESCE(p_payment_type, '-') || ']';
      v_kredit_label := 'Pendapatan - ' || v_identitas;
    END IF;
  END IF;

  INSERT INTO public.pembayaran (
    siswa_id, jenis_id, tahun_ajaran_id, bulan,
    jumlah, tanggal_bayar, departemen_id, keterangan
  )
  VALUES (
    p_siswa_id, p_jenis_id, p_tahun_ajaran_id, v_bulan_norm,
    p_jumlah, p_tanggal_bayar, p_departemen_id, v_keterangan
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

  UPDATE public.tagihan
  SET status = 'lunas', pembayaran_id = v_pembayaran_id
  WHERE siswa_id        = p_siswa_id
    AND jenis_id        = p_jenis_id
    AND tahun_ajaran_id = p_tahun_ajaran_id
    AND status          IN ('belum_bayar', 'terjadwal')
    AND (
      (v_bulan_norm IS NULL AND bulan IS NULL) OR
      (bulan = v_bulan_norm)
    );

  IF v_dimuka THEN
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
      COALESCE(v_periode_bayar, p_tahun_ajaran_id), p_tahun_ajaran_id,
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
    'diterima_dimuka', v_dimuka
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proses_pembayaran_midtrans_atomik(
  uuid, uuid, uuid, int, numeric, date, uuid, uuid, text, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.proses_pembayaran_midtrans_atomik(
  uuid, uuid, uuid, int, numeric, date, uuid, uuid, text, text, uuid, uuid, text
) TO service_role;
