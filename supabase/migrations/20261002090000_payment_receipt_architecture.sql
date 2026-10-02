-- Arsitektur kuitansi pembayaran jangka panjang.
-- Migration ini hanya menambah struktur baru dan wrapper RPC.
-- Tidak melakukan backfill / perubahan terhadap data pembayaran historis.

CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('cashier', 'manual', 'midtrans', 'legacy')),
  source_reference text CHECK (source_reference IS NULL OR btrim(source_reference) <> ''),
  payment_date date NOT NULL,
  payment_method text,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'reconciliation_required', 'partial_void', 'void')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payer_user_id uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  cashier_employee_id uuid REFERENCES public.pegawai(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_reference),
  CHECK (source <> 'midtrans' OR source_reference IS NOT NULL)
);

CREATE TABLE public.payment_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.payment_receipts(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  payment_id uuid UNIQUE REFERENCES public.pembayaran(id) ON DELETE SET NULL,
  siswa_id uuid REFERENCES public.siswa(id) ON DELETE SET NULL,
  jenis_id uuid REFERENCES public.jenis_pembayaran(id) ON DELETE SET NULL,
  tagihan_id uuid REFERENCES public.tagihan(id) ON DELETE SET NULL,
  tahun_ajaran_id uuid REFERENCES public.tahun_buku(id) ON DELETE SET NULL,
  bulan integer CHECK (bulan IS NULL OR bulan BETWEEN 1 AND 12),
  student_name text NOT NULL,
  student_nis text,
  student_nisn text,
  payment_type_name text NOT NULL,
  department_name text,
  period_label text,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'void')),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES public.users_profile(id) ON DELETE SET NULL,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, line_no)
);

CREATE TABLE public.payment_receipt_counters (
  period_key text PRIMARY KEY,
  last_number bigint NOT NULL CHECK (last_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_receipts_date
  ON public.payment_receipts(payment_date DESC, created_at DESC);
CREATE INDEX idx_payment_receipts_payer
  ON public.payment_receipts(payer_user_id, payment_date DESC);
CREATE INDEX idx_payment_receipts_creator
  ON public.payment_receipts(created_by_user_id, payment_date DESC);
CREATE INDEX idx_payment_receipt_items_receipt
  ON public.payment_receipt_items(receipt_id, line_no);
CREATE INDEX idx_payment_receipt_items_student
  ON public.payment_receipt_items(siswa_id, created_at DESC);
CREATE INDEX idx_payment_receipt_items_tagihan
  ON public.payment_receipt_items(tagihan_id)
  WHERE tagihan_id IS NOT NULL;

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_counters ENABLE ROW LEVEL SECURITY;

-- Seluruh mutasi/read kuitansi dilakukan lewat server function + service role.
-- Tidak membuka tabel kuitansi langsung ke browser.
REVOKE ALL ON TABLE public.payment_receipts FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_receipt_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_receipt_counters FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_receipts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_receipt_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_receipt_counters TO service_role;

CREATE OR REPLACE FUNCTION public.generate_nomor_kuitansi(
  p_tanggal date,
  p_departemen_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_period_key text := to_char(p_tanggal, 'YYYY-MM');
  v_sequence bigint;
  v_template text;
  v_lembaga text := 'YYS';
  v_result text;
BEGIN
  INSERT INTO public.payment_receipt_counters(period_key, last_number, updated_at)
  VALUES (v_period_key, 1, now())
  ON CONFLICT (period_key)
  DO UPDATE SET
    last_number = public.payment_receipt_counters.last_number + 1,
    updated_at = now()
  RETURNING last_number INTO v_sequence;

  SELECT NULLIF(btrim(template), '')
  INTO v_template
  FROM public.pengaturan_template
  WHERE kode_template = 'nomor_kuitansi';

  v_template := COALESCE(v_template, 'KWT-{TAHUN}-{BULAN}-{NOMOR}');

  IF p_departemen_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(kode), ''), 'YYS')
    INTO v_lembaga
    FROM public.departemen
    WHERE id = p_departemen_id;
    v_lembaga := COALESCE(v_lembaga, 'YYS');
  END IF;

  LOOP
    v_result := replace(v_template, '{TAHUN}', to_char(p_tanggal, 'YYYY'));
    v_result := replace(v_result, '{BULAN}', to_char(p_tanggal, 'MM'));
    v_result := replace(v_result, '{NOMOR}', lpad(v_sequence::text, 4, '0'));
    v_result := replace(v_result, '{LEMBAGA}', v_lembaga);

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.payment_receipts WHERE receipt_number = v_result
    );

    UPDATE public.payment_receipt_counters
    SET last_number = last_number + 1,
        updated_at = now()
    WHERE period_key = v_period_key
    RETURNING last_number INTO v_sequence;
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_nomor_kuitansi(date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_nomor_kuitansi(date, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_payment_receipt(
  p_receipt_id uuid,
  p_source text,
  p_source_reference text,
  p_payment_date date,
  p_payment_method text,
  p_created_by_user_id uuid,
  p_payer_user_id uuid,
  p_departemen_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_receipt public.payment_receipts;
  v_receipt_id uuid;
  v_number text;
  v_employee_id uuid;
BEGIN
  IF p_source NOT IN ('cashier', 'manual', 'midtrans', 'legacy') THEN
    RAISE EXCEPTION 'Sumber kuitansi tidak valid';
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    SELECT * INTO v_receipt
    FROM public.payment_receipts
    WHERE id = p_receipt_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kuitansi pembayaran tidak ditemukan';
    END IF;
    IF v_receipt.status <> 'issued' THEN
      RAISE EXCEPTION 'Kuitansi tidak dapat menerima item baru karena status %', v_receipt.status;
    END IF;
    IF v_receipt.source <> p_source THEN
      RAISE EXCEPTION 'Sumber pembayaran tidak sama dengan kuitansi';
    END IF;
    IF v_receipt.payment_date <> p_payment_date THEN
      RAISE EXCEPTION 'Tanggal pembayaran tidak sama dengan kuitansi';
    END IF;
    IF p_created_by_user_id IS NOT NULL
       AND v_receipt.created_by_user_id IS DISTINCT FROM p_created_by_user_id THEN
      RAISE EXCEPTION 'Petugas pembayaran tidak sama dengan kuitansi';
    END IF;
    RETURN v_receipt.id;
  END IF;

  IF p_source_reference IS NOT NULL THEN
    SELECT * INTO v_receipt
    FROM public.payment_receipts
    WHERE source = p_source
      AND source_reference = p_source_reference
    FOR UPDATE;
    IF FOUND THEN
      RETURN v_receipt.id;
    END IF;
  END IF;

  IF p_created_by_user_id IS NOT NULL THEN
    SELECT pegawai_id INTO v_employee_id
    FROM public.users_profile
    WHERE id = p_created_by_user_id;
  END IF;

  v_number := public.generate_nomor_kuitansi(p_payment_date, p_departemen_id);

  INSERT INTO public.payment_receipts(
    receipt_number, source, source_reference, payment_date,
    payment_method, status, total_amount,
    payer_user_id, created_by_user_id, cashier_employee_id
  )
  VALUES (
    v_number, p_source, p_source_reference, p_payment_date,
    NULLIF(btrim(p_payment_method), ''), 'issued', 0,
    p_payer_user_id, p_created_by_user_id, v_employee_id
  )
  ON CONFLICT (source, source_reference)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_receipt_id;

  RETURN v_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_payment_receipt(uuid, text, text, date, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_payment_receipt(uuid, text, text, date, text, uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.append_payment_receipt_item(
  p_receipt_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_receipt public.payment_receipts;
  v_payment public.pembayaran;
  v_line integer;
  v_siswa public.siswa;
  v_jenis public.jenis_pembayaran;
  v_departemen public.departemen;
  v_tagihan public.tagihan;
  v_tahun public.tahun_buku;
  v_period_label text;
  v_description text;
  v_existing public.payment_receipt_items;
BEGIN
  SELECT * INTO v_receipt
  FROM public.payment_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kuitansi pembayaran tidak ditemukan'; END IF;

  SELECT * INTO v_existing
  FROM public.payment_receipt_items
  WHERE payment_id = p_payment_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_item_id', v_existing.id,
      'line_no', v_existing.line_no
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.pembayaran
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan untuk kuitansi'; END IF;

  SELECT * INTO v_siswa FROM public.siswa WHERE id = v_payment.siswa_id;
  SELECT * INTO v_jenis FROM public.jenis_pembayaran WHERE id = v_payment.jenis_id;
  SELECT * INTO v_departemen FROM public.departemen WHERE id = v_payment.departemen_id;

  IF v_payment.tagihan_id IS NOT NULL THEN
    SELECT * INTO v_tagihan FROM public.tagihan WHERE id = v_payment.tagihan_id;
  END IF;

  SELECT * INTO v_tahun
  FROM public.tahun_buku
  WHERE id = COALESCE(v_tagihan.tahun_ajaran_id, v_payment.tahun_ajaran_id);

  IF COALESCE(v_tagihan.bulan, v_payment.bulan) IS NOT NULL THEN
    v_period_label := trim(
      CASE COALESCE(v_tagihan.bulan, v_payment.bulan)
        WHEN 1 THEN 'Januari' WHEN 2 THEN 'Februari' WHEN 3 THEN 'Maret'
        WHEN 4 THEN 'April' WHEN 5 THEN 'Mei' WHEN 6 THEN 'Juni'
        WHEN 7 THEN 'Juli' WHEN 8 THEN 'Agustus' WHEN 9 THEN 'September'
        WHEN 10 THEN 'Oktober' WHEN 11 THEN 'November' WHEN 12 THEN 'Desember'
      END || ' ' || COALESCE(to_char(v_tahun.tanggal_mulai, 'YYYY'), v_tahun.nama, '')
    );
  END IF;

  v_description := COALESCE(v_jenis.nama, 'Pembayaran') ||
    CASE WHEN v_period_label IS NOT NULL AND v_period_label <> ''
      THEN ' (' || upper(v_period_label) || ')'
      ELSE ''
    END;

  SELECT COALESCE(MAX(line_no), 0) + 1
  INTO v_line
  FROM public.payment_receipt_items
  WHERE receipt_id = p_receipt_id;

  INSERT INTO public.payment_receipt_items(
    receipt_id, line_no, payment_id,
    siswa_id, jenis_id, tagihan_id, tahun_ajaran_id, bulan,
    student_name, student_nis, student_nisn,
    payment_type_name, department_name, period_label, description,
    amount, status
  )
  VALUES (
    p_receipt_id, v_line, p_payment_id,
    v_payment.siswa_id, v_payment.jenis_id, v_payment.tagihan_id,
    COALESCE(v_tagihan.tahun_ajaran_id, v_payment.tahun_ajaran_id),
    COALESCE(v_tagihan.bulan, v_payment.bulan),
    COALESCE(NULLIF(btrim(v_siswa.nama), ''), 'Siswa'),
    NULLIF(btrim(v_siswa.nis), ''), NULLIF(btrim(v_siswa.nisn), ''),
    COALESCE(NULLIF(btrim(v_jenis.nama), ''), 'Pembayaran'),
    NULLIF(btrim(v_departemen.nama), ''),
    NULLIF(v_period_label, ''), v_description,
    v_payment.jumlah, 'paid'
  );

  UPDATE public.payment_receipts
  SET total_amount = total_amount + v_payment.jumlah,
      updated_at = now()
  WHERE id = p_receipt_id;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'line_no', v_line
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.append_payment_receipt_item(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_payment_receipt_item(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_dengan_kuitansi_atomik(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_bulan integer,
  p_jumlah numeric,
  p_tanggal_bayar date,
  p_keterangan text,
  p_departemen_id uuid,
  p_tahun_ajaran_id uuid,
  p_is_bayar_dimuka boolean,
  p_tagihan_id uuid,
  p_kas_akun_id uuid,
  p_kredit_akun_id uuid,
  p_kredit_label text,
  p_prefix_jurnal text,
  p_petugas_id uuid,
  p_jenis_nama text,
  p_receipt_id uuid DEFAULT NULL,
  p_source text DEFAULT 'cashier',
  p_payment_method text DEFAULT 'Tunai'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_receipt_id uuid;
  v_receipt_number text;
  v_result jsonb;
  v_payment_id uuid;
BEGIN
  v_receipt_id := public.ensure_payment_receipt(
    p_receipt_id,
    p_source,
    NULL,
    p_tanggal_bayar,
    p_payment_method,
    p_petugas_id,
    NULL,
    p_departemen_id
  );

  SELECT public.proses_pembayaran_atomik(
    p_siswa_id, p_jenis_id, p_bulan, p_jumlah, p_tanggal_bayar,
    p_keterangan, p_departemen_id, p_tahun_ajaran_id,
    p_is_bayar_dimuka, p_tagihan_id, p_kas_akun_id,
    p_kredit_akun_id, p_kredit_label, p_prefix_jurnal,
    p_petugas_id, p_jenis_nama
  ) INTO v_result;

  v_payment_id := (v_result->>'pembayaran_id')::uuid;
  PERFORM public.append_payment_receipt_item(v_receipt_id, v_payment_id);

  SELECT receipt_number INTO v_receipt_number
  FROM public.payment_receipts WHERE id = v_receipt_id;

  RETURN v_result || jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.proses_pembayaran_dengan_kuitansi_atomik(
  uuid, uuid, integer, numeric, date, text, uuid, uuid,
  boolean, uuid, uuid, uuid, text, text, uuid, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proses_pembayaran_dengan_kuitansi_atomik(
  uuid, uuid, integer, numeric, date, text, uuid, uuid,
  boolean, uuid, uuid, uuid, text, text, uuid, text, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.proses_pembayaran_midtrans_dengan_kuitansi_atomik(
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
SET search_path TO public
AS $function$
DECLARE
  v_receipt_id uuid;
  v_receipt_number text;
  v_result jsonb;
  v_payment_id uuid;
  v_payer_user_id uuid;
BEGIN
  SELECT user_id INTO v_payer_user_id
  FROM public.transaksi_midtrans
  WHERE order_id = p_order_id;

  v_receipt_id := public.ensure_payment_receipt(
    NULL,
    'midtrans',
    p_order_id,
    p_tanggal_bayar,
    p_payment_type,
    NULL,
    v_payer_user_id,
    p_departemen_id
  );

  SELECT public.proses_pembayaran_midtrans_atomik(
    p_transaksi_item_id, p_siswa_id, p_jenis_id, p_bulan,
    p_jumlah, p_tanggal_bayar, p_departemen_id,
    p_tahun_ajaran_id, p_order_id, p_payment_type,
    p_kas_akun_id, p_kredit_akun_id, p_jenis_nama
  ) INTO v_result;

  v_payment_id := (v_result->>'pembayaran_id')::uuid;
  PERFORM public.append_payment_receipt_item(v_receipt_id, v_payment_id);

  SELECT receipt_number INTO v_receipt_number
  FROM public.payment_receipts WHERE id = v_receipt_id;

  RETURN v_result || jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.proses_pembayaran_midtrans_dengan_kuitansi_atomik(
  uuid, uuid, uuid, integer, numeric, date, uuid, uuid,
  text, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proses_pembayaran_midtrans_dengan_kuitansi_atomik(
  uuid, uuid, uuid, integer, numeric, date, uuid, uuid,
  text, text, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.batalkan_pembayaran_dengan_kuitansi_atomik(
  p_pembayaran_id uuid,
  p_alasan text,
  p_tanggal date,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_item_id uuid;
  v_receipt_id uuid;
  v_result jsonb;
  v_paid_count integer;
  v_receipt_status text;
BEGIN
  SELECT id, receipt_id
  INTO v_item_id, v_receipt_id
  FROM public.payment_receipt_items
  WHERE payment_id = p_pembayaran_id
  FOR UPDATE;

  SELECT public.batalkan_pembayaran_atomik(
    p_pembayaran_id, p_alasan, p_tanggal, p_user_id
  ) INTO v_result;

  IF v_item_id IS NOT NULL THEN
    UPDATE public.payment_receipt_items
    SET status = 'void',
        voided_at = now(),
        voided_by_user_id = p_user_id,
        void_reason = p_alasan
    WHERE id = v_item_id;

    SELECT COUNT(*) FILTER (WHERE status = 'paid')
    INTO v_paid_count
    FROM public.payment_receipt_items
    WHERE receipt_id = v_receipt_id;

    v_receipt_status := CASE
      WHEN v_paid_count = 0 THEN 'void'
      ELSE 'partial_void'
    END;

    UPDATE public.payment_receipts
    SET status = v_receipt_status,
        updated_at = now()
    WHERE id = v_receipt_id;

    v_result := v_result || jsonb_build_object(
      'receipt_id', v_receipt_id,
      'receipt_status', v_receipt_status
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.batalkan_pembayaran_dengan_kuitansi_atomik(uuid, text, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batalkan_pembayaran_dengan_kuitansi_atomik(uuid, text, date, uuid)
  TO service_role;

COMMENT ON TABLE public.payment_receipts IS
  'Header kuitansi immutable untuk mengelompokkan satu atau banyak pembayaran dalam satu sesi pembayaran.';
COMMENT ON TABLE public.payment_receipt_items IS
  'Snapshot item kuitansi. Tetap disimpan walaupun baris pembayaran dibatalkan/dihapus agar histori kuitansi dapat diaudit.';
