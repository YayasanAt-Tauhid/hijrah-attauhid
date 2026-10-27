-- Link pembayaran tagihan untuk orang tua yang tidak memakai aplikasi portal.
-- Dibuat oleh admin/keuangan/kasir, dibayar lewat Midtrans tanpa login.
--
-- Keamanan:
--  * Token mentah tidak pernah disimpan; hanya SHA-256 (hex) di token_hash.
--  * Tabel tertutup untuk anon/authenticated (RLS aktif tanpa policy). Semua akses
--    lewat server (service_role) yang memeriksa peran atau token.
--  * Link dibatasi satu siswa + daftar tagihan exact + masa berlaku.

CREATE TABLE IF NOT EXISTS public.payment_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  siswa_id uuid NOT NULL REFERENCES public.siswa(id),
  tagihan_ids uuid[] NOT NULL CHECK (cardinality(tagihan_ids) BETWEEN 1 AND 50),
  created_by uuid NOT NULL REFERENCES public.users_profile(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  canceled_at timestamptz,
  canceled_by uuid REFERENCES public.users_profile(id),
  CONSTRAINT payment_link_expiry_window CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '31 days'
  ),
  CONSTRAINT payment_link_cancel_pair CHECK ((canceled_at IS NULL) = (canceled_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_payment_link_siswa ON public.payment_link(siswa_id);
CREATE INDEX IF NOT EXISTS idx_payment_link_created_by ON public.payment_link(created_by, created_at DESC);

ALTER TABLE public.payment_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_link FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_link TO service_role;

COMMENT ON TABLE public.payment_link IS
  'Link pembayaran orang tua dari kasir/admin. Token hanya disimpan sebagai SHA-256; akses hanya via server.';

-- Sesi Midtrans yang dibuat lewat link dimiliki oleh link, bukan akun portal.
ALTER TABLE public.transaksi_midtrans
  ADD COLUMN IF NOT EXISTS payment_link_id uuid REFERENCES public.payment_link(id);

CREATE INDEX IF NOT EXISTS idx_transaksi_midtrans_payment_link
  ON public.transaksi_midtrans(payment_link_id) WHERE payment_link_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transaksi_midtrans_single_owner'
  ) THEN
    ALTER TABLE public.transaksi_midtrans
      ADD CONSTRAINT transaksi_midtrans_single_owner
      CHECK (user_id IS NULL OR payment_link_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.transaksi_midtrans.user_id IS
  'Akun portal orang tua. NULL untuk transaksi PMB publik dan transaksi melalui link pembayaran kasir/admin.';
COMMENT ON COLUMN public.transaksi_midtrans.payment_link_id IS
  'Link pembayaran pemilik sesi bila checkout dibuat dari halaman publik /bayar.';

-- Setara create_midtrans_checkout_atomik, tetapi otorisasi memakai link aktif:
-- link dikunci, wajib belum dibatalkan/kedaluwarsa, dan setiap item harus
-- tagihan milik siswa link serta termasuk daftar tagihan link.
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
