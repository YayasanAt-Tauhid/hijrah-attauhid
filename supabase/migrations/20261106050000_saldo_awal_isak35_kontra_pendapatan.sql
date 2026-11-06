-- Saldo awal ISAK 35: akun kontra-pendapatan mengurangi surplus, bukan menambah.
--
-- Masalah: isi_saldo_awal_isak35 (dipanggil saat tutup buku) menghitung saldo tiap akun
-- menurut sisi normal akunnya, lalu surplus = SUM(pendapatan) - SUM(beban). Akun potongan
-- 4600-4602 berjenis pendapatan tetapi bersaldo normal DEBIT (kontra-pendapatan): saldonya
-- positif (debit - kredit) sehingga DITAMBAHKAN ke pendapatan. Surplus yang dibawa ke aset
-- neto saldo awal tahun berikutnya lebih besar 2 x total potongan, dan neraca awal tahun
-- berikutnya tidak seimbang sejak hari pertama. (Per 6 Nov 2026: selisih Rp 304.850.000.)
--
-- Perbaikan: hanya bagian surplus. Pendapatan dihitung menurut sisi alaminya (kredit - debit)
-- dan beban menurut sisi alaminya (debit - kredit), apa pun saldo normal akunnya. Baris neraca
-- (aset, liabilitas, ekuitas) tetap menurut sisi normal akun karena saldo_awal_isak35.saldo
-- memang disimpan menurut sisi normal akun. Untuk akun lazim hasilnya identik dengan
-- sebelumnya, jadi penutupan tahun 2025 tidak terpengaruh (akun potongan tidak punya mutasi
-- sebelum 2026).
--
-- Definisi dasar: fungsi yang sedang berjalan di produksi (termasuk pemeriksaan peran
-- admin/keuangan). Pemilik dan hak akses fungsi tetap karena CREATE OR REPLACE.
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

CREATE OR REPLACE FUNCTION public.isi_saldo_awal_isak35(
  p_tahun_ditutup integer,
  p_tgl_mulai date,
  p_tgl_selesai date,
  p_kategori text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tahun_baru int := p_tahun_ditutup + 1;
  v_jumlah int := 0;
  v_akun_ekuitas uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan')) THEN
    RAISE EXCEPTION 'Tidak diizinkan mengisi saldo awal ISAK 35';
  END IF;

  SELECT akun_id INTO v_akun_ekuitas
  FROM pengaturan_akun WHERE kode_setting = 'AKUN_ASET_NETO_TIDAK_TERIKAT' LIMIT 1;
  IF v_akun_ekuitas IS NULL THEN
    RAISE EXCEPTION 'Akun Aset Neto Tidak Terikat belum dikonfigurasi di pengaturan_akun';
  END IF;

  DELETE FROM saldo_awal_isak35 s
  WHERE s.tahun = v_tahun_baru
    AND s.departemen_id IN (SELECT id FROM departemen WHERE kategori = ANY(p_kategori));

  INSERT INTO saldo_awal_isak35 (departemen_id, tahun, akun_id, saldo)
  WITH mut AS (
    SELECT j.departemen_id, jd.akun_id, ar.jenis, ar.saldo_normal,
      CASE WHEN ar.saldo_normal = 'D'
        THEN COALESCE(SUM(jd.debit),0) - COALESCE(SUM(jd.kredit),0)
        ELSE COALESCE(SUM(jd.kredit),0) - COALESCE(SUM(jd.debit),0)
      END AS saldo
    FROM jurnal_detail jd
    JOIN jurnal j         ON j.id  = jd.jurnal_id
    JOIN departemen d     ON d.id  = j.departemen_id
    JOIN akun_rekening ar ON ar.id = jd.akun_id
    WHERE j.tanggal BETWEEN p_tgl_mulai AND p_tgl_selesai
      AND j.status = 'posted'
      AND COALESCE(j.tipe,'') <> 'penutup'
      AND d.kategori = ANY(p_kategori)
      AND ar.pos_isak35 IS NOT NULL
    GROUP BY j.departemen_id, jd.akun_id, ar.jenis, ar.saldo_normal
  ),
  awal_lama AS (
    SELECT s.departemen_id, s.akun_id, ar.jenis, ar.saldo_normal, s.saldo
    FROM saldo_awal_isak35 s
    JOIN akun_rekening ar ON ar.id = s.akun_id
    JOIN departemen d ON d.id = s.departemen_id
    WHERE s.tahun = p_tahun_ditutup AND d.kategori = ANY(p_kategori)
  ),
  semua AS (
    SELECT * FROM mut UNION ALL SELECT * FROM awal_lama
  ),
  neraca AS (
    SELECT departemen_id, akun_id, saldo FROM semua
    WHERE jenis IN ('aset','liabilitas','ekuitas')
  ),
  surplus AS (
    -- Menurut sisi alami jenis (pendapatan = kredit, beban = debit); akun kontra bernilai negatif.
    SELECT departemen_id, v_akun_ekuitas AS akun_id,
      SUM(CASE WHEN jenis = 'pendapatan' THEN (CASE WHEN saldo_normal = 'D' THEN -saldo ELSE saldo END)
               WHEN jenis = 'beban'      THEN -(CASE WHEN saldo_normal = 'K' THEN -saldo ELSE saldo END)
               ELSE 0 END) AS saldo
    FROM semua WHERE jenis IN ('pendapatan','beban')
    GROUP BY departemen_id
  ),
  gabung AS (
    SELECT departemen_id, akun_id, SUM(saldo) AS saldo
    FROM (SELECT * FROM neraca UNION ALL SELECT * FROM surplus) x
    GROUP BY departemen_id, akun_id
  )
  SELECT departemen_id, v_tahun_baru, akun_id, saldo FROM gabung WHERE saldo <> 0;

  GET DIAGNOSTICS v_jumlah = ROW_COUNT;
  RETURN v_jumlah;
END;
$function$;
