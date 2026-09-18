-- Scoped Admin TU for /akademik.
-- Role decides capability; users_profile.departemen_id decides the single education unit.
-- Global admin remains cross-unit. This migration deliberately does not extend
-- admin_tu into finance, settings, or foundation-wide administration.

CREATE OR REPLACE FUNCTION public.validate_user_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT NULL AND NEW.role NOT IN (
    'admin','admin_tu','kepala_sekolah','guru','keuangan','kasir','pustakawan','siswa','ortu',
    'sekretaris_yayasan'
  ) THEN
    RAISE EXCEPTION 'role tidak valid: %', NEW.role;
  END IF;

  IF NEW.role = 'admin_tu' THEN
    IF NEW.departemen_id IS NULL THEN
      RAISE EXCEPTION 'Admin TU wajib memiliki lembaga';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.departemen d
      WHERE d.id = NEW.departemen_id
        AND d.aktif = true
        AND d.kategori = 'unit_pendidikan'
    ) THEN
      RAISE EXCEPTION 'Lembaga Admin TU tidak valid atau bukan unit pendidikan';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.user_departemen_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT departemen_id
  FROM public.users_profile
  WHERE id = _user_id AND COALESCE(aktif, true) = true
$$;
REVOKE ALL ON FUNCTION public.user_departemen_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_departemen_id(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_akademik_departemen(_user_id uuid, _departemen_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'admin_tu')
      AND _departemen_id IS NOT NULL
      AND public.user_departemen_id(_user_id) = _departemen_id
    )
$$;
REVOKE ALL ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_akademik_departemen(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_akademik_siswa(_user_id uuid, _siswa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.siswa s
    WHERE s.id = _siswa_id
      AND public.can_manage_akademik_departemen(_user_id, s.departemen_id)
  )
$$;
REVOKE ALL ON FUNCTION public.can_access_akademik_siswa(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_akademik_siswa(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_akademik_kelas(_user_id uuid, _kelas_id uuid)
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
REVOKE ALL ON FUNCTION public.can_access_akademik_kelas(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_akademik_kelas(uuid,uuid) TO authenticated, service_role;

-- Scope reads for Admin TU while preserving the existing visibility of other roles.
DROP POLICY IF EXISTS "Auth read departemen" ON public.departemen;
CREATE POLICY "Auth read departemen" ON public.departemen
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_manage_akademik_departemen(auth.uid(), id)
);

DROP POLICY IF EXISTS "Auth read angkatan" ON public.angkatan;
CREATE POLICY "Auth read angkatan" ON public.angkatan
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);
DROP POLICY IF EXISTS admin_tu_angkatan_all ON public.angkatan;
CREATE POLICY admin_tu_angkatan_all ON public.angkatan
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id));

DROP POLICY IF EXISTS "Auth read tingkat" ON public.tingkat;
CREATE POLICY "Auth read tingkat" ON public.tingkat
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);
DROP POLICY IF EXISTS admin_tu_tingkat_all ON public.tingkat;
CREATE POLICY admin_tu_tingkat_all ON public.tingkat
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id));

DROP POLICY IF EXISTS "Auth read kelas" ON public.kelas;
CREATE POLICY "Auth read kelas" ON public.kelas
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);
DROP POLICY IF EXISTS admin_tu_kelas_all ON public.kelas;
CREATE POLICY admin_tu_kelas_all ON public.kelas
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id));

DROP POLICY IF EXISTS "Auth read kelas_siswa" ON public.kelas_siswa;
CREATE POLICY "Auth read kelas_siswa" ON public.kelas_siswa
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_access_akademik_kelas(auth.uid(), kelas_id)
);
DROP POLICY IF EXISTS admin_tu_kelas_siswa_all ON public.kelas_siswa;
CREATE POLICY admin_tu_kelas_siswa_all ON public.kelas_siswa
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id))
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);

DROP POLICY IF EXISTS admin_tu_siswa_all ON public.siswa;
CREATE POLICY admin_tu_siswa_all ON public.siswa
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);

DROP POLICY IF EXISTS "Auth read siswa_detail" ON public.siswa_detail;
CREATE POLICY "Auth read siswa_detail" ON public.siswa_detail
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_access_akademik_siswa(auth.uid(), siswa_id)
);
DROP POLICY IF EXISTS admin_tu_siswa_detail_all ON public.siswa_detail;
CREATE POLICY admin_tu_siswa_detail_all ON public.siswa_detail
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);

DROP POLICY IF EXISTS "Auth read konfigurasi_pmb" ON public.konfigurasi_pmb;
CREATE POLICY "Auth read konfigurasi_pmb" ON public.konfigurasi_pmb
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);
DROP POLICY IF EXISTS admin_tu_konfigurasi_pmb_all ON public.konfigurasi_pmb;
CREATE POLICY admin_tu_konfigurasi_pmb_all ON public.konfigurasi_pmb
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_manage_akademik_departemen(auth.uid(), departemen_id));

DROP POLICY IF EXISTS "Auth read jadwal" ON public.jadwal;
CREATE POLICY "Auth read jadwal" ON public.jadwal
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_access_akademik_kelas(auth.uid(), kelas_id)
);
DROP POLICY IF EXISTS admin_tu_jadwal_all ON public.jadwal;
CREATE POLICY admin_tu_jadwal_all ON public.jadwal
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id));

DROP POLICY IF EXISTS "Auth read kalender" ON public.kalender_akademik;
CREATE POLICY "Auth read kalender" ON public.kalender_akademik
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR departemen_id IS NULL
  OR public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);
DROP POLICY IF EXISTS admin_tu_kalender_all ON public.kalender_akademik;
CREATE POLICY admin_tu_kalender_all ON public.kalender_akademik
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin_tu')
  AND departemen_id IS NOT NULL
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND departemen_id IS NOT NULL
  AND public.can_manage_akademik_departemen(auth.uid(), departemen_id)
);

DROP POLICY IF EXISTS auth_rpp_select ON public.rpp;
CREATE POLICY auth_rpp_select ON public.rpp
FOR SELECT TO authenticated
USING (
  NOT public.has_role(auth.uid(),'admin_tu')
  OR public.can_access_akademik_kelas(auth.uid(), kelas_id)
);
DROP POLICY IF EXISTS admin_tu_rpp_all ON public.rpp;
CREATE POLICY admin_tu_rpp_all ON public.rpp
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id))
WITH CHECK (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id));

DROP POLICY IF EXISTS admin_tu_presensi_all ON public.presensi_siswa;
CREATE POLICY admin_tu_presensi_all ON public.presensi_siswa
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin_tu') AND public.can_access_akademik_kelas(auth.uid(), kelas_id))
WITH CHECK (
  public.has_role(auth.uid(),'admin_tu')
  AND public.can_access_akademik_kelas(auth.uid(), kelas_id)
  AND public.can_access_akademik_siswa(auth.uid(), siswa_id)
);

-- Extend admin-only academic RPCs, preserving department scoping through RLS/helper checks.
DO $patch$
DECLARE f text;
BEGIN
  SELECT pg_get_functiondef('public.akademik_save_siswa(jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF auth.uid() IS NULL OR NOT has_role(auth.uid(),''admin'') THEN RAISE EXCEPTION ''Akses ditolak''; END IF;',
    'IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),''admin'') OR has_role(auth.uid(),''admin_tu'')) THEN RAISE EXCEPTION ''Akses ditolak''; END IF;'
  );
  f := replace(
    f,
    'dept:=NULLIF(p_siswa->>''departemen_id'','''')::uuid;',
    'dept:=NULLIF(p_siswa->>''departemen_id'','''')::uuid; IF NOT public.can_manage_akademik_departemen(auth.uid(),dept) THEN RAISE EXCEPTION ''Akses lembaga ditolak''; END IF;'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.akademik_mutasi(uuid[],text,uuid,uuid)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF auth.uid() IS NULL OR NOT has_role(auth.uid(),''admin'') THEN RAISE EXCEPTION ''Akses ditolak''; END IF;',
    'IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),''admin'') OR has_role(auth.uid(),''admin_tu'')) THEN RAISE EXCEPTION ''Akses ditolak''; END IF;'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_admin_register(jsonb)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), ''admin'') THEN',
    'IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), ''admin'') OR public.has_role(auth.uid(), ''admin_tu'')) THEN'
  );
  f := replace(
    f,
    'IF NOT FOUND THEN
    RAISE EXCEPTION ''Lembaga tidak valid atau SPMB belum dibuka untuk lembaga ini'';
  END IF;',
    'IF NOT FOUND THEN
    RAISE EXCEPTION ''Lembaga tidak valid atau SPMB belum dibuka untuk lembaga ini'';
  END IF;
  IF NOT public.can_manage_akademik_departemen(auth.uid(), dept.id) THEN
    RAISE EXCEPTION ''Akses lembaga ditolak'';
  END IF;'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_verification_state(uuid)'::regprocedure) INTO f;
  f := replace(
    f,
    'can_verify := public.has_role(uid, ''admin'');',
    'IF NOT public.can_access_akademik_siswa(uid, p_siswa_id) THEN RAISE EXCEPTION ''Siswa tidak ditemukan atau akses ditolak''; END IF;
  can_verify := public.has_role(uid, ''admin'') OR public.has_role(uid, ''admin_tu'');'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_set_field_verifications(uuid,jsonb,text)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF uid IS NULL OR NOT public.has_role(uid, ''admin'') THEN',
    'IF uid IS NULL OR NOT (public.has_role(uid, ''admin'') OR (public.has_role(uid, ''admin_tu'') AND public.can_access_akademik_siswa(uid, p_siswa_id))) THEN'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_set_field_verification(uuid,text,boolean,text)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF uid IS NULL OR NOT public.has_role(uid, ''admin'') THEN',
    'IF uid IS NULL OR NOT (public.has_role(uid, ''admin'') OR (public.has_role(uid, ''admin_tu'') AND public.can_access_akademik_siswa(uid, p_siswa_id))) THEN'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_mark_verified(uuid,text)'::regprocedure) INTO f;
  f := replace(
    f,
    'IF uid IS NULL OR NOT public.has_role(uid, ''admin'') THEN RAISE EXCEPTION ''Akses verifikasi SPMB ditolak''; END IF;',
    'IF uid IS NULL OR NOT (public.has_role(uid, ''admin'') OR (public.has_role(uid, ''admin_tu'') AND public.can_access_akademik_siswa(uid, p_siswa_id))) THEN RAISE EXCEPTION ''Akses verifikasi SPMB ditolak''; END IF;'
  );
  EXECUTE f;

  SELECT pg_get_functiondef('public.spmb_verification_state_list(uuid[])'::regprocedure) INTO f;
  f := replace(
    f,
    'IF uid IS NULL OR NOT public.has_role(uid,''admin'') THEN RAISE EXCEPTION ''Akses ditolak''; END IF;',
    'IF uid IS NULL OR NOT (public.has_role(uid,''admin'') OR public.has_role(uid,''admin_tu'')) THEN RAISE EXCEPTION ''Akses ditolak''; END IF;'
  );
  f := replace(
    f,
    'WHERE s.id=ANY(COALESCE(p_ids,''{}''::uuid[]));',
    'WHERE s.id=ANY(COALESCE(p_ids,''{}''::uuid[])) AND public.can_access_akademik_siswa(uid,s.id);'
  );
  EXECUTE f;
END
$patch$;
