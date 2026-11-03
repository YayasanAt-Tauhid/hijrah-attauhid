-- Biaya pendaftaran PMB/SPMB dibayar online tanpa tagihan (tidak ada baris di
-- public.tagihan), sedangkan guard_online_bill_session() (migrasi
-- 20261009000000) menolak SETIAP item transaksi_midtrans_item tanpa
-- tagihan_id: "Pilih tagihan sebelum membuat pembayaran online". Akibatnya
-- pmbCreatePayment gagal dan halaman pendaftaran macet di "Menyiapkan
-- pembayaran...".
--
-- Pengecualian sempit: item tanpa tagihan_id hanya lolos bila transaksi
-- induknya berorder HAT-PMB-% (dibuat server function pmbCreatePayment).
-- Item tagihan SPP tetap wajib ber-tagihan_id, dan seluruh pemeriksaan
-- sesi/saldo di bawahnya tidak berubah.
CREATE OR REPLACE FUNCTION public.guard_online_bill_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill public.tagihan; v_remaining numeric;
BEGIN
  IF NEW.tagihan_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.transaksi_midtrans t
      WHERE t.id = NEW.transaksi_id AND t.order_id LIKE 'HAT-PMB-%'
    ) THEN
      RETURN NEW;
    END IF;
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
