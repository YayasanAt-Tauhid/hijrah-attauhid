-- Cover foreign keys used by SPP category/nominal-per-period tables.
-- Performance-only migration: no row/data changes.

CREATE INDEX IF NOT EXISTS spp_kategori_periode_audit_id_idx
  ON public.spp_kategori_periode (audit_id);

CREATE INDEX IF NOT EXISTS spp_kategori_periode_jenis_id_idx
  ON public.spp_kategori_periode (jenis_id);

CREATE INDEX IF NOT EXISTS spp_kategori_periode_audit_dibuat_oleh_idx
  ON public.spp_kategori_periode_audit (dibuat_oleh);

CREATE INDEX IF NOT EXISTS spp_kategori_periode_audit_jenis_id_idx
  ON public.spp_kategori_periode_audit (jenis_id);
