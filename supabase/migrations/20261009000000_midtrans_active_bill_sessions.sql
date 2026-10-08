
-- One live gateway session per bill, shared by web/mobile/cashier.
ALTER TABLE public.transaksi_midtrans
  ADD COLUMN IF NOT EXISTS gateway_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_error text;

CREATE INDEX IF NOT EXISTS transaksi_item_bill_session_idx
  ON public.transaksi_midtrans_item(tagihan_id, transaksi_id) WHERE tagihan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transaksi_gateway_reconciliation_idx
  ON public.transaksi_midtrans(reconciliation_checked_at NULLS FIRST)
  WHERE gateway_closed_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_online_bill_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.tagihan; v_remaining numeric;
BEGIN
  IF NEW.tagihan_id IS NULL THEN
    RAISE EXCEPTION 'Pilih tagihan sebelum membuat pembayaran online';
  END IF;
  SELECT * INTO STRICT v_bill FROM public.tagihan WHERE id=NEW.tagihan_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans t ON t.id=i.transaksi_id
    WHERE i.tagihan_id=NEW.tagihan_id AND i.id IS DISTINCT FROM NEW.id
      AND (t.status='pending' OR (t.status='paid' AND i.pembayaran_id IS NULL)
        OR (t.status<>'paid' AND t.snap_token IS NOT NULL AND t.gateway_closed_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'Masih ada transaksi online aktif atau sedang dicatat untuk tagihan ini. Silakan coba lagi.';
  END IF;
  SELECT v_bill.nominal-COALESCE(SUM(p.jumlah),0) INTO v_remaining
    FROM public.pembayaran p WHERE p.tagihan_id=NEW.tagihan_id;
  IF v_bill.status NOT IN ('belum_bayar','sebagian','terjadwal')
    OR NEW.jumlah IS NULL OR NEW.jumlah<=0 OR NEW.jumlah>v_remaining OR NEW.jumlah<>trunc(NEW.jumlah)
    OR NEW.siswa_id<>v_bill.siswa_id OR NEW.jenis_id<>v_bill.jenis_id
    OR NULLIF(NEW.bulan,0) IS DISTINCT FROM v_bill.bulan THEN
    RAISE EXCEPTION 'Saldo tagihan berubah atau item tidak valid. Muat ulang tagihan.';
  END IF;
  IF v_bill.bulan IS NOT NULL AND NEW.jumlah<>v_remaining THEN
    RAISE EXCEPTION 'Tagihan bulanan harus dibayar penuh';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_online_bill_session() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_online_bill_session
BEFORE INSERT OR UPDATE OF tagihan_id, transaksi_id, jumlah ON public.transaksi_midtrans_item
FOR EACH ROW EXECUTE FUNCTION public.guard_online_bill_session();

CREATE OR REPLACE FUNCTION public.create_midtrans_checkout_atomik(
  p_user_id uuid, p_order_id text, p_items jsonb, p_expired_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tx uuid; v_item jsonb; v_total numeric; v_balances jsonb;
BEGIN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>50 THEN
    RAISE EXCEPTION 'Item pembayaran tidak valid';
  END IF;
  IF (SELECT count(DISTINCT x->>'tagihan_id') FROM jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Tagihan yang sama tidak boleh dipilih dua kali';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
    WHERE NOT EXISTS (SELECT 1 FROM public.ortu_siswa o WHERE o.user_id=p_user_id AND o.siswa_id=(x->>'siswa_id')::uuid)) THEN
    RAISE EXCEPTION 'Akses tagihan ditolak';
  END IF;
  -- All checkout/payment paths serialize on these rows, in deterministic order.
  PERFORM 1 FROM public.tagihan WHERE id IN (
    SELECT (x->>'tagihan_id')::uuid FROM jsonb_array_elements(p_items) x
  ) ORDER BY id FOR UPDATE;
  SELECT sum((x->>'jumlah')::numeric) INTO v_total FROM jsonb_array_elements(p_items) x;
  SELECT jsonb_object_agg(t.id::text,t.nominal-COALESCE(
    (SELECT sum(p.jumlah) FROM public.pembayaran p WHERE p.tagihan_id=t.id),0))
    INTO v_balances FROM public.tagihan t WHERE t.id IN
    (SELECT (x->>'tagihan_id')::uuid FROM jsonb_array_elements(p_items) x);
  INSERT INTO public.transaksi_midtrans(order_id,user_id,total_amount,biaya_admin,status,expired_at,metadata)
  VALUES(p_order_id,p_user_id,v_total,0,'pending',p_expired_at,
    jsonb_build_object('bill_balances',v_balances)) RETURNING id INTO v_tx;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.transaksi_midtrans_item(transaksi_id,tagihan_id,siswa_id,jenis_id,bulan,jumlah,nama_item,departemen_id,tahun_ajaran_id)
    VALUES(v_tx,(v_item->>'tagihan_id')::uuid,(v_item->>'siswa_id')::uuid,(v_item->>'jenis_id')::uuid,
      (v_item->>'bulan')::integer,(v_item->>'jumlah')::numeric,v_item->>'nama_item',
      (v_item->>'departemen_id')::uuid,(v_item->>'tahun_ajaran_id')::uuid);
  END LOOP;
  RETURN jsonb_build_object('id',v_tx,'metadata',jsonb_build_object('bill_balances',v_balances));
END $$;
REVOKE ALL ON FUNCTION public.create_midtrans_checkout_atomik(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_midtrans_checkout_atomik(uuid,text,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_payment_against_online_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_online_item uuid; v_bill_id uuid;
BEGIN
  v_bill_id:=NEW.tagihan_id;
  -- Older manual callers omit the exact bill ID. Protect their matched bill too.
  IF v_bill_id IS NULL THEN
    SELECT id INTO v_bill_id FROM public.tagihan WHERE siswa_id=NEW.siswa_id AND jenis_id=NEW.jenis_id
      AND tahun_ajaran_id=NEW.tahun_ajaran_id AND bulan IS NOT DISTINCT FROM NEW.bulan
      ORDER BY id LIMIT 1;
  END IF;
  IF v_bill_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.tagihan WHERE id=v_bill_id FOR UPDATE;
  v_online_item:=NULLIF(current_setting('app.midtrans_item_id',true),'')::uuid;
  IF v_online_item IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans t ON t.id=i.transaksi_id
    WHERE i.id=v_online_item AND i.tagihan_id=v_bill_id AND i.siswa_id=NEW.siswa_id
      AND i.jenis_id=NEW.jenis_id AND i.jumlah=NEW.jumlah AND i.pembayaran_id IS NULL AND t.status='paid'
  ) THEN
    -- Book confirmed funds even if an older legacy session still needs closure.
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans t ON t.id=i.transaksi_id
    WHERE i.tagihan_id=v_bill_id AND (t.status='pending' OR (t.status='paid' AND i.pembayaran_id IS NULL)
      OR (t.status<>'paid' AND t.snap_token IS NOT NULL AND t.gateway_closed_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'Pembayaran online masih aktif atau sedang dicatat. Tutup sesi online sebelum pembayaran kasir.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_payment_against_online_session() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_payment_against_online_session BEFORE INSERT ON public.pembayaran
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_against_online_session();

-- Preserve the established bookkeeping logic; add item locking, strict identity,
-- idempotency and a transaction-local marker for the payment insertion guard.
DO $$
DECLARE v_definition text; v_oid oid;
BEGIN
  SELECT oid INTO STRICT v_oid FROM pg_proc WHERE proname='proses_pembayaran_midtrans_atomik'
    AND pronamespace='public'::regnamespace;
  v_definition:=pg_get_functiondef(v_oid);
  IF position('app.midtrans_item_id' in v_definition)=0 THEN
    v_definition:=replace(v_definition, E'BEGIN\n', E'BEGIN\n' || $inject$
  PERFORM 1 FROM public.transaksi_midtrans_item WHERE id=p_transaksi_item_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.transaksi_midtrans_item i JOIN public.transaksi_midtrans t ON t.id=i.transaksi_id
    WHERE i.id=p_transaksi_item_id AND t.order_id=p_order_id AND t.status='paid'
      AND i.siswa_id=p_siswa_id AND i.jenis_id=p_jenis_id AND i.jumlah=p_jumlah
      AND NULLIF(i.bulan,0) IS NOT DISTINCT FROM NULLIF(p_bulan,0)
  ) THEN RAISE EXCEPTION 'Item pembayaran online tidak sesuai atau belum berhasil'; END IF;
  SELECT pembayaran_id INTO v_pembayaran_id FROM public.transaksi_midtrans_item WHERE id=p_transaksi_item_id;
  IF v_pembayaran_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('pembayaran_id',p.id,'jurnal_id',p.jurnal_id,'nomor_jurnal',j.nomor)
      FROM public.pembayaran p LEFT JOIN public.jurnal j ON j.id=p.jurnal_id WHERE p.id=v_pembayaran_id);
  END IF;
$inject$);
    v_definition:=replace(v_definition,'  INSERT INTO public.pembayaran (',
      E'  PERFORM set_config(''app.midtrans_item_id'',p_transaksi_item_id::text,true);\n  INSERT INTO public.pembayaran (');
    v_definition:=replace(v_definition,'  RETURNING id INTO v_pembayaran_id;',
      E'  RETURNING id INTO v_pembayaran_id;\n  PERFORM set_config(''app.midtrans_item_id'','''',true);');
    EXECUTE v_definition;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_midtrans_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.status='paid' AND NEW.status<>'paid' THEN
    NEW.status:='paid'; NEW.paid_at:=OLD.paid_at;
    NEW.midtrans_payment_status:=OLD.midtrans_payment_status;
  ELSIF OLD.gateway_closed_at IS NOT NULL AND NEW.status='pending' THEN
    NEW.status:=OLD.status;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_midtrans_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_midtrans_status BEFORE UPDATE ON public.transaksi_midtrans
FOR EACH ROW EXECUTE FUNCTION public.guard_midtrans_status();

CREATE OR REPLACE FUNCTION public.get_midtrans_reconciliation_candidates()
RETURNS SETOF public.transaksi_midtrans LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT t.* FROM public.transaksi_midtrans t
  WHERE (t.gateway_closed_at IS NULL AND (t.status='pending' OR (t.status<>'paid' AND t.snap_token IS NOT NULL)))
    OR (t.status='paid' AND EXISTS(SELECT 1 FROM public.transaksi_midtrans_item i WHERE i.transaksi_id=t.id AND i.pembayaran_id IS NULL))
  ORDER BY t.reconciliation_checked_at NULLS FIRST,t.created_at LIMIT 8;
$$;
REVOKE ALL ON FUNCTION public.get_midtrans_reconciliation_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_midtrans_reconciliation_candidates() TO service_role;

-- The scheduler sends a short-lived HMAC, never the reusable secret or service key.
CREATE SCHEMA IF NOT EXISTS payment_private;
REVOKE ALL ON SCHEMA payment_private FROM PUBLIC,anon,authenticated;
CREATE TABLE payment_private.reconciliation_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
  last_run timestamptz
);
INSERT INTO payment_private.reconciliation_config(singleton) VALUES(true);
REVOKE ALL ON payment_private.reconciliation_config FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_midtrans_reconciliation(p_timestamp bigint,p_signature text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config payment_private.reconciliation_config;
BEGIN
  IF abs(extract(epoch FROM now())-p_timestamp)>60 THEN RETURN false; END IF;
  SELECT * INTO v_config FROM payment_private.reconciliation_config WHERE singleton FOR UPDATE;
  IF p_signature IS DISTINCT FROM encode(extensions.hmac(p_timestamp::text,v_config.secret,'sha256'),'hex')
    OR v_config.last_run>now()-interval '3 minutes' THEN RETURN false; END IF;
  UPDATE payment_private.reconciliation_config SET last_run=now() WHERE singleton;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_midtrans_reconciliation(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_midtrans_reconciliation(bigint,text) TO service_role;
CREATE OR REPLACE FUNCTION payment_private.request_reconciliation()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_timestamp bigint:=floor(extract(epoch FROM now())); v_signature text; v_request bigint;
BEGIN
  SELECT encode(extensions.hmac(v_timestamp::text,secret,'sha256'),'hex') INTO v_signature
    FROM payment_private.reconciliation_config WHERE singleton;
  SELECT net.http_post(url:='https://app.hijrah-attauhid.or.id/api/midtrans-reconcile',
    body:=jsonb_build_object('timestamp',v_timestamp,'signature',v_signature),
    headers:='{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds:=120000) INTO v_request;
  RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION payment_private.request_reconciliation() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('midtrans-reconciliation','*/5 * * * *','SELECT payment_private.request_reconciliation();');
-- Enable after the matching application deployment is verified.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='midtrans-reconciliation'), active := false);
