-- SPMB Gelombang Pertama 2027/2028: pembebasan biaya pendaftaran harus
-- tercatat sebagai potongan 100%, bukan pembayaran Rp0 dan bukan sekadar flag UI.
--
-- Akuntansi untuk promo penuh:
--   D Potongan/Promo SPMB   xxx
--       K Pendapatan Pendaftaran SPMB   xxx
-- Netto pendapatan = 0, kas/piutang = 0, tetapi nilai bruto dan promo tetap
-- terlihat di laporan serta dapat ditelusuri per siswa melalui tagihan + siswa_diskon.

-- 1) Kategori promo eksplisit di master diskon.
ALTER TABLE public.skema_diskon
  DROP CONSTRAINT IF EXISTS skema_diskon_kategori_check;
ALTER TABLE public.skema_diskon
  ADD CONSTRAINT skema_diskon_kategori_check
  CHECK (kategori IN ('beasiswa', 'keringanan', 'kakak_adik', 'bantuan', 'promo', 'lainnya'));

-- 2) Akun kontra-pendapatan khusus SPMB agar tidak bercampur dengan potongan SPP.
INSERT INTO public.akun_rekening (
  kode, nama, jenis, saldo_normal, saldo_awal, keterangan, aktif
)
VALUES (
  '4602',
  'POTONGAN/PROMO SPMB',
  'pendapatan',
  'D',
  0,
  'Kontra-pendapatan khusus promo/pembebasan biaya pendaftaran SPMB.',
  true
)
ON CONFLICT (kode) DO UPDATE
SET nama = EXCLUDED.nama,
    jenis = EXCLUDED.jenis,
    saldo_normal = EXCLUDED.saldo_normal,
    keterangan = EXCLUDED.keterangan,
    aktif = true;

-- Jenis pembayaran yang menjadi konfigurasi SPMB memakai akun potongan khusus
-- jika belum punya override sendiri. Konfigurasi custom yang sudah ada tidak ditimpa.
UPDATE public.jenis_pembayaran jp
SET akun_potongan_id = a.id
FROM public.akun_rekening a
WHERE a.kode = '4602'
  AND jp.akun_potongan_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.konfigurasi_pmb kp
    WHERE kp.jenis_pembayaran_id = jp.id
  );

-- 3) Master skema promo otomatis. Tidak memerlukan approval manual karena haknya
-- ditentukan oleh timestamp pendaftaran dan ditegakkan oleh fungsi/trigger DB.
INSERT INTO public.skema_diskon (
  nama, kategori, tipe, nilai_default, perlu_approval, aktif, keterangan
)
VALUES (
  'Promo SPMB Gelombang Pertama 2027/2028',
  'promo',
  'persen',
  100,
  false,
  true,
  'Gratis biaya pendaftaran untuk calon murid yang mendaftar 21 September sampai 23 Oktober 2026 WIB.'
)
ON CONFLICT (nama) DO UPDATE
SET kategori = EXCLUDED.kategori,
    tipe = EXCLUDED.tipe,
    nilai_default = EXCLUDED.nilai_default,
    perlu_approval = EXCLUDED.perlu_approval,
    aktif = true,
    keterangan = EXCLUDED.keterangan;

-- 4) Terapkan hak promo secara idempoten dan atomik.
CREATE OR REPLACE FUNCTION public.spmb_apply_first_wave_promo(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  v_jenis_id uuid;
  v_jenis_nama text;
  v_nominal_default numeric;
  v_bruto numeric;
  v_book public.tahun_buku;
  v_skema_id uuid;
  v_diskon_id uuid;
  v_tagihan public.tagihan;
  v_existing_tagihan_id uuid;
  v_errors text[];
BEGIN
  SELECT * INTO s
  FROM public.siswa
  WHERE id = p_siswa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calon murid SPMB tidak ditemukan';
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = s.id;

  -- Hanya pendaftaran SPMB 2027/2028 murid baru yang menjadi target.
  IF d.siswa_id IS NULL
     OR s.status <> 'calon'
     OR COALESCE(d.kategori, '') <> 'MURID BARU'
     OR COALESCE(d.jenis_pendaftaran, 'baru') <> 'baru'
     OR NOT EXISTS (
       SELECT 1 FROM public.tahun_ajaran ta
       WHERE ta.id = d.tahun_ajaran_id
         AND ta.nama = 'Tahun Ajaran 2027-2028'
     )
  THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'bukan_spmb_target');
  END IF;

  -- Hak promo melekat pada created_at siswa, bukan waktu fungsi dipanggil.
  IF NOT public.spmb_is_first_wave_free(s.created_at) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'di_luar_periode_promo');
  END IF;

  SELECT kp.jenis_pembayaran_id, jp.nama, jp.nominal
  INTO v_jenis_id, v_jenis_nama, v_nominal_default
  FROM public.konfigurasi_pmb kp
  JOIN public.jenis_pembayaran jp ON jp.id = kp.jenis_pembayaran_id
  WHERE kp.departemen_id = s.departemen_id
    AND jp.aktif = true
  LIMIT 1;

  IF v_jenis_id IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi biaya pendaftaran SPMB belum tersedia untuk lembaga calon murid';
  END IF;

  -- Jangan pernah mengubah pembayaran uang riil menjadi promo otomatis.
  IF EXISTS (
    SELECT 1
    FROM public.pembayaran p
    WHERE p.siswa_id = s.id
      AND p.jenis_id = v_jenis_id
      AND p.jurnal_id IS NOT NULL
      AND p.tanggal_bayar >= s.created_at::date
  ) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'sudah_ada_pembayaran');
  END IF;

  -- Keuangan memakai Tahun Buku berdasarkan tanggal kejadian, bukan Tahun Ajaran siswa.
  SELECT * INTO v_book
  FROM public.tahun_buku tb
  WHERE s.created_at::date BETWEEN tb.tanggal_mulai AND tb.tanggal_selesai
  ORDER BY tb.tanggal_mulai DESC, tb.id
  LIMIT 1;

  IF v_book.id IS NULL THEN
    RAISE EXCEPTION 'Tahun buku untuk tanggal pendaftaran SPMB belum dikonfigurasi';
  END IF;
  IF COALESCE(v_book.ditutup, false) THEN
    RAISE EXCEPTION 'Tahun buku % sudah ditutup; promo SPMB tidak dapat dibukukan otomatis', v_book.nama;
  END IF;

  v_bruto := COALESCE(
    public.get_tarif_siswa(v_jenis_id, s.id, NULL, v_book.id, s.angkatan_id),
    v_nominal_default,
    0
  );
  IF v_bruto <= 0 THEN
    RAISE EXCEPTION 'Tarif biaya pendaftaran SPMB belum dikonfigurasi untuk calon murid';
  END IF;

  SELECT id INTO v_skema_id
  FROM public.skema_diskon
  WHERE nama = 'Promo SPMB Gelombang Pertama 2027/2028'
    AND aktif = true
  LIMIT 1;
  IF v_skema_id IS NULL THEN
    RAISE EXCEPTION 'Skema Promo SPMB Gelombang Pertama belum tersedia';
  END IF;

  SELECT sd.id INTO v_diskon_id
  FROM public.siswa_diskon sd
  WHERE sd.siswa_id = s.id
    AND sd.jenis_id = v_jenis_id
    AND sd.skema_diskon_id = v_skema_id
    AND sd.status = 'disetujui'
  ORDER BY sd.diputuskan_at DESC NULLS LAST, sd.diajukan_at DESC
  LIMIT 1;

  IF v_diskon_id IS NULL THEN
    INSERT INTO public.siswa_diskon (
      siswa_id, skema_diskon_id, jenis_id,
      periode_mulai, periode_selesai, nilai,
      status, catatan, diajukan_at, diputuskan_at
    )
    VALUES (
      s.id, v_skema_id, v_jenis_id,
      v_book.tanggal_mulai, v_book.tanggal_selesai, 100,
      'disetujui',
      'Otomatis: Promo SPMB Gelombang Pertama 2027/2028 berdasarkan tanggal pendaftaran.',
      s.created_at, s.created_at
    )
    RETURNING id INTO v_diskon_id;
  END IF;

  SELECT t.id INTO v_existing_tagihan_id
  FROM public.tagihan t
  WHERE t.siswa_id = s.id
    AND t.jenis_id = v_jenis_id
    AND t.tahun_ajaran_id = v_book.id
    AND t.bulan IS NULL
  LIMIT 1;

  IF v_existing_tagihan_id IS NULL THEN
    SELECT g.errors INTO v_errors
    FROM public.generate_tagihan_batch(
      v_jenis_id,
      v_book.id,
      NULL,
      s.departemen_id,
      jsonb_build_array(jsonb_build_object('siswa_id', s.id, 'kelas_id', NULL)),
      auth.uid()
    ) g;

    IF COALESCE(array_length(v_errors, 1), 0) > 0 THEN
      RAISE EXCEPTION 'Gagal membukukan promo SPMB: %', array_to_string(v_errors, '; ');
    END IF;
  ELSE
    -- Bila tagihan sudah sempat dibuat, gunakan mesin koreksi diskon yang sama
    -- agar jurnal posted lama tidak diedit.
    PERFORM public.terapkan_diskon_siswa(v_diskon_id, auth.uid());
  END IF;

  SELECT * INTO v_tagihan
  FROM public.tagihan t
  WHERE t.siswa_id = s.id
    AND t.jenis_id = v_jenis_id
    AND t.tahun_ajaran_id = v_book.id
    AND t.bulan IS NULL
  LIMIT 1;

  IF v_tagihan.id IS NULL THEN
    RAISE EXCEPTION 'Tagihan promo SPMB gagal terbentuk';
  END IF;

  -- Pembebasan 100% adalah penyelesaian kewajiban tanpa kas masuk.
  IF COALESCE(v_tagihan.nominal, 0) = 0 THEN
    UPDATE public.tagihan
    SET status = 'lunas'
    WHERE id = v_tagihan.id
      AND status IN ('terjadwal', 'belum_bayar')
      AND pembayaran_id IS NULL;
  ELSE
    RAISE EXCEPTION 'Promo SPMB 100%% tidak menghasilkan tagihan netto Rp0';
  END IF;

  UPDATE public.siswa_diskon
  SET diterapkan_at = COALESCE(diterapkan_at, clock_timestamp())
  WHERE id = v_diskon_id;

  SELECT * INTO v_tagihan FROM public.tagihan WHERE id = v_tagihan.id;

  RETURN jsonb_build_object(
    'applied', true,
    'siswa_id', s.id,
    'jenis_id', v_jenis_id,
    'jenis_nama', v_jenis_nama,
    'tahun_buku_id', v_book.id,
    'tahun_buku_nama', v_book.nama,
    'tagihan_id', v_tagihan.id,
    'jurnal_id', v_tagihan.jurnal_piutang_id,
    'nominal_bruto', COALESCE(v_tagihan.nominal_bruto, v_bruto),
    'nominal_diskon', COALESCE(v_tagihan.nominal_diskon, v_bruto),
    'nominal_netto', v_tagihan.nominal,
    'status', v_tagihan.status,
    'siswa_diskon_id', v_diskon_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.spmb_apply_first_wave_promo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_apply_first_wave_promo(uuid) TO service_role;

-- 5) Trigger sesudah siswa_detail dibuat. Ini mencakup pendaftaran publik dan
-- pendaftaran admin tanpa menduplikasi logika di dua frontend/server path.
CREATE OR REPLACE FUNCTION public.trg_spmb_apply_first_wave_promo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.spmb_apply_first_wave_promo(NEW.siswa_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_spmb_apply_first_wave_promo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS spmb_apply_first_wave_promo_after_detail ON public.siswa_detail;
CREATE TRIGGER spmb_apply_first_wave_promo_after_detail
AFTER INSERT ON public.siswa_detail
FOR EACH ROW
EXECUTE FUNCTION public.trg_spmb_apply_first_wave_promo();

-- 6) Backfill aman bila migrasi baru diterapkan setelah promo mulai. Fungsi
-- idempoten; siswa di luar target/periode otomatis dilewati.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT s.id
    FROM public.siswa s
    JOIN public.siswa_detail d ON d.siswa_id = s.id
    JOIN public.tahun_ajaran ta ON ta.id = d.tahun_ajaran_id
    WHERE s.status = 'calon'
      AND ta.nama = 'Tahun Ajaran 2027-2028'
      AND COALESCE(d.kategori, '') = 'MURID BARU'
      AND COALESCE(d.jenis_pendaftaran, 'baru') = 'baru'
      AND public.spmb_is_first_wave_free(s.created_at)
  LOOP
    PERFORM public.spmb_apply_first_wave_promo(r.id);
  END LOOP;
END;
$$;


-- 7) Kesiapan akademik memakai bukti settlement promo yang sudah dibukukan,
-- bukan hanya timestamp pendaftaran. Dengan demikian /akademik/spmb dan
-- laporan keuangan selalu membaca fakta yang sama.
CREATE OR REPLACE FUNCTION public.spmb_readiness(p_siswa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s public.siswa;
  d public.siswa_detail;
  dep public.departemen;
  jenis uuid;
  nominal numeric;
  paid numeric;
  paid_date date;
  missing text[] := '{}';
  has_class boolean;
  promo_free boolean;
BEGIN
  SELECT * INTO s FROM siswa WHERE id = p_siswa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan atau akses ditolak';
  END IF;

  SELECT * INTO d FROM siswa_detail WHERE siswa_id = s.id;
  SELECT * INTO dep FROM departemen WHERE id = s.departemen_id;
  SELECT jenis_pembayaran_id INTO jenis
  FROM konfigurasi_pmb
  WHERE departemen_id = s.departemen_id;

  IF jenis IS NOT NULL THEN
    SELECT COALESCE(get_tarif_siswa(jenis, s.id, NULL, NULL), j.nominal)
    INTO nominal
    FROM jenis_pembayaran j
    WHERE j.id = jenis;

    SELECT COALESCE(sum(p.jumlah), 0), max(p.tanggal_bayar)
    INTO paid, paid_date
    FROM pembayaran p
    WHERE p.siswa_id = s.id
      AND p.jenis_id = jenis
      AND p.jurnal_id IS NOT NULL
      AND p.tanggal_bayar >= s.created_at::date;
  ELSE
    nominal := NULL;
    paid := 0;
    paid_date := NULL;
  END IF;

  -- Promo dianggap gratis hanya bila pembukuannya benar-benar sudah terbentuk:
  -- tagihan netto Rp0, potongan > 0, status lunas, dan sumbernya skema promo.
  -- Ini mencegah tanggal pendaftaran saja menjadi pengganti bukti penyelesaian
  -- kewajiban finansial.
  SELECT EXISTS (
    SELECT 1
    FROM tagihan t
    JOIN siswa_diskon sd ON sd.id = t.siswa_diskon_id
    JOIN skema_diskon sk ON sk.id = sd.skema_diskon_id
    WHERE t.siswa_id = s.id
      AND t.jenis_id = jenis
      AND t.status = 'lunas'
      AND t.nominal = 0
      AND t.nominal_diskon > 0
      AND sd.status = 'disetujui'
      AND sk.kategori = 'promo'
  ) INTO promo_free;

  SELECT EXISTS(
    SELECT 1
    FROM kelas_siswa ks
    JOIN kelas k ON k.id = ks.kelas_id
    WHERE ks.siswa_id = s.id
      AND ks.aktif
      AND ks.tahun_ajaran_id IS NOT NULL
      AND k.departemen_id = s.departemen_id
  ) INTO has_class;

  IF NOT COALESCE(s.terverifikasi, false) THEN
    missing := array_append(missing, 'verifikasi data');
  END IF;

  IF NOT promo_free THEN
    IF jenis IS NULL THEN
      missing := array_append(missing, 'konfigurasi pembayaran SPMB');
    ELSIF nominal IS NULL OR nominal <= 0 THEN
      missing := array_append(missing, 'nominal pembayaran SPMB');
    ELSIF paid < nominal THEN
      missing := array_append(missing, 'pelunasan pembayaran SPMB');
    END IF;
  END IF;

  IF s.departemen_id IS NULL THEN
    missing := array_append(missing, 'lembaga');
  END IF;
  IF s.angkatan_id IS NULL
     OR NOT EXISTS(
       SELECT 1 FROM angkatan
       WHERE id = s.angkatan_id
         AND departemen_id = s.departemen_id
     ) THEN
    missing := array_append(missing, 'angkatan sesuai lembaga');
  END IF;
  IF NOT has_class THEN
    missing := array_append(missing, 'kelas dan tahun ajaran sesuai lembaga');
  END IF;
  IF NULLIF(trim(dep.npsn), '') IS NULL THEN
    missing := array_append(missing, 'NPSN lembaga');
  END IF;
  IF NULLIF(d.dokumen_kk_path, '') IS NULL THEN
    missing := array_append(missing, 'Kartu Keluarga');
  END IF;
  IF NULLIF(d.dokumen_akta_path, '') IS NULL THEN
    missing := array_append(missing, 'Akta Kelahiran');
  END IF;
  IF (
    upper(trim(dep.kode)) IN ('SMP', 'SMA', 'MTA')
    OR upper(dep.nama) ~ '(^|\s)(SMP|SMA|MTA)(\s|$)'
  ) AND d.status_asrama IS NULL THEN
    missing := array_append(missing, 'pilihan asrama');
  END IF;

  RETURN jsonb_build_object(
    'siap', cardinality(missing) = 0,
    'kekurangan', to_jsonb(missing),
    'configured', jenis IS NOT NULL,
    'lunas', promo_free OR COALESCE(nominal > 0 AND paid >= nominal, false),
    'gratis_pendaftaran', promo_free AND COALESCE(paid, 0) = 0,
    'tanggal_pembayaran', paid_date,
    'nominal', nominal,
    'dibayar', COALESCE(paid, 0),
    'punya_kelas', has_class
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_readiness(uuid) TO authenticated, service_role;
