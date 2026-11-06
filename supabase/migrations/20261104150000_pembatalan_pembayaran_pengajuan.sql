-- Pengajuan & persetujuan pembatalan pembayaran.
--
-- * Kasir/keuangan (izin `keuangan.pembatalan.ajukan`) tidak membatalkan langsung:
--   mereka mengajukan, lalu satu pemegang `keuangan.pembatalan.setujui`
--   (bendahara/sekretaris/admin) menyetujui atau menolak. Pengaju tidak dapat
--   menyetujui pengajuannya sendiri. Admin tetap dapat membatalkan langsung
--   lewat alur lama (tidak berubah).
-- * Pembatalan memakai fungsi atomik yang sama dengan sekarang
--   (`batalkan_pembayaran_dengan_kuitansi_atomik`): jurnal pembalik, pemulihan
--   tagihan, dan kuitansi void. Persetujuan dan pembatalan berlangsung dalam satu
--   transaksi; bila pembatalan gagal (mis. periode ditutup) pengajuan tetap menunggu.
-- * Pembatalan menghapus baris `pembayaran`, jadi `pembayaran_id` sengaja tanpa FK
--   dan ringkasan pembayaran disimpan sebagai snapshot agar riwayat tetap terbaca.
-- * Tabel tertutup untuk klien (hanya service_role); semua akses lewat server function.
--   Baris tidak dapat dihapus dan keputusan bersifat final.
--
-- Mengembalikan ke keadaan lama (bila perlu; pastikan tidak ada pengajuan menunggu):
--   DROP FUNCTION public.ajukan_pembatalan_pembayaran(uuid,text,uuid),
--     public.setujui_pembatalan_pembayaran(uuid,uuid,date,text),
--     public.tolak_pembatalan_pembayaran(uuid,uuid,text),
--     public.batalkan_pengajuan_pembatalan(uuid,uuid),
--     public.guard_pembatalan_pengajuan();
--   DROP TABLE public.pembatalan_pembayaran_pengajuan;
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

CREATE TABLE IF NOT EXISTS public.pembatalan_pembayaran_pengajuan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pembayaran_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  alasan text NOT NULL CHECK (length(btrim(alasan)) >= 5),
  status text NOT NULL DEFAULT 'menunggu'
    CHECK (status IN ('menunggu','disetujui','ditolak','dibatalkan')),
  diajukan_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  diajukan_at timestamptz NOT NULL DEFAULT now(),
  diputuskan_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  diputuskan_at timestamptz,
  catatan_keputusan text,
  tanggal_pembatalan date,
  jurnal_pembalik_id uuid,
  CHECK (status = 'menunggu' OR diputuskan_oleh IS NOT NULL OR diputuskan_at IS NOT NULL)
);
-- Catatan: CHECK di atas memakai OR agar pemutus yang akunnya kelak dihapus (SET NULL) tidak
-- membuat baris final melanggar constraint; waktu keputusan tetap tercatat.

CREATE UNIQUE INDEX IF NOT EXISTS pembatalan_pengajuan_satu_menunggu
  ON public.pembatalan_pembayaran_pengajuan (pembayaran_id) WHERE status = 'menunggu';
CREATE INDEX IF NOT EXISTS pembatalan_pengajuan_status_idx
  ON public.pembatalan_pembayaran_pengajuan (status, diajukan_at DESC);

ALTER TABLE public.pembatalan_pembayaran_pengajuan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pembatalan_pembayaran_pengajuan FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pembatalan_pembayaran_pengajuan TO service_role;

CREATE OR REPLACE FUNCTION public.guard_pembatalan_pengajuan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pengajuan pembatalan tidak dapat dihapus';
  END IF;
  IF OLD.status <> 'menunggu' THEN
    RAISE EXCEPTION 'Pengajuan pembatalan yang sudah diputuskan tidak dapat diubah';
  END IF;
  IF NEW.pembayaran_id IS DISTINCT FROM OLD.pembayaran_id
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.alasan IS DISTINCT FROM OLD.alasan
     OR NEW.diajukan_oleh IS DISTINCT FROM OLD.diajukan_oleh
     OR NEW.diajukan_at IS DISTINCT FROM OLD.diajukan_at THEN
    RAISE EXCEPTION 'Isi pengajuan pembatalan tidak dapat diubah';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_pembatalan_pengajuan ON public.pembatalan_pembayaran_pengajuan;
CREATE TRIGGER trg_guard_pembatalan_pengajuan
  BEFORE UPDATE OR DELETE ON public.pembatalan_pembayaran_pengajuan
  FOR EACH ROW EXECUTE FUNCTION public.guard_pembatalan_pengajuan();

CREATE OR REPLACE FUNCTION public.ajukan_pembatalan_pembayaran(
  p_pembayaran_id uuid,
  p_alasan text,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_alasan text;
  v_pb public.pembayaran;
  v_siswa_nama text;
  v_siswa_nis text;
  v_jenis_nama text;
  v_kuitansi text;
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT public.has_permission(p_actor_id, 'keuangan.pembatalan.ajukan') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  v_alasan := btrim(COALESCE(p_alasan, ''));
  IF length(v_alasan) < 5 THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi minimal 5 karakter';
  END IF;

  SELECT * INTO v_pb FROM public.pembayaran WHERE id = p_pembayaran_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pembayaran tidak ditemukan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pembatalan_pembayaran_pengajuan
    WHERE pembayaran_id = p_pembayaran_id AND status = 'menunggu'
  ) THEN
    RAISE EXCEPTION 'Pembayaran ini sudah memiliki pengajuan pembatalan yang menunggu keputusan';
  END IF;

  SELECT s.nama, s.nis INTO v_siswa_nama, v_siswa_nis FROM public.siswa s WHERE s.id = v_pb.siswa_id;
  SELECT j.nama INTO v_jenis_nama FROM public.jenis_pembayaran j WHERE j.id = v_pb.jenis_id;
  SELECT r.receipt_number INTO v_kuitansi
  FROM public.payment_receipt_items i
  JOIN public.payment_receipts r ON r.id = i.receipt_id
  WHERE i.payment_id = p_pembayaran_id
  LIMIT 1;

  INSERT INTO public.pembatalan_pembayaran_pengajuan (pembayaran_id, snapshot, alasan, diajukan_oleh)
  VALUES (
    p_pembayaran_id,
    jsonb_build_object(
      'siswa_id', v_pb.siswa_id,
      'siswa_nama', v_siswa_nama,
      'siswa_nis', v_siswa_nis,
      'jenis_id', v_pb.jenis_id,
      'jenis_nama', v_jenis_nama,
      'bulan', v_pb.bulan,
      'jumlah', v_pb.jumlah,
      'tanggal_bayar', v_pb.tanggal_bayar,
      'keterangan', v_pb.keterangan,
      'petugas_id', v_pb.petugas_id,
      'tagihan_id', v_pb.tagihan_id,
      'nomor_kuitansi', v_kuitansi
    ),
    v_alasan,
    p_actor_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.setujui_pembatalan_pembayaran(
  p_pengajuan_id uuid,
  p_actor_id uuid,
  p_tanggal date,
  p_catatan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.pembatalan_pembayaran_pengajuan;
  v_tanggal date;
  v_result jsonb;
  v_jurnal uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT public.has_permission(p_actor_id, 'keuangan.pembatalan.setujui') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO v_row FROM public.pembatalan_pembayaran_pengajuan WHERE id = p_pengajuan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan';
  END IF;
  IF v_row.status <> 'menunggu' THEN
    RAISE EXCEPTION 'Pengajuan sudah diputuskan';
  END IF;
  IF v_row.diajukan_oleh = p_actor_id THEN
    RAISE EXCEPTION 'Pengaju tidak dapat menyetujui pengajuannya sendiri';
  END IF;

  v_tanggal := COALESCE(p_tanggal, current_date);

  -- Satu transaksi: bila pembatalan gagal (periode ditutup, pembayaran sudah tidak ada),
  -- seluruhnya dibatalkan dan pengajuan tetap menunggu.
  v_result := public.batalkan_pembayaran_dengan_kuitansi_atomik(
    v_row.pembayaran_id,
    'Pengajuan pembatalan disetujui: ' || v_row.alasan,
    v_tanggal,
    p_actor_id
  );
  v_jurnal := NULLIF(v_result ->> 'jurnal_pembalik_id', '')::uuid;

  UPDATE public.pembatalan_pembayaran_pengajuan
  SET status = 'disetujui',
      diputuskan_oleh = p_actor_id,
      diputuskan_at = now(),
      catatan_keputusan = NULLIF(btrim(COALESCE(p_catatan, '')), ''),
      tanggal_pembatalan = v_tanggal,
      jurnal_pembalik_id = v_jurnal
  WHERE id = p_pengajuan_id;

  RETURN jsonb_build_object('jurnal_pembalik_id', v_jurnal, 'tanggal', v_tanggal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tolak_pembatalan_pembayaran(
  p_pengajuan_id uuid,
  p_actor_id uuid,
  p_catatan text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.pembatalan_pembayaran_pengajuan;
  v_catatan text;
BEGIN
  IF p_actor_id IS NULL OR NOT public.has_permission(p_actor_id, 'keuangan.pembatalan.setujui') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  v_catatan := btrim(COALESCE(p_catatan, ''));
  IF length(v_catatan) < 5 THEN
    RAISE EXCEPTION 'Alasan penolakan wajib diisi minimal 5 karakter';
  END IF;

  SELECT * INTO v_row FROM public.pembatalan_pembayaran_pengajuan WHERE id = p_pengajuan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan';
  END IF;
  IF v_row.status <> 'menunggu' THEN
    RAISE EXCEPTION 'Pengajuan sudah diputuskan';
  END IF;
  IF v_row.diajukan_oleh = p_actor_id THEN
    RAISE EXCEPTION 'Pengaju tidak dapat memutuskan pengajuannya sendiri; gunakan batalkan pengajuan';
  END IF;

  UPDATE public.pembatalan_pembayaran_pengajuan
  SET status = 'ditolak', diputuskan_oleh = p_actor_id, diputuskan_at = now(), catatan_keputusan = v_catatan
  WHERE id = p_pengajuan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.batalkan_pengajuan_pembatalan(
  p_pengajuan_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.pembatalan_pembayaran_pengajuan;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  SELECT * INTO v_row FROM public.pembatalan_pembayaran_pengajuan WHERE id = p_pengajuan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan';
  END IF;
  IF v_row.diajukan_oleh <> p_actor_id AND NOT public.has_role(p_actor_id, 'admin') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF v_row.status <> 'menunggu' THEN
    RAISE EXCEPTION 'Pengajuan sudah diputuskan';
  END IF;

  UPDATE public.pembatalan_pembayaran_pengajuan
  SET status = 'dibatalkan', diputuskan_oleh = p_actor_id, diputuskan_at = now(),
      catatan_keputusan = CASE WHEN v_row.diajukan_oleh = p_actor_id THEN 'Dibatalkan oleh pengaju' ELSE 'Dibatalkan oleh admin' END
  WHERE id = p_pengajuan_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajukan_pembatalan_pembayaran(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajukan_pembatalan_pembayaran(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.setujui_pembatalan_pembayaran(uuid,uuid,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setujui_pembatalan_pembayaran(uuid,uuid,date,text) TO service_role;
REVOKE ALL ON FUNCTION public.tolak_pembatalan_pembayaran(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tolak_pembatalan_pembayaran(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.batalkan_pengajuan_pembatalan(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batalkan_pengajuan_pembatalan(uuid,uuid) TO service_role;
