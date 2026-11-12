-- Mengganti nama pada item kuitansi LAMA yang tagihannya kini berlabel (SALDO PIUTANG LAMA).
--
-- Keputusan pemilik sistem (12 Nov 2026): kuitansi lama ikut memakai label tagihan, bukan hanya
-- kuitansi baru. Hanya dua kolom teks pada payment_receipt_items yang berubah: payment_type_name
-- dan description. Jumlah, nomor kuitansi, tanggal, status, siswa, tagihan, pembayaran, dan total
-- kuitansi tidak disentuh. Item yang tagihannya tidak berlabel tidak disentuh.
--
-- Karena kuitansi adalah dokumen terbit, nama lama setiap item yang diubah disimpan di
-- migration.kuitansi_relabel_20261112 (RLS aktif tanpa kebijakan, tanpa hak untuk anon/authenticated).
--
-- Aman dijalankan ulang: baris audit tidak ditimpa, dan UPDATE hanya mengubah item yang masih
-- bernilai seperti nama lama di audit.
-- Rollback (mengembalikan nama lama persis):
--   UPDATE public.payment_receipt_items i
--   SET payment_type_name = a.old_payment_type_name, description = a.old_description
--   FROM migration.kuitansi_relabel_20261112 a
--   WHERE a.receipt_item_id = i.id AND i.payment_type_name = a.new_payment_type_name;

CREATE TABLE IF NOT EXISTS migration.kuitansi_relabel_20261112 (
  receipt_item_id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL,
  payment_id uuid,
  tagihan_id uuid,
  old_payment_type_name text NOT NULL,
  old_description text NOT NULL,
  new_payment_type_name text NOT NULL,
  new_description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE migration.kuitansi_relabel_20261112 ENABLE ROW LEVEL SECURITY;

INSERT INTO migration.kuitansi_relabel_20261112 (
  receipt_item_id, receipt_id, payment_id, tagihan_id,
  old_payment_type_name, old_description, new_payment_type_name, new_description
)
SELECT
  i.id, i.receipt_id, i.payment_id, i.tagihan_id,
  i.payment_type_name, i.description,
  btrim(t.label_tampil),
  btrim(t.label_tampil) || CASE
    WHEN NULLIF(i.period_label, '') IS NOT NULL THEN ' (' || upper(i.period_label) || ')'
    ELSE ''
  END
FROM public.payment_receipt_items i
JOIN public.tagihan t ON t.id = i.tagihan_id
WHERE NULLIF(btrim(t.label_tampil), '') IS NOT NULL
  AND i.payment_type_name IS DISTINCT FROM btrim(t.label_tampil)
ON CONFLICT (receipt_item_id) DO NOTHING;

UPDATE public.payment_receipt_items i
SET payment_type_name = a.new_payment_type_name,
    description = a.new_description
FROM migration.kuitansi_relabel_20261112 a
WHERE a.receipt_item_id = i.id
  AND i.payment_type_name = a.old_payment_type_name
  AND i.description = a.old_description;
