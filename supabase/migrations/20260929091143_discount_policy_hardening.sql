-- Follow-up hardening for versioned discount policies:
-- explicit service-role-only RLS policy and indexes for newly introduced FKs.

DROP POLICY IF EXISTS kebijakan_keringanan_service_role_all
  ON public.kebijakan_keringanan;

CREATE POLICY kebijakan_keringanan_service_role_all
  ON public.kebijakan_keringanan
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_kebijakan_keringanan_jenis_id
  ON public.kebijakan_keringanan(jenis_id);

CREATE INDEX IF NOT EXISTS idx_kebijakan_keringanan_dibuat_oleh
  ON public.kebijakan_keringanan(dibuat_oleh)
  WHERE dibuat_oleh IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_siswa_diskon_kebijakan_keringanan_id
  ON public.siswa_diskon(kebijakan_keringanan_id)
  WHERE kebijakan_keringanan_id IS NOT NULL;