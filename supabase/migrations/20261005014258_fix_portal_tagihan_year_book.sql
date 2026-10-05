-- Fix portal tagihan yang hilang setelah tagihan.tahun_ajaran_id berubah
-- menjadi foreign key ke tahun_buku. View lama masih JOIN ke tahun_ajaran.
--
-- Prinsip:
-- 1. tahun_ajaran_id yang diekspos view tetap ID Tahun Buku agar checkout lama
--    dan app mobile tetap mengirim identitas periode pembukuan yang benar.
-- 2. tahun_ajaran_nama/tahun_ajaran_mulai adalah metadata akademik Juli-Juni
--    untuk label dan pengelompokan UI. Gunakan tahun_akademik_id bila tersedia,
--    lalu fallback ke rentang tanggal tagihan.
-- 3. Jika tagihan belum menyimpan kelas_id (umum pada rencana siswa baru),
--    tampilkan kelas aktif siswa sebagai fallback tanpa mengubah data tagihan.
-- 4. Urutan kolom view dipertahankan persis agar CREATE OR REPLACE VIEW aman.

CREATE OR REPLACE VIEW public.v_tagihan_belum_bayar AS
SELECT
  t.siswa_id,
  s.nis,
  s.nama AS nama_siswa,
  s.jenis_kelamin,
  k.nama AS kelas_nama,
  d.id AS departemen_id,
  d.nama AS departemen_nama,
  d.kode AS departemen_kode,
  jp.id AS jenis_id,
  jp.nama AS jenis_nama,
  GREATEST(t.nominal - COALESCE(pay.total_bayar, 0), 0)::numeric(15,2) AS nominal,
  t.tahun_ajaran_id AS tahun_ajaran_id,
  COALESCE(
    ta.nama,
    'Tahun Ajaran '
      || EXTRACT(year FROM akademik.fallback_mulai)::integer::text
      || '/'
      || (EXTRACT(year FROM akademik.fallback_mulai)::integer + 1)::text
  ) AS tahun_ajaran_nama,
  COALESCE(t.bulan, 0) AS bulan,
  t.status = 'lunas' AS sudah_bayar,
  t.pembayaran_id,
  p.tanggal_bayar,
  COALESCE(ta.tanggal_mulai, akademik.fallback_mulai) AS tahun_ajaran_mulai,
  t.id AS tagihan_id,
  t.status,
  t.jatuh_tempo,
  t.status <> 'lunas'
    AND t.jatuh_tempo IS NOT NULL
    AND t.jatuh_tempo < CURRENT_DATE AS menunggak
FROM public.tagihan t
JOIN public.siswa s ON s.id = t.siswa_id
LEFT JOIN LATERAL (
  SELECT ks.kelas_id
  FROM public.kelas_siswa ks
  WHERE ks.siswa_id = t.siswa_id
    AND ks.aktif = true
  ORDER BY ks.id
  LIMIT 1
) kelas_aktif ON t.kelas_id IS NULL
LEFT JOIN public.kelas k
  ON k.id = COALESCE(t.kelas_id, kelas_aktif.kelas_id)
LEFT JOIN public.departemen d ON d.id = k.departemen_id
JOIN public.jenis_pembayaran jp ON jp.id = t.jenis_id
JOIN public.tahun_buku tb ON tb.id = t.tahun_ajaran_id
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN COALESCE(t.bulan, 0) BETWEEN 1 AND 6
      THEN make_date(
        EXTRACT(year FROM COALESCE(t.jatuh_tempo, tb.tanggal_mulai))::integer - 1,
        7,
        1
      )
    ELSE make_date(
      EXTRACT(year FROM COALESCE(t.jatuh_tempo, tb.tanggal_mulai))::integer,
      7,
      1
    )
  END AS fallback_mulai
) akademik
LEFT JOIN LATERAL (
  SELECT ta0.id, ta0.nama, ta0.tanggal_mulai
  FROM public.tahun_ajaran ta0
  WHERE ta0.id = t.tahun_akademik_id
     OR (
       t.tahun_akademik_id IS NULL
       AND t.jatuh_tempo IS NOT NULL
       AND t.jatuh_tempo BETWEEN ta0.tanggal_mulai AND ta0.tanggal_selesai
     )
  ORDER BY (ta0.id = t.tahun_akademik_id) DESC, ta0.tanggal_mulai DESC
  LIMIT 1
) ta ON true
LEFT JOIN public.pembayaran p ON p.id = t.pembayaran_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(px.jumlah), 0) AS total_bayar
  FROM public.pembayaran px
  WHERE px.tagihan_id = t.id
) pay ON true
WHERE s.status = 'aktif'
  AND t.status IN ('terjadwal', 'belum_bayar', 'sebagian', 'lunas');

ALTER VIEW public.v_tagihan_belum_bayar SET (security_invoker = true);
