-- Kepala Sekolah hanya mengelola data akademik pada departemen/lembaga sendiri.
-- Admin tetap lintas lembaga; Admin TU tetap mengikuti tabel scope multi-departemen.

CREATE OR REPLACE FUNCTION public.can_manage_akademik_departemen(
  _user_id uuid,
  _departemen_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'kepala_sekolah')
      AND _departemen_id IS NOT NULL
      AND public.user_departemen_id(_user_id) = _departemen_id
    )
    OR (
      public.has_role(_user_id, 'admin_tu')
      AND _departemen_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.admin_tu_departemen_scope s
          WHERE s.user_id = _user_id
            AND s.departemen_id = _departemen_id
        )
        OR public.user_departemen_id(_user_id) = _departemen_id
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_akademik_kelas(
  _user_id uuid,
  _kelas_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.kelas k
    WHERE k.id = _kelas_id
      AND public.can_manage_akademik_departemen(_user_id, k.departemen_id)
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_akademik_kelas(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_akademik_kelas(uuid,uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS kepsek_pegawai_select ON public.pegawai;
CREATE POLICY kepsek_pegawai_select
ON public.pegawai
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);

DROP POLICY IF EXISTS kepsek_siswa_select ON public.siswa;
CREATE POLICY kepsek_siswa_select
ON public.siswa
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);

DROP POLICY IF EXISTS kepsek_penilaian_select ON public.penilaian;
CREATE POLICY kepsek_penilaian_select
ON public.penilaian
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_akademik_kelas(auth.uid(), kelas_id)
);

DROP POLICY IF EXISTS kepsek_presensi_kbm_select ON public.presensi_kbm;
CREATE POLICY kepsek_presensi_kbm_select
ON public.presensi_kbm
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_akademik_kelas(auth.uid(), kelas_id)
);

DROP POLICY IF EXISTS kepsek_presensi_select ON public.presensi_siswa;
CREATE POLICY kepsek_presensi_select
ON public.presensi_siswa
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'kepala_sekolah')
  AND public.can_manage_akademik_kelas(auth.uid(), kelas_id)
);

CREATE OR REPLACE FUNCTION public.spmb_visible_siswa_ids()
RETURNS TABLE(siswa_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.siswa_id
  FROM public.siswa_detail d
  JOIN public.siswa s ON s.id = d.siswa_id
  WHERE d.spmb_gelombang_id IS NOT NULL
    AND public.can_manage_akademik_departemen(
      auth.uid(),
      COALESCE(d.spmb_departemen_tujuan_id, s.departemen_id)
    )
  ORDER BY COALESCE(d.spmb_registered_at, s.created_at) DESC, d.siswa_id
$$;

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

  IF auth.role() = 'service_role' THEN
    allowed := true;
  ELSIF uid IS NOT NULL THEN
    allowed :=
      public.has_role(uid, 'admin')
      OR (
        public.has_role(uid, 'kepala_sekolah')
        AND public.can_access_spmb_siswa(uid, p_siswa_id)
      )
      OR (
        public.has_role(uid, 'admin_tu')
        AND public.can_access_spmb_siswa(uid, p_siswa_id)
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

REVOKE ALL ON FUNCTION public.spmb_visible_siswa_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_visible_siswa_ids()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.spmb_finance_status(uuid,uuid,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spmb_finance_status(uuid,uuid,timestamptz)
  TO authenticated, service_role;
