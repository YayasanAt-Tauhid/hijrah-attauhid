-- Cicilan pada link pembayaran orang tua.
-- Kasir/admin dapat menetapkan nominal cicilan per tagihan (mis. uang pangkal).
-- Tagihan tanpa entri tetap dilunasi penuh. Setelah cicilan terbayar lewat link,
-- link yang sama tidak dapat membayar tagihan itu lagi (perlu link baru).

ALTER TABLE public.payment_link
  ADD COLUMN IF NOT EXISTS cicilan jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_link_cicilan_object') THEN
    ALTER TABLE public.payment_link
      ADD CONSTRAINT payment_link_cicilan_object CHECK (jsonb_typeof(cicilan) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.payment_link.cicilan IS
  'Nominal cicilan per tagihan {tagihan_id: rupiah}. Tagihan tanpa entri dibayar sebesar sisa tagihan.';

-- RPC checkout link: sama seperti sebelumnya, ditambah validasi nominal per item.
CREATE OR REPLACE FUNCTION public.create_midtrans_link_checkout_atomik(
  p_link_id uuid, p_order_id text, p_items jsonb, p_expired_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_link public.payment_link%ROWTYPE; v_tx uuid; v_item jsonb; v_total numeric; v_balances jsonb;
BEGIN
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>50 THEN
    RAISE EXCEPTION 'Item pembayaran tidak valid';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE NULLIF(x->>'tagihan_id','') IS NULL) THEN
    RAISE EXCEPTION 'Akses tagihan ditolak';
  END IF;
  IF (SELECT count(DISTINCT x->>'tagihan_id') FROM jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Tagihan yang sama tidak boleh dipilih dua kali';
  END IF;

  SELECT * INTO v_link FROM public.payment_link WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR v_link.canceled_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'Link pembayaran sudah tidak berlaku';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    LEFT JOIN public.tagihan t ON t.id=(x->>'tagihan_id')::uuid
    WHERE t.id IS NULL
      OR t.siswa_id<>v_link.siswa_id
      OR (x->>'siswa_id')::uuid IS DISTINCT FROM v_link.siswa_id
      OR COALESCE(t.id = ANY(v_link.tagihan_ids), false) = false
  ) THEN
    RAISE EXCEPTION 'Akses tagihan ditolak';
  END IF;

  -- Semua jalur checkout/pembayaran serialisasi pada baris tagihan ini, urutan deterministik.
  PERFORM 1 FROM public.tagihan WHERE id IN (
    SELECT (x->>'tagihan_id')::uuid FROM jsonb_array_elements(p_items) x
  ) ORDER BY id FOR UPDATE;
  -- Nominal tiap item wajib tepat: sisa tagihan, atau (bila link menetapkan cicilan)
  -- nominal cicilan dikurangi yang sudah dibayar lewat link ini, dibatasi sisa tagihan.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    JOIN public.tagihan t ON t.id=(x->>'tagihan_id')::uuid
    CROSS JOIN LATERAL (
      SELECT t.nominal - COALESCE((SELECT sum(p.jumlah) FROM public.pembayaran p WHERE p.tagihan_id=t.id),0) AS sisa,
        COALESCE((SELECT sum(i.jumlah) FROM public.transaksi_midtrans_item i
          JOIN public.transaksi_midtrans m ON m.id=i.transaksi_id
          WHERE m.payment_link_id=p_link_id AND m.status='paid' AND i.tagihan_id=t.id),0) AS via_link
    ) s
    WHERE (x->>'jumlah')::numeric <= 0
      OR (x->>'jumlah')::numeric <> CASE
        WHEN v_link.cicilan ? t.id::text
          THEN LEAST((v_link.cicilan->>t.id::text)::numeric - s.via_link, s.sisa)
        ELSE s.sisa
      END
  ) THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak sesuai link';
  END IF;

  SELECT sum((x->>'jumlah')::numeric) INTO v_total FROM jsonb_array_elements(p_items) x;
  SELECT jsonb_object_agg(t.id::text,t.nominal-COALESCE(
    (SELECT sum(p.jumlah) FROM public.pembayaran p WHERE p.tagihan_id=t.id),0))
    INTO v_balances FROM public.tagihan t WHERE t.id IN
    (SELECT (x->>'tagihan_id')::uuid FROM jsonb_array_elements(p_items) x);
  INSERT INTO public.transaksi_midtrans(order_id,user_id,payment_link_id,total_amount,biaya_admin,status,expired_at,metadata)
  VALUES(p_order_id,NULL,p_link_id,v_total,0,'pending',p_expired_at,
    jsonb_build_object('bill_balances',v_balances,'payment_link_id',p_link_id)) RETURNING id INTO v_tx;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.transaksi_midtrans_item(transaksi_id,tagihan_id,siswa_id,jenis_id,bulan,jumlah,nama_item,departemen_id,tahun_ajaran_id)
    VALUES(v_tx,(v_item->>'tagihan_id')::uuid,(v_item->>'siswa_id')::uuid,(v_item->>'jenis_id')::uuid,
      (v_item->>'bulan')::integer,(v_item->>'jumlah')::numeric,v_item->>'nama_item',
      (v_item->>'departemen_id')::uuid,(v_item->>'tahun_ajaran_id')::uuid);
  END LOOP;
  RETURN jsonb_build_object('id',v_tx,'metadata',jsonb_build_object('bill_balances',v_balances,'payment_link_id',p_link_id));
END $$;
REVOKE ALL ON FUNCTION public.create_midtrans_link_checkout_atomik(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_midtrans_link_checkout_atomik(uuid,text,jsonb,timestamptz) TO service_role;
