-- Label tampilan per tagihan "SALDO PIUTANG LAMA".
--
-- Tagihan saldo piutang lama memakai satu jenis per lembaga ("SALDO PIUTANG LAMA SMA", dst.),
-- sehingga nama biaya aslinya dari aplikasi lama tidak terlihat. Migrasi ini hanya menambah
-- satu kolom nullable `label_tampil` dan mengisinya dari migration.legacy_tagihan_snapshot
-- (terhubung lewat target_tagihan_id).
--
-- Tidak mengubah nominal, status, jurnal, ataupun pembayaran. Tagihan lain tetap NULL, dan
-- aplikasi memakai nama jenis bila label kosong. Aman dijalankan ulang (hanya mengisi yang NULL).
-- Rollback: ALTER TABLE public.tagihan DROP COLUMN label_tampil;

ALTER TABLE public.tagihan ADD COLUMN IF NOT EXISTS label_tampil text;

COMMENT ON COLUMN public.tagihan.label_tampil IS
  'Nama tampilan opsional. Bila terisi, dipakai menggantikan nama jenis pembayaran (mis. rincian biaya lama pada SALDO PIUTANG LAMA).';

WITH n AS (
  SELECT
    l.target_tagihan_id AS id,
    btrim(
      regexp_replace(
        regexp_replace(
          l.source_name,
          '[[:space:]]*\([[:space:]]*[^()]*[0-9]{4}[[:space:]]*\)[[:space:]]*$',
          '',
          'i'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ) AS nama,
    min(l.source_ordinal) AS ord
  FROM migration.legacy_tagihan_snapshot l
  WHERE l.target_tagihan_id IS NOT NULL
  GROUP BY 1, 2
), a AS (
  SELECT id, count(*) AS n_nama, (array_agg(nama ORDER BY ord, nama)) AS arr
  FROM n
  GROUP BY id
)
UPDATE public.tagihan t
SET label_tampil = 'SALDO PIUTANG LAMA – ' || CASE
      WHEN a.n_nama = 1 THEN a.arr[1]
      WHEN a.n_nama = 2 THEN a.arr[1] || ' + ' || a.arr[2]
      ELSE a.arr[1] || ' + ' || a.arr[2] || ' +' || (a.n_nama - 2) || ' LAINNYA'
    END
FROM a, public.jenis_pembayaran jp
WHERE t.id = a.id
  AND jp.id = t.jenis_id
  AND jp.nama ILIKE 'SALDO PIUTANG LAMA%'
  AND t.status <> 'dibatalkan'
  AND t.label_tampil IS NULL;
