-- Uang Pangkal boleh dicicil sebelum jatuh tempo.
-- Cicilan pra-jatuh-tempo tetap dicatat sebagai Pendapatan Diterima di Muka.
-- Tagihan parsial tetap berstatus terjadwal agar akrual jatuh tempo hanya
-- membentuk piutang sebesar sisa yang belum dibayar.
-- Berlaku hanya untuk UANG PANGKAL TK/SD/SMP/SMA/MTA.

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
  v_is_spp boolean;
  v_is_uang_pangkal boolean;
  v_jenis public.jenis_pembayaran;
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

  SELECT * INTO STRICT v_jenis FROM public.jenis_pembayaran WHERE id=p_jenis_id;
  v_is_spp := v_jenis.tipe='bulanan' AND lower(btrim(v_jenis.nama)) ~ '^spp([[:space:]-]|$)';
  v_is_uang_pangkal := upper(btrim(v_jenis.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)
  IF v_is_spp AND p_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan SPP dengan periode layanan terlebih dahulu';
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

    -- SPP boleh dicicil sejak bulan layanan. Uang Pangkal boleh dicicil sejak
    -- masih terjadwal; selama belum jatuh tempo cicilan tetap merupakan uang muka.
    IF v_tagihan.status = 'terjadwal'
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))
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

  -- Tagihan bulan berjalan diakui atomik saat dibayar, tanpa menunggu cron.
  IF v_is_spp AND v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    PERFORM public.posting_spp_tagihan_atomik(v_tagihan.id,NULL);
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id=p_tagihan_id;
  END IF;

  -- SQL menentukan akun berdasarkan jurnal yang benar-benar sudah ada.
  IF v_is_spp THEN
    IF v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN
      p_is_bayar_dimuka := false;
      SELECT akun_id INTO p_kredit_akun_id FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
      p_kredit_label := 'Piutang Siswa'; p_prefix_jurnal := 'JP';
    ELSE
      p_is_bayar_dimuka := true;
      SELECT COALESCE(v_jenis.akun_dimuka_id,pa.akun_id) INTO p_kredit_akun_id
      FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting='AKUN_PENDAPATAN_DIMUKA';
      p_kredit_label := 'Pendapatan Diterima di Muka - '||v_jenis.nama; p_prefix_jurnal := 'JD';
    END IF;
    IF p_kredit_akun_id IS NULL THEN RAISE EXCEPTION 'Akun SPP belum dikonfigurasi'; END IF;
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
      WHEN p_is_bayar_dimuka AND v_is_uang_pangkal AND v_tagihan.status = 'terjadwal' THEN 'terjadwal'
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
    'diterima_dimuka', p_is_bayar_dimuka,
    'pembayaran_id', v_pembayaran_id,
    'jurnal_id',     v_jurnal_id,
    'nomor_jurnal',  v_nomor_jurnal,
    'status_tagihan', COALESCE(v_status_sesudah, 'lunas'),
    'sisa_tagihan', COALESCE(v_sisa_sesudah, 0)
  );
END;
$function$;
;
  IF v_is_spp AND p_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan SPP dengan periode layanan terlebih dahulu';
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

    -- Cicilan SPP diizinkan sejak bulan layanan; pembayaran sebelum layanan tetap penuh.
    IF v_tagihan.status = 'terjadwal'
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))
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

  -- Tagihan bulan berjalan diakui atomik saat dibayar, tanpa menunggu cron.
  IF v_is_spp AND v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    PERFORM public.posting_spp_tagihan_atomik(v_tagihan.id,NULL);
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id=p_tagihan_id;
  END IF;

  -- SQL menentukan akun berdasarkan jurnal yang benar-benar sudah ada.
  IF v_is_spp THEN
    IF v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN
      p_is_bayar_dimuka := false;
      SELECT akun_id INTO p_kredit_akun_id FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
      p_kredit_label := 'Piutang Siswa'; p_prefix_jurnal := 'JP';
    ELSE
      p_is_bayar_dimuka := true;
      SELECT COALESCE(v_jenis.akun_dimuka_id,pa.akun_id) INTO p_kredit_akun_id
      FROM (SELECT 1) x LEFT JOIN public.pengaturan_akun pa ON pa.kode_setting='AKUN_PENDAPATAN_DIMUKA';
      p_kredit_label := 'Pendapatan Diterima di Muka - '||v_jenis.nama; p_prefix_jurnal := 'JD';
    END IF;
    IF p_kredit_akun_id IS NULL THEN RAISE EXCEPTION 'Akun SPP belum dikonfigurasi'; END IF;
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
    'diterima_dimuka', p_is_bayar_dimuka,
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
  v_is_spp boolean;
  v_is_uang_pangkal boolean;
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

  SELECT tipe='bulanan' AND lower(btrim(nama)) ~ '^spp([[:space:]-]|$)',
         upper(btrim(nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)

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
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))
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
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      v_tagihan_id := v_tagihan.id;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.jenis_pembayaran jp WHERE jp.id = p_jenis_id
             AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$')
     AND v_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan uang pangkal dengan tahun ajaran target terlebih dahulu';
  END IF;

  IF v_is_spp AND v_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan SPP dengan periode layanan terlebih dahulu';
  END IF;
  IF v_tagihan_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jumlah),0) INTO v_total_sebelum FROM public.pembayaran WHERE tagihan_id=v_tagihan_id;
    IF p_jumlah > v_tagihan.nominal-v_total_sebelum THEN RAISE EXCEPTION 'Jumlah pembayaran melebihi sisa tagihan'; END IF;
    IF v_tagihan.status='terjadwal'
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id)<=p_tanggal_bayar,false))
       AND p_jumlah<v_tagihan.nominal-v_total_sebelum THEN
      RAISE EXCEPTION 'Tagihan yang belum jatuh tempo harus dibayar penuh';
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

  IF v_is_spp AND v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    PERFORM public.posting_spp_tagihan_atomik(v_tagihan.id,NULL);
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id=v_tagihan_id;
  END IF;

  v_dimuka := COALESCE(v_perlu_dimuka, true)
              AND COALESCE(v_tagihan.status = 'terjadwal', false);

  IF v_is_spp THEN
    v_dimuka := v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai;
  END IF;

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
       AND (CASE WHEN v_is_spp THEN
            v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai
            ELSE v_tagihan.status IN ('belum_bayar', 'sebagian') END)
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
      WHEN v_dimuka AND v_is_uang_pangkal AND v_tagihan.status = 'terjadwal' THEN 'terjadwal'
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

  INTO v_is_spp, v_is_uang_pangkal
  FROM public.jenis_pembayaran WHERE id=p_jenis_id;

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
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar,false))
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
    LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      v_tagihan_id := v_tagihan.id;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.jenis_pembayaran jp WHERE jp.id = p_jenis_id
             AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$')
     AND v_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan uang pangkal dengan tahun ajaran target terlebih dahulu';
  END IF;

  IF v_is_spp AND v_tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Buat dan pilih tagihan SPP dengan periode layanan terlebih dahulu';
  END IF;
  IF v_tagihan_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jumlah),0) INTO v_total_sebelum FROM public.pembayaran WHERE tagihan_id=v_tagihan_id;
    IF p_jumlah > v_tagihan.nominal-v_total_sebelum THEN RAISE EXCEPTION 'Jumlah pembayaran melebihi sisa tagihan'; END IF;
    IF v_tagihan.status='terjadwal'
       AND NOT v_is_uang_pangkal
       AND NOT (v_is_spp AND COALESCE(public.tanggal_pengakuan_tagihan(v_tagihan.id)<=p_tanggal_bayar,false))
       AND p_jumlah<v_tagihan.nominal-v_total_sebelum THEN
      RAISE EXCEPTION 'Tagihan yang belum jatuh tempo harus dibayar penuh';
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

  IF v_is_spp AND v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= p_tanggal_bayar
     AND public.tanggal_pengakuan_tagihan(v_tagihan.id) <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    PERFORM public.posting_spp_tagihan_atomik(v_tagihan.id,NULL);
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id=v_tagihan_id;
  END IF;

  v_dimuka := COALESCE(v_perlu_dimuka, true)
              AND COALESCE(v_tagihan.status = 'terjadwal', false);

  IF v_is_spp THEN
    v_dimuka := v_tagihan.jurnal_piutang_id IS NULL AND NOT v_tagihan.pengakuan_spp_selesai;
  END IF;

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
       AND (CASE WHEN v_is_spp THEN
            v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai
            ELSE v_tagihan.status IN ('belum_bayar', 'sebagian') END)
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
  v_spp_result jsonb;
  v_total_dibayar numeric := 0;
  v_sisa_netto numeric := 0;
  v_bruto_post numeric := 0;
  v_is_uang_pangkal boolean := false;
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
           jp.nama AS jenis_nama, jp.tipe, jp.akun_pendapatan_id, jp.akun_potongan_id
    FROM tagihan t
    JOIN jenis_pembayaran jp ON jp.id = t.jenis_id
    WHERE t.jurnal_piutang_id IS NULL AND (
      (jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)'
        AND t.status IN ('terjadwal','belum_bayar','sebagian','lunas')
        AND NOT t.pengakuan_spp_selesai AND public.tanggal_pengakuan_tagihan(t.id) <= v_batas)
      OR
      (NOT (jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)')
        AND t.jatuh_tempo<=v_batas
        AND (
          t.status='terjadwal'
          OR (
            upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)
    )
    ORDER BY t.jatuh_tempo, t.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      IF v_row.tipe='bulanan' AND lower(btrim(v_row.jenis_nama)) ~ '^spp([[:space:]-]|$)' THEN
        v_spp_result:=public.posting_spp_tagihan_atomik(v_row.id,p_user_id);
        IF (v_spp_result->>'diposting')::boolean THEN
          v_diposting:=v_diposting+1;
          v_total:=v_total+(v_spp_result->>'jumlah')::numeric;
        END IF;
        CONTINUE;
      END IF;
      IF v_row.akun_pendapatan_id IS NULL THEN
        v_errors := v_errors ||
          ('Tagihan ' || v_row.id || ': akun pendapatan belum diset untuk jenis "' || v_row.jenis_nama || '"');
        CONTINUE;
      END IF;

      v_netto  := v_row.nominal;
      v_diskon := COALESCE(v_row.nominal_diskon, 0);
      v_bruto  := COALESCE(v_row.nominal_bruto, v_row.nominal + v_diskon);
      v_is_uang_pangkal := upper(btrim(v_row.jenis_nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)

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
        v_bruto_post, v_bruto_post, 'posted', v_pegawai_id
      )
      RETURNING id INTO v_jurnal_id;

      v_urutan := 0;

      IF v_sisa_netto > 0 THEN
        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_piutang_akun_id, 'Piutang ' || v_row.jenis_nama, v_sisa_netto, 0, v_urutan);
      END IF;

      IF v_diskon > 0 THEN
        v_urutan := v_urutan + 1;
        INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
        VALUES (v_jurnal_id, v_potongan_akun_id, 'Keringanan ' || v_row.jenis_nama, v_diskon, 0, v_urutan);
      END IF;

      v_urutan := v_urutan + 1;
      INSERT INTO jurnal_detail (jurnal_id, akun_id, keterangan, debit, kredit, urutan)
      VALUES (v_jurnal_id, v_row.akun_pendapatan_id, 'Pendapatan ' || v_row.jenis_nama, 0, v_bruto_post, v_urutan);

      UPDATE tagihan
      SET status = CASE
            WHEN v_is_uang_pangkal AND v_sisa_netto <= 0 THEN 'lunas'
            WHEN v_is_uang_pangkal AND v_total_dibayar > 0 THEN 'sebagian'
            ELSE 'belum_bayar'
          END,
          jurnal_piutang_id = v_jurnal_id
      WHERE id = v_row.id
        AND jurnal_piutang_id IS NULL
        AND (
          status='terjadwal'
          OR (v_is_uang_pangkal AND status='lunas' AND v_diskon > 0)
        );

      IF NOT FOUND THEN
        DELETE FROM jurnal_detail WHERE jurnal_id = v_jurnal_id;
        DELETE FROM jurnal WHERE id = v_jurnal_id;
        CONTINUE;
      END IF;

      v_diposting := v_diposting + 1;
      v_total := v_total + v_sisa_netto;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || ('Tagihan ' || v_row.id || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN QUERY SELECT v_diposting, v_total, v_errors;
END;
$function$;

            AND t.status='lunas'
            AND COALESCE(t.nominal_diskon,0) > 0
            AND EXISTS (
              SELECT 1
              FROM public.pembayaran p0
              JOIN public.pendapatan_dimuka pd0 ON pd0.pembayaran_id=p0.id
              WHERE p0.tagihan_id=t.id
                AND pd0.status='pending'
                AND pd0.jurnal_pengakuan_id IS NULL
            )
          )
        ))
    )
    ORDER BY t.jatuh_tempo, t.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      IF v_row.tipe='bulanan' AND lower(btrim(v_row.jenis_nama)) ~ '^spp([[:space:]-]|$)' THEN
        v_spp_result:=public.posting_spp_tagihan_atomik(v_row.id,p_user_id);
        IF (v_spp_result->>'diposting')::boolean THEN
          v_diposting:=v_diposting+1;
          v_total:=v_total+(v_spp_result->>'jumlah')::numeric;
        END IF;
        CONTINUE;
      END IF;
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
;
      SELECT COALESCE(SUM(p.jumlah),0) INTO v_total_dibayar
      FROM public.pembayaran p WHERE p.tagihan_id=v_row.id;
      v_sisa_netto := CASE WHEN v_is_uang_pangkal
        THEN GREATEST(v_netto-v_total_dibayar,0) ELSE v_netto END;
      v_bruto_post := v_sisa_netto + v_diskon;

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

            AND t.status='lunas'
            AND COALESCE(t.nominal_diskon,0) > 0
            AND EXISTS (
              SELECT 1
              FROM public.pembayaran p0
              JOIN public.pendapatan_dimuka pd0 ON pd0.pembayaran_id=p0.id
              WHERE p0.tagihan_id=t.id
                AND pd0.status='pending'
                AND pd0.jurnal_pengakuan_id IS NULL
            )
          )
        ))
    )
    ORDER BY t.jatuh_tempo, t.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    BEGIN
      IF v_row.tipe='bulanan' AND lower(btrim(v_row.jenis_nama)) ~ '^spp([[:space:]-]|$)' THEN
        v_spp_result:=public.posting_spp_tagihan_atomik(v_row.id,p_user_id);
        IF (v_spp_result->>'diposting')::boolean THEN
          v_diposting:=v_diposting+1;
          v_total:=v_total+(v_spp_result->>'jumlah')::numeric;
        END IF;
        CONTINUE;
      END IF;
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

CREATE OR REPLACE FUNCTION public.batalkan_pembayaran_atomik(p_pembayaran_id uuid, p_alasan text, p_tanggal date, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_restore_piutang boolean := false;
  v_spp_piutang uuid;
  v_spp_pendapatan uuid;
  v_spp_jurnal uuid;
BEGIN
  SELECT * INTO v_pb FROM public.pembayaran WHERE id = p_pembayaran_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan'; END IF;

  v_tahun := EXTRACT(year FROM p_tanggal)::integer;

  SELECT * INTO v_dimuka
  FROM public.pendapatan_dimuka
  WHERE pembayaran_id = p_pembayaran_id
  LIMIT 1 FOR UPDATE;

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

    v_restore_piutang := v_dimuka.id IS NOT NULL
      AND v_dimuka.jurnal_pengakuan_id IS NOT NULL
      AND EXISTS(
        SELECT 1
        FROM public.tagihan t
        JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id
        WHERE t.id=v_pb.tagihan_id
          AND (
            (t.pengakuan_spp_selesai
              AND jp.tipe='bulanan'
              AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)')
            OR
            (upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)

  IF v_restore_piutang THEN
    SELECT akun_id INTO v_spp_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
    SELECT akun_pendapatan_id INTO v_spp_pendapatan FROM public.jenis_pembayaran WHERE id=v_pb.jenis_id;
    IF v_spp_piutang IS NULL OR v_spp_pendapatan IS NULL THEN
      RAISE EXCEPTION 'Akun piutang/pendapatan belum dikonfigurasi';
    END IF;
    v_nomor:=public.generate_nomor_jurnal('JPI',v_tahun);
    INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    VALUES(v_nomor,p_tanggal,'Piutang atas pembatalan pembayaran yang telah diakui',v_pb.tagihan_id::text,
      COALESCE(v_dimuka.departemen_id,v_pb.departemen_id),v_pb.jumlah,v_pb.jumlah,'posted') RETURNING id INTO v_spp_jurnal;
    INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan) VALUES
      (v_spp_jurnal,v_spp_piutang,v_pb.jumlah,0,'Piutang Siswa',1),
      (v_spp_jurnal,v_spp_pendapatan,0,v_pb.jumlah,'Pemulihan pendapatan periode layanan',2);
    UPDATE public.tagihan SET jurnal_piutang_id=COALESCE(jurnal_piutang_id,v_spp_jurnal)
    WHERE id=v_pb.tagihan_id;
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
      WHEN v_total_sisa > 0
        AND v_tagihan.jurnal_piutang_id IS NULL
        AND v_tagihan.jatuh_tempo IS NOT NULL
        AND v_tagihan.jatuh_tempo > CURRENT_DATE
        AND EXISTS (
          SELECT 1 FROM public.jenis_pembayaran jp
          WHERE jp.id=v_tagihan.jenis_id
            AND upper(btrim(jp.nama)) ~ '^UANG PANGKAL (TK|SD|SMP|SMA|MTA)

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
$function$;

              AND public.tanggal_pengakuan_tagihan(t.id) <= p_tanggal)
          )
      );

  IF v_restore_piutang THEN
    SELECT akun_id INTO v_spp_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
    SELECT akun_pendapatan_id INTO v_spp_pendapatan FROM public.jenis_pembayaran WHERE id=v_pb.jenis_id;
    IF v_spp_piutang IS NULL OR v_spp_pendapatan IS NULL THEN
      RAISE EXCEPTION 'Akun piutang/pendapatan SPP belum dikonfigurasi';
    END IF;
    v_nomor:=public.generate_nomor_jurnal('JPI',v_tahun);
    INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    VALUES(v_nomor,p_tanggal,'Piutang SPP atas pembatalan pembayaran yang telah diakui',v_pb.tagihan_id::text,
      COALESCE(v_dimuka.departemen_id,v_pb.departemen_id),v_pb.jumlah,v_pb.jumlah,'posted') RETURNING id INTO v_spp_jurnal;
    INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan) VALUES
      (v_spp_jurnal,v_spp_piutang,v_pb.jumlah,0,'Piutang SPP',1),
      (v_spp_jurnal,v_spp_pendapatan,0,v_pb.jumlah,'Pemulihan pendapatan periode layanan',2);
    UPDATE public.tagihan SET jurnal_piutang_id=COALESCE(jurnal_piutang_id,v_spp_jurnal)
    WHERE id=v_pb.tagihan_id;
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
      WHEN v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN 'belum_bayar'
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
$function$;

        ) THEN 'terjadwal'
      WHEN v_total_sisa > 0 THEN 'sebagian'
      WHEN v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN 'belum_bayar'
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
$function$;

              AND public.tanggal_pengakuan_tagihan(t.id) <= p_tanggal)
          )
      );

  IF v_restore_piutang THEN
    SELECT akun_id INTO v_spp_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
    SELECT akun_pendapatan_id INTO v_spp_pendapatan FROM public.jenis_pembayaran WHERE id=v_pb.jenis_id;
    IF v_spp_piutang IS NULL OR v_spp_pendapatan IS NULL THEN
      RAISE EXCEPTION 'Akun piutang/pendapatan SPP belum dikonfigurasi';
    END IF;
    v_nomor:=public.generate_nomor_jurnal('JPI',v_tahun);
    INSERT INTO public.jurnal(nomor,tanggal,keterangan,referensi,departemen_id,total_debit,total_kredit,status)
    VALUES(v_nomor,p_tanggal,'Piutang SPP atas pembatalan pembayaran yang telah diakui',v_pb.tagihan_id::text,
      COALESCE(v_dimuka.departemen_id,v_pb.departemen_id),v_pb.jumlah,v_pb.jumlah,'posted') RETURNING id INTO v_spp_jurnal;
    INSERT INTO public.jurnal_detail(jurnal_id,akun_id,debit,kredit,keterangan,urutan) VALUES
      (v_spp_jurnal,v_spp_piutang,v_pb.jumlah,0,'Piutang SPP',1),
      (v_spp_jurnal,v_spp_pendapatan,0,v_pb.jumlah,'Pemulihan pendapatan periode layanan',2);
    UPDATE public.tagihan SET jurnal_piutang_id=COALESCE(jurnal_piutang_id,v_spp_jurnal)
    WHERE id=v_pb.tagihan_id;
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
      WHEN v_tagihan.jurnal_piutang_id IS NOT NULL OR v_tagihan.pengakuan_spp_selesai THEN 'belum_bayar'
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
$function$;

