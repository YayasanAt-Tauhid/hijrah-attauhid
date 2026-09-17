BEGIN;

DO $$
DECLARE
  v_sid uuid;
  v_dept uuid;
  v_angkatan uuid;
  v_ta uuid;
  v_jenis uuid;
  v_tagihan record;
  v_readiness jsonb;
  v_total_debit numeric;
  v_total_kredit numeric;
  v_promo_debit numeric;
  v_pendapatan_kredit numeric;
  v_payment_count integer;
BEGIN
  SELECT d.id, a.id, ta.id, kp.jenis_pembayaran_id
  INTO v_dept, v_angkatan, v_ta, v_jenis
  FROM public.departemen d
  JOIN public.konfigurasi_pmb kp ON kp.departemen_id = d.id
  JOIN public.angkatan a
    ON a.departemen_id = d.id
   AND a.nama = 'Angkatan 2027'
   AND a.aktif = true
  CROSS JOIN LATERAL (
    SELECT id
    FROM public.tahun_ajaran
    WHERE nama = 'Tahun Ajaran 2027-2028'
    LIMIT 1
  ) ta
  WHERE d.kode = 'SD'
  LIMIT 1;

  IF v_dept IS NULL OR v_angkatan IS NULL OR v_ta IS NULL OR v_jenis IS NULL THEN
    RAISE EXCEPTION 'Test membutuhkan konfigurasi SPMB SD 2027/2028 yang lengkap';
  END IF;

  INSERT INTO public.siswa (
    nama, jenis_kelamin, agama, status, departemen_id, angkatan_id, created_at
  ) VALUES (
    '__TEST_PROMO_SPMB_ROLLBACK__', 'L', 'Islam', 'calon', v_dept, v_angkatan,
    timestamptz '2026-09-21 00:15:00+07'
  ) RETURNING id INTO v_sid;

  -- AFTER INSERT siswa_detail harus membukukan promo otomatis.
  INSERT INTO public.siswa_detail (
    siswa_id, tahun_ajaran_id, nik, kategori, jenis_pendaftaran
  ) VALUES (
    v_sid, v_ta, '9999999999999901', 'MURID BARU', 'baru'
  );

  SELECT t.* INTO v_tagihan
  FROM public.tagihan t
  WHERE t.siswa_id = v_sid
    AND t.jenis_id = v_jenis
    AND t.bulan IS NULL
  LIMIT 1;

  IF v_tagihan.id IS NULL THEN
    RAISE EXCEPTION 'Tagihan promo tidak terbentuk';
  END IF;
  IF v_tagihan.status <> 'lunas' THEN
    RAISE EXCEPTION 'Tagihan promo harus lunas, aktual %', v_tagihan.status;
  END IF;
  IF v_tagihan.nominal <> 0
     OR v_tagihan.nominal_bruto <> 300000
     OR v_tagihan.nominal_diskon <> 300000 THEN
    RAISE EXCEPTION 'Nominal promo salah: netto %, bruto %, diskon %',
      v_tagihan.nominal, v_tagihan.nominal_bruto, v_tagihan.nominal_diskon;
  END IF;
  IF v_tagihan.jurnal_piutang_id IS NULL THEN
    RAISE EXCEPTION 'Jurnal promo tidak terbentuk';
  END IF;

  SELECT COALESCE(sum(jd.debit), 0), COALESCE(sum(jd.kredit), 0)
  INTO v_total_debit, v_total_kredit
  FROM public.jurnal_detail jd
  WHERE jd.jurnal_id = v_tagihan.jurnal_piutang_id;

  IF v_total_debit <> 300000 OR v_total_kredit <> 300000 THEN
    RAISE EXCEPTION 'Jurnal promo tidak balance: D %, K %', v_total_debit, v_total_kredit;
  END IF;

  SELECT COALESCE(sum(jd.debit), 0)
  INTO v_promo_debit
  FROM public.jurnal_detail jd
  JOIN public.akun_rekening a ON a.id = jd.akun_id
  WHERE jd.jurnal_id = v_tagihan.jurnal_piutang_id
    AND a.kode = '4602';

  SELECT COALESCE(sum(jd.kredit), 0)
  INTO v_pendapatan_kredit
  FROM public.jurnal_detail jd
  JOIN public.akun_rekening a ON a.id = jd.akun_id
  WHERE jd.jurnal_id = v_tagihan.jurnal_piutang_id
    AND a.kode = '4104';

  IF v_promo_debit <> 300000 OR v_pendapatan_kredit <> 300000 THEN
    RAISE EXCEPTION 'Akun jurnal salah: D4602 %, K4104 %', v_promo_debit, v_pendapatan_kredit;
  END IF;

  SELECT count(*) INTO v_payment_count
  FROM public.pembayaran
  WHERE siswa_id = v_sid;
  IF v_payment_count <> 0 THEN
    RAISE EXCEPTION 'Promo tidak boleh membuat pembayaran kas/bank';
  END IF;

  v_readiness := public.spmb_readiness(v_sid);
  IF NOT COALESCE((v_readiness->>'gratis_pendaftaran')::boolean, false)
     OR NOT COALESCE((v_readiness->>'lunas')::boolean, false) THEN
    RAISE EXCEPTION 'Readiness tidak mengakui settlement promo: %', v_readiness;
  END IF;
END $$;

ROLLBACK;
SELECT 'PASS: promo SPMB dibukukan bruto/potongan/netto, tanpa kas, dan readiness mengakui settlement' AS result;
