-- Portal orang tua: tampilkan label tagihan (mis. rincian biaya lama pada SALDO PIUTANG LAMA).
--
-- Menambah SATU kolom di ujung view: nama_tampil (= tagihan.label_tampil, boleh NULL).
-- Kolom lain, urutan, filter, dan logika tidak berubah. Kolom jenis_nama tetap nama jenis
-- (dipakai logika SPP/uang pangkal di portal), jadi hanya teks tampilan yang memakai nama_tampil.
-- Opsi security_invoker dan hak akses dipertahankan (CREATE OR REPLACE; opsi ditulis ulang eksplisit).
-- Rollback: CREATE OR REPLACE ulang tanpa kolom nama_tampil tidak bisa menghapus kolom;
-- gunakan DROP VIEW + buat ulang dari definisi lama (cadangan: pg_get_viewdef sebelum penerapan).

CREATE OR REPLACE VIEW public.v_tagihan_belum_bayar
WITH (security_invoker = true) AS
SELECT t.siswa_id,
    s.nis,
    s.nama AS nama_siswa,
    s.jenis_kelamin,
    k.nama AS kelas_nama,
    d.id AS departemen_id,
    d.nama AS departemen_nama,
    d.kode AS departemen_kode,
    jp.id AS jenis_id,
    jp.nama AS jenis_nama,
    GREATEST(t.nominal - COALESCE(pay.total_bayar, 0::numeric), 0::numeric)::numeric(15,2) AS nominal,
    t.tahun_ajaran_id,
    COALESCE(ta.nama, (('Tahun Ajaran '::text || EXTRACT(year FROM akademik.fallback_mulai)::integer::text) || '/'::text) || ((EXTRACT(year FROM akademik.fallback_mulai)::integer + 1)::text)) AS tahun_ajaran_nama,
    COALESCE(t.bulan, 0) AS bulan,
    t.status = 'lunas'::text AS sudah_bayar,
    t.pembayaran_id,
    p.tanggal_bayar,
    COALESCE(ta.tanggal_mulai, akademik.fallback_mulai) AS tahun_ajaran_mulai,
    t.id AS tagihan_id,
    t.status,
    t.jatuh_tempo,
    t.status <> 'lunas'::text AND t.jatuh_tempo IS NOT NULL AND t.jatuh_tempo < CURRENT_DATE AS menunggak,
    t.label_tampil AS nama_tampil
   FROM tagihan t
     JOIN siswa s ON s.id = t.siswa_id
     JOIN jenis_pembayaran jp ON jp.id = t.jenis_id
     LEFT JOIN LATERAL ( SELECT ks.kelas_id
           FROM kelas_siswa ks
             JOIN kelas kc ON kc.id = ks.kelas_id
          WHERE ks.siswa_id = t.siswa_id AND ks.aktif AND (t.tahun_akademik_id IS NULL OR ks.tahun_ajaran_id = t.tahun_akademik_id) AND (jp.departemen_id IS NULL OR kc.departemen_id = jp.departemen_id)
          ORDER BY ks.id
         LIMIT 1) kelas_aktif ON t.kelas_id IS NULL
     LEFT JOIN kelas k ON k.id = COALESCE(t.kelas_id, kelas_aktif.kelas_id) AND (jp.departemen_id IS NULL OR k.departemen_id = jp.departemen_id)
     LEFT JOIN departemen d ON d.id = COALESCE(jp.departemen_id, k.departemen_id, s.departemen_id)
     JOIN tahun_buku tb ON tb.id = t.tahun_ajaran_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN COALESCE(t.bulan, 0) >= 1 AND COALESCE(t.bulan, 0) <= 6 THEN make_date(EXTRACT(year FROM COALESCE(t.jatuh_tempo, tb.tanggal_mulai))::integer - 1, 7, 1)
                    ELSE make_date(EXTRACT(year FROM COALESCE(t.jatuh_tempo, tb.tanggal_mulai))::integer, 7, 1)
                END AS fallback_mulai) akademik
     LEFT JOIN LATERAL ( SELECT ta0.id,
            ta0.nama,
            ta0.tanggal_mulai
           FROM tahun_ajaran ta0
          WHERE ta0.id = t.tahun_akademik_id OR t.tahun_akademik_id IS NULL AND t.jatuh_tempo >= ta0.tanggal_mulai AND t.jatuh_tempo <= ta0.tanggal_selesai
          ORDER BY (ta0.id = t.tahun_akademik_id) DESC, ta0.tanggal_mulai DESC
         LIMIT 1) ta ON true
     LEFT JOIN pembayaran p ON p.id = t.pembayaran_id
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(px.jumlah), 0::numeric) AS total_bayar
           FROM pembayaran px
          WHERE px.tagihan_id = t.id) pay ON true
  WHERE ((s.status = ANY (ARRAY['aktif'::text, 'diterima'::text])) OR s.status = 'calon'::text AND (EXISTS ( SELECT 1
           FROM siswa_detail sd
          WHERE sd.siswa_id = s.id AND sd.spmb_status_kelulusan = 'lulus'::text AND sd.spmb_gelombang_id IS NOT NULL))) AND (t.status = ANY (ARRAY['terjadwal'::text, 'belum_bayar'::text, 'sebagian'::text, 'lunas'::text]));
