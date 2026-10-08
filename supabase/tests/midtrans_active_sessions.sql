
-- Isolated rollback assertions. No real gateway or student payment is created.
BEGIN;
DO $$
DECLARE v_bill public.tagihan; v_user uuid:=gen_random_uuid(); v_items jsonb; v_tx jsonb;
  v_tx_id uuid; v_item_id uuid; v_second jsonb; v_paid jsonb; v_repeat jsonb; v_count int;
BEGIN
  INSERT INTO public.tagihan(siswa_id,jenis_id,tahun_ajaran_id,bulan,nominal,status)
    VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),NULL,4200000,'sebagian') RETURNING * INTO v_bill;
  INSERT INTO public.ortu_siswa VALUES(v_user,v_bill.siswa_id);
  INSERT INTO public.jenis_pembayaran(id,nama,tipe,perlu_dimuka) VALUES(v_bill.jenis_id,'UANG PANGKAL TK','sekali',true);
  INSERT INTO public.siswa VALUES(v_bill.siswa_id,'Test Student');
  v_items:=jsonb_build_array(jsonb_build_object('tagihan_id',v_bill.id,'siswa_id',v_bill.siswa_id,
    'jenis_id',v_bill.jenis_id,'bulan',0,'jumlah',1000000,'nama_item','Test',
    'departemen_id',NULL,'tahun_ajaran_id',v_bill.tahun_ajaran_id));
  v_tx:=public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-ONE',v_items,now()+interval '24 hours');
  v_tx_id:=(v_tx->>'id')::uuid;
  SELECT id INTO v_item_id FROM public.transaksi_midtrans_item WHERE transaksi_id=v_tx_id;
  BEGIN
    PERFORM public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-TWO',v_items,now()+interval '24 hours');
    RAISE EXCEPTION 'TEST FAILED: duplicate checkout accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  IF EXISTS(SELECT 1 FROM public.transaksi_midtrans WHERE order_id='HAT-TEST-TWO') THEN
    RAISE EXCEPTION 'TEST FAILED: partial checkout row survived';
  END IF;
  BEGIN
    INSERT INTO public.pembayaran(tagihan_id,siswa_id,jenis_id,jumlah) VALUES(v_bill.id,v_bill.siswa_id,v_bill.jenis_id,1000000);
    RAISE EXCEPTION 'TEST FAILED: cashier bypass accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  UPDATE public.transaksi_midtrans SET status='paid',paid_at=now() WHERE id=v_tx_id;
  BEGIN
    PERFORM public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-TWO',v_items,now()+interval '24 hours');
    RAISE EXCEPTION 'TEST FAILED: unbooked settlement ignored';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  v_paid:=public.proses_pembayaran_midtrans_atomik(v_item_id,v_bill.siswa_id,v_bill.jenis_id,0,1000000,
    current_date,NULL,v_bill.tahun_ajaran_id,'HAT-TEST-ONE','qris',gen_random_uuid(),gen_random_uuid(),'UANG PANGKAL TK');
  v_repeat:=public.proses_pembayaran_midtrans_atomik(v_item_id,v_bill.siswa_id,v_bill.jenis_id,0,1000000,
    current_date,NULL,v_bill.tahun_ajaran_id,'HAT-TEST-ONE','qris',gen_random_uuid(),gen_random_uuid(),'UANG PANGKAL TK');
  IF v_repeat->>'pembayaran_id' IS DISTINCT FROM v_paid->>'pembayaran_id' THEN
    RAISE EXCEPTION 'TEST FAILED: duplicate webhook made a new payment';
  END IF;
  SELECT count(*) INTO v_count FROM public.pembayaran WHERE tagihan_id=v_bill.id;
  IF v_count<>1 THEN RAISE EXCEPTION 'TEST FAILED: payment count %',v_count; END IF;
  UPDATE public.transaksi_midtrans SET status='pending',paid_at=NULL WHERE id=v_tx_id;
  IF NOT EXISTS(SELECT 1 FROM public.transaksi_midtrans WHERE id=v_tx_id AND status='paid' AND paid_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TEST FAILED: paid status regressed';
  END IF;
  v_second:=public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-NEXT',v_items,now()+interval '24 hours');
  BEGIN
    PERFORM public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-DUP',v_items||v_items,now()+interval '24 hours');
    RAISE EXCEPTION 'TEST FAILED: duplicate bill selection accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  UPDATE public.transaksi_midtrans SET status='expired',gateway_closed_at=now() WHERE id=(v_second->>'id')::uuid;
  UPDATE public.transaksi_midtrans SET status='pending' WHERE id=(v_second->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM public.transaksi_midtrans WHERE id=(v_second->>'id')::uuid AND status='pending') THEN
    RAISE EXCEPTION 'TEST FAILED: closed session reopened';
  END IF;
  INSERT INTO public.pembayaran(tagihan_id,siswa_id,jenis_id,jumlah) VALUES(v_bill.id,v_bill.siswa_id,v_bill.jenis_id,2000000);
  BEGIN
    PERFORM public.create_midtrans_checkout_atomik(v_user,'HAT-TEST-OVER',
      jsonb_set(v_items,'{0,jumlah}','2000000'),now()+interval '24 hours');
    RAISE EXCEPTION 'TEST FAILED: stale balance accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  IF has_function_privilege('authenticated','public.create_midtrans_checkout_atomik(uuid,text,jsonb,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: public checkout RPC privilege';
  END IF;
END $$;
ROLLBACK;
