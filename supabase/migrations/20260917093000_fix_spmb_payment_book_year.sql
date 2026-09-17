-- Pembayaran memakai Tahun Buku, sedangkan pendaftaran SPMB memakai Tahun
-- Ajaran. Kesiapan SPMB harus mengakui pembayaran pendaftaran yang sah tanpa
-- membandingkan dua ID dari tabel referensi yang berbeda.
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

  promo_free := s.created_at >= timestamptz '2026-09-20 17:00:00+00'
                AND s.created_at < timestamptz '2026-10-23 17:00:00+00';

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
