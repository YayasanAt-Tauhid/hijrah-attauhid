-- Kuitansi baru memakai label tagihan (mis. rincian biaya lama pada SALDO PIUTANG LAMA).
--
-- Satu-satunya perubahan pada append_payment_receipt_item: payment_type_name dan description
-- memakai tagihan.label_tampil bila terisi (bukan kosong/spasi), jika tidak tetap nama jenis
-- seperti sebelumnya. Hanya berlaku untuk item kuitansi yang dibuat SETELAH migrasi ini;
-- item yang sudah ada tidak diubah (fungsi tetap mengembalikan item lama bila sudah ada).
-- payment_type_name hanya dibaca untuk menampilkan kuitansi (tidak ada view/laporan yang
-- mengelompokkan dengannya). Pemilik, ACL, SECURITY DEFINER, dan search_path tidak berubah.
-- Rollback: jalankan definisi lama (cadangan: append_payment_receipt_item_definisi_sebelum_20261112.sql).

CREATE OR REPLACE FUNCTION public.append_payment_receipt_item(p_receipt_id uuid, p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  v_description := COALESCE(NULLIF(btrim(v_tagihan.label_tampil), ''), v_jenis.nama, 'Pembayaran') ||
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
    COALESCE(NULLIF(btrim(v_tagihan.label_tampil), ''), NULLIF(btrim(v_jenis.nama), ''), 'Pembayaran'),
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
