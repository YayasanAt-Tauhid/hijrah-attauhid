CREATE OR REPLACE FUNCTION pg_temp.verify_spp_installment_fix()
RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE
  v_bill public.tagihan;
  v_first public.pembayaran;
  v_remaining numeric;
  v_paid numeric;
  v_kas uuid;
  v_piutang uuid;
  v_result jsonb;
  v_test_result jsonb;
  v_before_count bigint;
  v_before_sum numeric;
  v_had_guard boolean;
  v_non_spp public.pembayaran;
BEGIN
  SELECT count(*),sum(jumlah) INTO v_before_count,v_before_sum FROM public.pembayaran;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_spp_installment_payment') INTO v_had_guard;
  BEGIN
    IF NOT v_had_guard THEN
      EXECUTE $migration$-- SPP supports multiple payments against one exact bill. The old period-wide
-- unique index rejected the second installment even when the bill was unpaid.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_spp_installment_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_is_spp boolean;
  v_tagihan public.tagihan;
  v_total numeric;
BEGIN
  SELECT jp.tipe = 'bulanan'
    AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)'
  INTO v_is_spp
  FROM public.jenis_pembayaran jp WHERE jp.id = NEW.jenis_id;
  IF NOT COALESCE(v_is_spp, false) THEN
    RETURN NEW;
  END IF;

  -- Serialize cash and online installments on the same bill. The atomic
  -- payment RPC already locks this row; this also protects direct inserts.
  SELECT * INTO v_tagihan
  FROM public.tagihan WHERE id = NEW.tagihan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pembayaran SPP wajib terhubung ke tagihan yang tersedia';
  END IF;
  IF v_tagihan.siswa_id IS DISTINCT FROM NEW.siswa_id
     OR v_tagihan.jenis_id IS DISTINCT FROM NEW.jenis_id
     OR v_tagihan.bulan IS DISTINCT FROM NEW.bulan THEN
    RAISE EXCEPTION 'Tagihan tidak sesuai dengan siswa, jenis, atau periode pembayaran';
  END IF;
  IF v_tagihan.status NOT IN ('belum_bayar', 'sebagian', 'terjadwal') THEN
    RAISE EXCEPTION 'Tagihan sudah lunas atau tidak dapat dibayar';
  END IF;
  IF NEW.jumlah IS NULL OR NEW.jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
  END IF;
  SELECT COALESCE(SUM(p.jumlah), 0) INTO v_total
  FROM public.pembayaran p WHERE p.tagihan_id = v_tagihan.id;
  IF NEW.jumlah > v_tagihan.nominal - v_total THEN
    RAISE EXCEPTION 'Jumlah pembayaran melebihi sisa tagihan';
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger functions are invoked by the trigger, not exposed as public RPCs.
REVOKE ALL ON FUNCTION public.guard_spp_installment_payment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_spp_installment_payment
BEFORE INSERT ON public.pembayaran
FOR EACH ROW EXECUTE FUNCTION public.guard_spp_installment_payment();

-- Keep period lookup performance for installment payments as well.
CREATE INDEX IF NOT EXISTS idx_pembayaran_siswa_jenis_bulan_ta
ON public.pembayaran (siswa_id, jenis_id, bulan, tahun_ajaran_id)
WHERE bulan IS NOT NULL;

DROP INDEX public.uq_pembayaran_siswa_jenis_bulan_ta;
CREATE UNIQUE INDEX uq_pembayaran_siswa_jenis_bulan_ta
ON public.pembayaran (siswa_id, jenis_id, bulan, tahun_ajaran_id)
WHERE bulan IS NOT NULL AND (spp_kategori IS NULL OR tagihan_id IS NULL);
COMMENT ON INDEX public.uq_pembayaran_siswa_jenis_bulan_ta IS
'Single monthly payment except SPP installments linked to an exact bill; protected by guard_spp_installment_payment and immutable SPP snapshots.';
$migration$;
    END IF;
    SELECT t.* INTO STRICT v_bill FROM public.tagihan t
    WHERE t.status='sebagian' AND t.bulan IS NOT NULL
      AND t.spp_kategori IS NOT NULL AND t.jurnal_piutang_id IS NOT NULL
      AND t.nominal-(SELECT COALESCE(sum(p.jumlah),0) FROM public.pembayaran p WHERE p.tagihan_id=t.id)>1
    ORDER BY t.id LIMIT 1;
    SELECT * INTO STRICT v_first FROM public.pembayaran WHERE tagihan_id=v_bill.id LIMIT 1;
    SELECT v_bill.nominal-COALESCE(sum(jumlah),0) INTO v_remaining FROM public.pembayaran WHERE tagihan_id=v_bill.id;
    SELECT akun_id INTO v_kas FROM public.pengaturan_akun WHERE kode_setting='kas_tunai';
    SELECT akun_id INTO v_piutang FROM public.pengaturan_akun WHERE kode_setting='piutang_siswa';
    SELECT public.proses_pembayaran_dengan_kuitansi_atomik(
      v_bill.siswa_id,v_bill.jenis_id,v_bill.bulan,1,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,'ROLLBACK TEST',
      NULL,v_first.tahun_ajaran_id,false,v_bill.id,v_kas,v_piutang,
      'Piutang Siswa','JP',NULL,'SPP'
    ) INTO v_result;
    IF v_result->>'status_tagihan'<>'sebagian'
       OR (v_result->>'sisa_tagihan')::numeric<>v_remaining-1
       OR v_result->>'receipt_id' IS NULL OR v_result->>'jurnal_id' IS NULL THEN
      RAISE EXCEPTION 'Second installment assertion failed: %',v_result;
    END IF;
    BEGIN
      INSERT INTO public.pembayaran(siswa_id,jenis_id,tahun_ajaran_id,bulan,jumlah,tanggal_bayar,tagihan_id)
      VALUES(v_bill.siswa_id,v_bill.jenis_id,v_first.tahun_ajaran_id,v_bill.bulan,v_remaining,
             (now() AT TIME ZONE 'Asia/Jakarta')::date,v_bill.id);
      RAISE EXCEPTION 'Direct overpayment unexpectedly allowed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Jumlah pembayaran melebihi sisa tagihan' THEN RAISE; END IF;
    END;
    SELECT public.proses_pembayaran_dengan_kuitansi_atomik(
      v_bill.siswa_id,v_bill.jenis_id,v_bill.bulan,v_remaining-1,
      (now() AT TIME ZONE 'Asia/Jakarta')::date,'ROLLBACK TEST',
      NULL,v_first.tahun_ajaran_id,false,v_bill.id,v_kas,v_piutang,
      'Piutang Siswa','JP',NULL,'SPP'
    ) INTO v_result;
    IF v_result->>'status_tagihan'<>'lunas'
       OR (v_result->>'sisa_tagihan')::numeric<>0 THEN
      RAISE EXCEPTION 'Settlement assertion failed: %',v_result;
    END IF;
    SELECT COALESCE(sum(jumlah),0) INTO v_paid FROM public.pembayaran WHERE tagihan_id=v_bill.id;
    IF v_paid<>v_bill.nominal THEN RAISE EXCEPTION 'Payment total assertion failed'; END IF;
    BEGIN
      PERFORM public.proses_pembayaran_dengan_kuitansi_atomik(
        v_bill.siswa_id,v_bill.jenis_id,v_bill.bulan,1,
        (now() AT TIME ZONE 'Asia/Jakarta')::date,'ROLLBACK TEST',
        NULL,v_first.tahun_ajaran_id,false,v_bill.id,v_kas,v_piutang,
        'Piutang Siswa','JP',NULL,'SPP'
      );
      RAISE EXCEPTION 'Payment after settlement unexpectedly allowed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Tagihan sudah lunas atau tidak dapat dibayar' THEN RAISE; END IF;
    END;
    -- The existing snapshot trigger keeps non-SPP rows NULL, inside this index.
    IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='uq_pembayaran_siswa_jenis_bulan_ta'
      AND indexdef LIKE '%spp_kategori IS NULL%tagihan_id IS NULL%') THEN
      RAISE EXCEPTION 'Non-SPP unique protection assertion failed';
    END IF;
    SELECT p.* INTO v_non_spp
    FROM public.pembayaran p JOIN public.jenis_pembayaran jp ON jp.id=p.jenis_id
    WHERE p.bulan IS NOT NULL AND p.spp_kategori IS NULL
      AND NOT (jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)')
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Non-SPP fixture unavailable'; END IF;
    BEGIN
      INSERT INTO public.pembayaran(siswa_id,jenis_id,tahun_ajaran_id,bulan,jumlah,tanggal_bayar,tagihan_id)
      VALUES(v_non_spp.siswa_id,v_non_spp.jenis_id,v_non_spp.tahun_ajaran_id,
        v_non_spp.bulan,v_non_spp.jumlah,v_non_spp.tanggal_bayar,v_non_spp.tagihan_id);
      RAISE EXCEPTION 'Duplicate non-SPP payment unexpectedly allowed';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    v_test_result:=jsonb_build_object('second_installment',true,'settlement',true,
      'receipt_and_journal',true,'direct_overpayment_rejected',true,
      'paid_bill_rejected',true,'non_spp_unique_index_preserved',true,'non_spp_duplicate_rejected',true);
    RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='rollback successful verification';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN
    NULL;
  END;
  IF v_before_count<>(SELECT count(*) FROM public.pembayaran)
     OR v_before_sum IS DISTINCT FROM (SELECT sum(jumlah) FROM public.pembayaran)
     OR v_had_guard IS DISTINCT FROM EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_spp_installment_payment') THEN
    RAISE EXCEPTION 'Rollback verification failed';
  END IF;
  RETURN v_test_result || '{"test_changes_rolled_back":true}'::jsonb;
END;
$test$;
SELECT pg_temp.verify_spp_installment_fix() AS verification;