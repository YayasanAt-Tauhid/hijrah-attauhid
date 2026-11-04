-- Hak akses modul Keuangan per peran, dapat diatur admin dari UI.
--
-- * Peran baru `bendahara`.
-- * Tabel `role_permissions` (peran × izin) + `role_permission_log` (audit perubahan).
-- * `has_permission(uid, izin)`: admin selalu true; peran lain lewat tabel.
-- * `has_role(uid,'keuangan')` kini juga true untuk bendahara/sekretaris_yayasan
--   yang aktif dan memiliki izin `keuangan.akses_data`. Cara ini memberi mereka
--   akses data keuangan di semua kebijakan RLS yang menyebut `keuangan` tanpa
--   menulis ulang 40 kebijakan; pembatasan halus per fitur ada di server dan UI.
-- * Isian awal meniru perilaku lama untuk keuangan/kasir (tidak ada perubahan
--   bagi pengguna yang sudah ada).
--
-- Mengembalikan ke keadaan lama (bila perlu):
--   1) CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text) ... lama:
--        SELECT EXISTS (SELECT 1 FROM public.users_profile WHERE id = _user_id AND role = _role)
--   2) kembalikan validate_user_role tanpa 'bendahara' (pastikan tidak ada pengguna bendahara)
--   3) DROP FUNCTION public.has_permission(uuid,text), public.set_role_permissions(text,text[],uuid);
--      DROP TABLE public.role_permission_log, public.role_permissions;
--
-- Tidak diterapkan otomatis ke produksi: terapkan manual setelah konfirmasi.

CREATE OR REPLACE FUNCTION public.validate_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS NOT NULL AND NEW.role NOT IN (
    'admin','admin_tu','kepala_sekolah','guru','keuangan','kasir','pustakawan','siswa','ortu',
    'sekretaris_yayasan','bendahara'
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
$function$;

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role text NOT NULL,
  permission text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS public.role_permission_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  granted text[] NOT NULL DEFAULT '{}',
  revoked text[] NOT NULL DEFAULT '{}',
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permission_log ENABLE ROW LEVEL SECURITY;

-- Daftar izin per peran tidak rahasia dan dibutuhkan klien untuk menyusun menu.
-- Perubahan hanya lewat server function (service_role); tidak ada kebijakan tulis.
DROP POLICY IF EXISTS role_permissions_read ON public.role_permissions;
CREATE POLICY role_permissions_read ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS role_permission_log_admin_read ON public.role_permission_log;
CREATE POLICY role_permission_log_admin_read ON public.role_permission_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.role_permissions, public.role_permission_log FROM PUBLIC, anon;
GRANT SELECT ON public.role_permissions, public.role_permission_log TO authenticated;
GRANT ALL ON public.role_permissions, public.role_permission_log TO service_role;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profile u
    WHERE u.id = _user_id
      AND COALESCE(u.aktif, true)
      AND (
        u.role = 'admin'
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role = u.role AND rp.permission = _permission
        )
      )
  )
$function$;

REVOKE ALL ON FUNCTION public.has_permission(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profile u
    WHERE u.id = _user_id
      AND (
        u.role = _role
        OR (
          _role = 'keuangan'
          AND u.role IN ('bendahara','sekretaris_yayasan')
          AND COALESCE(u.aktif, true)
          AND EXISTS (
            SELECT 1 FROM public.role_permissions rp
            WHERE rp.role = u.role AND rp.permission = 'keuangan.akses_data'
          )
        )
      )
  )
$function$;

-- Pengaturan izin satu peran secara atomik (hapus + tambah + catat audit dalam satu
-- transaksi). Validasi kunci izin dilakukan server function; admin dicek ulang di sini.
CREATE OR REPLACE FUNCTION public.set_role_permissions(
  p_role text,
  p_permissions text[],
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old text[];
  v_new text[];
  v_granted text[];
  v_revoked text[];
BEGIN
  IF p_actor_id IS NULL OR NOT public.has_role(p_actor_id, 'admin') THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('keuangan','kasir','bendahara','sekretaris_yayasan') THEN
    RAISE EXCEPTION 'Peran tidak dapat diatur';
  END IF;

  v_new := COALESCE(ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_permissions, '{}'::text[])) x ORDER BY x), '{}'::text[]);
  SELECT COALESCE(array_agg(permission ORDER BY permission), '{}'::text[]) INTO v_old
  FROM public.role_permissions WHERE role = p_role;

  v_granted := COALESCE(ARRAY(SELECT x FROM (SELECT unnest(v_new) EXCEPT SELECT unnest(v_old)) g(x) ORDER BY x), '{}'::text[]);
  v_revoked := COALESCE(ARRAY(SELECT x FROM (SELECT unnest(v_old) EXCEPT SELECT unnest(v_new)) r(x) ORDER BY x), '{}'::text[]);

  DELETE FROM public.role_permissions WHERE role = p_role AND permission = ANY(v_revoked);
  INSERT INTO public.role_permissions (role, permission, updated_by)
  SELECT p_role, x, p_actor_id FROM unnest(v_granted) x;

  IF cardinality(v_granted) + cardinality(v_revoked) > 0 THEN
    INSERT INTO public.role_permission_log (role, granted, revoked, changed_by)
    VALUES (p_role, v_granted, v_revoked, p_actor_id);
  END IF;

  RETURN jsonb_build_object('granted', to_jsonb(v_granted), 'revoked', to_jsonb(v_revoked));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_role_permissions(text,text[],uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_role_permissions(text,text[],uuid) TO service_role;

-- Isian awal (sama dengan DEFAULT_ROLE_PERMISSIONS di src/lib/permissions.ts).
INSERT INTO public.role_permissions (role, permission) VALUES
  ('keuangan','keuangan.pembayaran'), ('keuangan','keuangan.transaksi'), ('keuangan','keuangan.rekap_kasir'),
  ('keuangan','keuangan.laporan'), ('keuangan','keuangan.akuntansi'), ('keuangan','keuangan.diskon'),
  ('keuangan','keuangan.pengaturan'), ('keuangan','keuangan.pembatalan.ajukan'),
  ('kasir','keuangan.pembayaran'), ('kasir','keuangan.rekap_kasir'), ('kasir','keuangan.pembatalan.ajukan'),
  ('bendahara','keuangan.akses_data'), ('bendahara','keuangan.pembayaran'), ('bendahara','keuangan.transaksi'),
  ('bendahara','keuangan.pembatalan.ajukan'), ('bendahara','keuangan.pembatalan.setujui'),
  ('bendahara','keuangan.rekap_kasir'), ('bendahara','keuangan.laporan'), ('bendahara','keuangan.akuntansi'),
  ('bendahara','keuangan.diskon'), ('bendahara','keuangan.pengaturan'),
  ('sekretaris_yayasan','keuangan.akses_data'), ('sekretaris_yayasan','keuangan.pembayaran'),
  ('sekretaris_yayasan','keuangan.transaksi'), ('sekretaris_yayasan','keuangan.pembatalan.ajukan'),
  ('sekretaris_yayasan','keuangan.pembatalan.setujui'), ('sekretaris_yayasan','keuangan.rekap_kasir'),
  ('sekretaris_yayasan','keuangan.laporan'), ('sekretaris_yayasan','keuangan.akuntansi'),
  ('sekretaris_yayasan','keuangan.diskon'), ('sekretaris_yayasan','keuangan.pengaturan')
ON CONFLICT (role, permission) DO NOTHING;
