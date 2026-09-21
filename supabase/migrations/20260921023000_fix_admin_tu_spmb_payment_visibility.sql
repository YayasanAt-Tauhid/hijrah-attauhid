-- Keep Admin TU scoped to academic data while allowing SPMB readiness to
-- resolve the payment/promo status for students in the Admin TU's own unit.
-- We intentionally do NOT add Admin TU SELECT policies to finance tables.

CREATE OR REPLACE FUNCTION public.spmb_finance_status(
  p_siswa_id uuid,
  p_jenis_id uuid,
  p_registered_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  allowed boolean := false;
  paid numeric := 0;
  paid_date date;
  promo_free boolean := false;
BEGIN
  IF p_siswa_id IS NULL THEN
    RAISE EXCEPTION 'Siswa wajib diisi';
  END IF;

  -- Service-role is used by trusted server-side flows. Authenticated users are
  -- limited to roles that already have legitimate access to the student's SPMB
  -- or own-family payment context. Admin TU must additionally match the unit.
  IF auth.role() = 'service_role' THEN
    allowed := true;
  ELSIF uid IS NOT NULL THEN
    allowed :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'kepala_sekolah')
      OR (
        public.has_role(uid, 'admin_tu')
        AND public.can_access_akademik_siswa(uid, p_siswa_id)
      )
      OR public.is_own_siswa(uid, p_siswa_id)
      OR public.is_ortu_of(uid, p_siswa_id);
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Akses status pembayaran SPMB ditolak';
  END IF;

  IF p_jenis_id IS NOT NULL THEN
    SELECT COALESCE(sum(p.jumlah), 0), max(p.tanggal_bayar)
    INTO paid, paid_date
    FROM public.pembayaran p
    WHERE p.siswa_id = p_siswa_id
      AND p.jenis_id = p_jenis_id
      AND p.jurnal_id IS NOT NULL
      AND p.tanggal_bayar >= p_registered_at::date;

    SELECT EXISTS (
      SELECT 1
      FROM public.tagihan t
      JOIN public.siswa_diskon sd ON sd.id = t.siswa_diskon_id
      JOIN public.skema_diskon sk ON sk.id = sd.skema_diskon_id
      WHERE t.siswa_id = p_siswa_id
        AND t.jenis_id = p_jenis_id
        AND t.status = 'lunas'
        AND t.nominal = 0
        AND t.nominal_diskon > 0
        AND sd.status = 'disetujui'
        AND sk.kategori = 'promo'
    )
    INTO promo_free;
  END IF;

  RETURN jsonb_build_object(
    'dibayar', COALESCE(paid, 0),
    'tanggal_pembayaran', paid_date,
    'gratis_pendaftaran', promo_free
  );
END
$$;

REVOKE ALL ON FUNCTION public.spmb_finance_status(uuid,uuid,timestamptz)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_finance_status(uuid,uuid,timestamptz)
TO authenticated, service_role;

COMMENT ON FUNCTION public.spmb_finance_status(uuid,uuid,timestamptz) IS
  'Least-privilege SPMB finance snapshot. Admin TU may resolve payment/promo only for students in its own department; no direct finance-table access is granted.';

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
  finance jsonb;
BEGIN
  SELECT * INTO s
  FROM public.siswa
  WHERE id = p_siswa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Siswa tidak ditemukan atau akses ditolak';
  END IF;

  SELECT * INTO d
  FROM public.siswa_detail
  WHERE siswa_id = s.id;

  SELECT * INTO dep
  FROM public.departemen
  WHERE id = s.departemen_id;

  SELECT jenis_pembayaran_id INTO jenis
  FROM public.konfigurasi_pmb
  WHERE departemen_id = s.departemen_id;

  IF jenis IS NOT NULL THEN
    SELECT COALESCE(public.get_tarif_siswa(jenis, s.id, NULL, NULL), j.nominal)
    INTO nominal
    FROM public.jenis_pembayaran j
    WHERE j.id = jenis;

    finance := public.spmb_finance_status(s.id, jenis, s.created_at);
    paid := COALESCE((finance->>'dibayar')::numeric, 0);
    paid_date := (finance->>'tanggal_pembayaran')::date;
    promo_free := COALESCE((finance->>'gratis_pendaftaran')::boolean, false);
  ELSE
    nominal := NULL;
    paid := 0;
    paid_date := NULL;
    promo_free := false;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.kelas_siswa ks
    JOIN public.kelas k ON k.id = ks.kelas_id
    WHERE ks.siswa_id = s.id
      AND ks.aktif
      AND ks.tahun_ajaran_id IS NOT NULL
      AND k.departemen_id = s.departemen_id
  )
  INTO has_class;

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
       SELECT 1
       FROM public.angkatan
       WHERE id = s.angkatan_id
         AND departemen_id = s.departemen_id
     ) THEN
    missing := array_append(missing, 'angkatan sesuai lembaga');
  END IF;

  IF NOT has_class THEN
    missing := array_append(missing, 'kelas dan tahun ajaran sesuai lembaga');
  END IF;

  IF COALESCE(d.spmb_status_kelulusan, '') <> 'lulus' THEN
    missing := array_append(missing, 'status kelulusan: Lulus');
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
    OR upper(dep.nama) ~ '(^|\\s)(SMP|SMA|MTA)(\\s|$)'
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
