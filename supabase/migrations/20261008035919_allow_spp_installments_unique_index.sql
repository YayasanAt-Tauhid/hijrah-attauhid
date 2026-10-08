-- SPP supports multiple payments against one exact bill. The old period-wide
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
