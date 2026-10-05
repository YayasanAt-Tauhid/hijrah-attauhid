-- Target: cmvzcpeiuompqgdvflky. Memerlukan persetujuan terpisah setelah SQL ditampilkan.
-- Tahap ini hanya status siswa dan metadata kategori. Tidak mengubah nominal,
-- status bayar, uang masuk, jurnal, atau saldo. Akun jurnal historis dipertahankan.

-- Jangan berlomba dengan pembayaran/cron atau edit siswa. Jika sedang sibuk,
-- hentikan migration dan ulangi pada waktu yang sesuai; jangan menunggu panjang.
LOCK TABLE public.tagihan,public.pembayaran,public.pendapatan_dimuka,
  public.jurnal,public.jurnal_detail,public.siswa_detail IN SHARE ROW EXCLUSIVE MODE NOWAIT;

CREATE TABLE migration.spp_asrama_metadata_audit_20261005 (
  tabel text NOT NULL,
  record_id uuid NOT NULL,
  data_lama jsonb NOT NULL,
  data_baru jsonb NOT NULL,
  bukti jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tabel,record_id)
);
ALTER TABLE migration.spp_asrama_metadata_audit_20261005 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE migration.spp_asrama_metadata_audit_20261005 FROM PUBLIC,anon,authenticated;

CREATE TEMP TABLE _spp_source ON COMMIT DROP AS
SELECT l.*,
  CASE WHEN l.source_name ~* '\mnon[ _-]*asrama\M' THEN 'non_asrama'
       WHEN l.source_name ~* '\masrama\M' THEN 'asrama' END AS kategori,
  CASE WHEN l.source_name ~* 'SMP' THEN 'SMP'
       WHEN l.source_name ~* 'SMA' THEN 'SMA'
       WHEN l.source_name ~* 'MTA' THEN 'MTA' END AS unit_sumber
FROM migration.legacy_tagihan_snapshot l WHERE l.source_name ILIKE '%SPP%';
CREATE INDEX ON _spp_source(siswa_id,period_month);
CREATE INDEX ON _spp_source(source_key);
CREATE INDEX ON _spp_source(target_tagihan_id);

CREATE TEMP TABLE _spp_status_candidates ON COMMIT DROP AS
WITH evidence AS (
  SELECT l.siswa_id,count(DISTINCT l.kategori) AS n,min(l.kategori) AS kategori,
         jsonb_agg(l.source_key ORDER BY l.source_key) AS source_keys
  FROM _spp_source l
  JOIN public.siswa s ON s.id=l.siswa_id JOIN public.departemen d ON d.id=s.departemen_id
  WHERE l.unit_sumber=d.kode AND l.kategori IS NOT NULL
    AND l.period_month BETWEEN '2026-07-01' AND '2027-06-01'
  GROUP BY l.siswa_id
)
SELECT sd.id,sd.siswa_id,e.kategori,e.source_keys
FROM public.siswa_detail sd JOIN public.siswa s ON s.id=sd.siswa_id
JOIN public.departemen d ON d.id=s.departemen_id JOIN evidence e ON e.siswa_id=s.id
WHERE s.status='aktif' AND d.kode IN ('SMP','SMA','MTA')
  AND sd.status_asrama IS NULL AND sd.pmb_payment_token IS NULL AND e.n=1;

DO $preflight$ BEGIN
  IF (SELECT count(*) FROM _spp_status_candidates) <> 345 THEN
    RAISE EXCEPTION 'Kandidat status berubah dari 345 sejak audit; periksa ulang sebelum menerapkan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('4101'),('4102'),('4103')) expected(kode)
    LEFT JOIN public.akun_rekening a ON a.kode=expected.kode AND a.aktif AND a.jenis='pendapatan'
    GROUP BY expected.kode HAVING count(a.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Konfigurasi akun SPP berubah sejak audit';
  END IF;
END; $preflight$;

INSERT INTO migration.spp_asrama_metadata_audit_20261005(tabel,record_id,data_lama,data_baru,bukti)
SELECT 'siswa_detail',c.id,jsonb_build_object('status_asrama',NULL),
       jsonb_build_object('status_asrama',c.kategori),c.source_keys
FROM _spp_status_candidates c;
UPDATE public.siswa_detail sd SET status_asrama=c.kategori
FROM _spp_status_candidates c WHERE sd.id=c.id AND sd.status_asrama IS NULL;
DO $verify_status$ BEGIN
  IF EXISTS(SELECT 1 FROM _spp_status_candidates c JOIN public.siswa_detail sd ON sd.id=c.id
            WHERE sd.status_asrama IS DISTINCT FROM c.kategori) THEN
    RAISE EXCEPTION 'Status hasil update berbeda dengan bukti; seluruh migration dibatalkan';
  END IF;
END; $verify_status$;

-- Bukti pada tagihan asli mengalahkan status sekarang. Jika tidak ada tautan
-- legacy, hanya cocokkan sumber unit dan bulan yang sama, bukan nominal SPP.
CREATE TEMP TABLE _spp_bill_snapshot ON COMMIT DROP AS
WITH evidence AS (
  SELECT t.id,count(DISTINCT l.kategori) AS n,min(l.kategori) AS kategori,
         COALESCE(jsonb_agg(l.source_key ORDER BY l.source_key) FILTER(WHERE l.source_key IS NOT NULL),'[]') AS source_keys
  FROM public.tagihan t JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id
  JOIN public.departemen d ON d.id=jp.departemen_id
  LEFT JOIN _spp_source l ON l.siswa_id=t.siswa_id AND l.kategori IS NOT NULL AND (
    l.source_key=t.legacy_source_key OR l.target_tagihan_id=t.id OR
    (t.legacy_source_key IS NULL AND l.unit_sumber=d.kode AND
     l.period_month=date_trunc('month',t.jatuh_tempo)::date)
  )
  WHERE jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)'
    AND t.spp_kategori IS NULL AND t.spp_akun_pendapatan_id IS NULL
  GROUP BY t.id
), original_accounts AS (
  SELECT t.id,count(DISTINCT jd.akun_id) AS n,(array_agg(DISTINCT jd.akun_id))[1] AS akun_id
  FROM public.tagihan t
  LEFT JOIN public.pembayaran p ON p.tagihan_id=t.id
  LEFT JOIN public.pendapatan_dimuka pd ON pd.pembayaran_id=p.id
  LEFT JOIN public.jurnal j ON j.id IN (t.jurnal_piutang_id,p.jurnal_id,pd.jurnal_pengakuan_id) AND j.status='posted'
  LEFT JOIN public.jurnal_detail jd ON jd.jurnal_id=j.id AND jd.kredit>0 AND jd.akun_id IN
    (SELECT id FROM public.akun_rekening WHERE kode IN ('4101','4102','4103'))
  GROUP BY t.id
), classified AS (
  SELECT t.id,t.jurnal_piutang_id,t.pengakuan_spp_selesai,jp.akun_pendapatan_id AS akun_default,
    CASE WHEN d.kode NOT IN ('SMP','SMA','MTA') THEN 'umum'
         WHEN e.n=1 THEN e.kategori
         WHEN e.n>1 THEN 'belum_terverifikasi'
         -- Jadwal yang belum mempunyai jurnal/pembayaran boleh mengambil
         -- status terverifikasi sekarang, khusus layanan yang masih mendatang.
         WHEN t.jatuh_tempo>='2026-10-05' AND t.jurnal_piutang_id IS NULL
          AND NOT t.pengakuan_spp_selesai AND NOT EXISTS(SELECT 1 FROM public.pembayaran p WHERE p.tagihan_id=t.id)
          AND sd.status_asrama IN ('asrama','non_asrama') THEN sd.status_asrama
         ELSE 'belum_terverifikasi' END AS kategori,
    e.source_keys,oa.n AS original_account_count,oa.akun_id AS original_account
  FROM evidence e JOIN public.tagihan t ON t.id=e.id
  JOIN public.jenis_pembayaran jp ON jp.id=t.jenis_id JOIN public.departemen d ON d.id=jp.departemen_id
  LEFT JOIN public.siswa_detail sd ON sd.siswa_id=t.siswa_id
  LEFT JOIN original_accounts oa ON oa.id=t.id
)
SELECT c.id,c.kategori,
  CASE WHEN c.original_account_count=1 THEN c.original_account
       WHEN c.jurnal_piutang_id IS NOT NULL OR c.pengakuan_spp_selesai OR c.original_account_count>1
         THEN c.akun_default
       WHEN c.kategori IN ('asrama','non_asrama')
         THEN (SELECT id FROM public.akun_rekening WHERE aktif AND jenis='pendapatan'
               AND kode=CASE WHEN c.kategori='asrama' THEN '4102' ELSE '4103' END)
       ELSE c.akun_default END AS akun_id,
  c.source_keys,c.original_account_count
FROM classified c;

INSERT INTO migration.spp_asrama_metadata_audit_20261005(tabel,record_id,data_lama,data_baru,bukti)
SELECT 'tagihan',c.id,jsonb_build_object('spp_kategori',NULL,'spp_akun_pendapatan_id',NULL),
       jsonb_build_object('spp_kategori',c.kategori,'spp_akun_pendapatan_id',c.akun_id),
       jsonb_build_object('source_keys',c.source_keys,'original_account_count',c.original_account_count)
FROM _spp_bill_snapshot c;
UPDATE public.tagihan t SET spp_kategori=c.kategori,spp_akun_pendapatan_id=c.akun_id
FROM _spp_bill_snapshot c WHERE t.id=c.id AND t.spp_kategori IS NULL AND t.spp_akun_pendapatan_id IS NULL;

CREATE TEMP TABLE _spp_payment_snapshot ON COMMIT DROP AS
SELECT p.id,COALESCE(t.spp_kategori,CASE WHEN d.kode IN ('TK','SD') THEN 'umum' ELSE 'belum_terverifikasi' END) AS kategori
FROM public.pembayaran p JOIN public.jenis_pembayaran jp ON jp.id=p.jenis_id
LEFT JOIN public.departemen d ON d.id=jp.departemen_id
LEFT JOIN public.tagihan t ON t.id=p.tagihan_id AND t.siswa_id=p.siswa_id AND t.jenis_id=p.jenis_id
WHERE jp.tipe='bulanan' AND lower(btrim(jp.nama)) ~ '^spp([[:space:]-]|$)' AND p.spp_kategori IS NULL;
INSERT INTO migration.spp_asrama_metadata_audit_20261005(tabel,record_id,data_lama,data_baru,bukti)
SELECT 'pembayaran',c.id,jsonb_build_object('spp_kategori',NULL),jsonb_build_object('spp_kategori',c.kategori),
       jsonb_build_object('tagihan_id',p.tagihan_id)
FROM _spp_payment_snapshot c JOIN public.pembayaran p ON p.id=c.id;
UPDATE public.pembayaran p SET spp_kategori=c.kategori
FROM _spp_payment_snapshot c WHERE p.id=c.id AND p.spp_kategori IS NULL;

-- Tidak ada UPDATE/INSERT/DELETE jurnal. Reklasifikasi akun histori 4101
-- membutuhkan audit jurnal tersendiri, termasuk jurnal yang dipakai beberapa tagihan.
