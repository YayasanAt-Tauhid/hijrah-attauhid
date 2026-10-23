-- Fix SPP awal tanpa kelas: the original INVOKER function cannot read the
-- intentionally protected per-period SPP snapshot table. Keep the main RPC
-- invoker and expose only a role-checked, read-only conflict predicate.
-- Database target: Hijrah At-Tauhid production. No student/tagihan data edits.

DO $preflight$
BEGIN
  IF (SELECT md5(pg_get_functiondef('public.terbitkan_spp_awal_spmb(uuid,uuid,uuid,date,numeric)'::regprocedure)))
    IS DISTINCT FROM '0f5386909546ef21a0be58cf91833002' THEN
    RAISE EXCEPTION 'terbitkan_spp_awal_spmb berubah sejak review: hentikan migrasi';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.spmb_spp_period_nominal_conflict(
  p_siswa_id uuid, p_jenis_id uuid, p_bulan date, p_nominal numeric
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL
    OR NOT (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'keuangan')
    ) THEN
    RAISE EXCEPTION 'Akses pemeriksaan nominal SPP ditolak';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.spp_kategori_periode k
    WHERE k.siswa_id = p_siswa_id
      AND k.jenis_id = p_jenis_id
      AND k.periode = p_bulan
      AND k.nominal_bruto IS DISTINCT FROM p_nominal
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.spmb_spp_period_nominal_conflict(uuid,uuid,date,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spmb_spp_period_nominal_conflict(uuid,uuid,date,numeric)
  TO authenticated;

-- Preserve every other guard and the SECURITY INVOKER mode of the original.
DO $patch$
DECLARE
  v_definition text;
  v_old text := $old$IF EXISTS (SELECT 1 FROM public.spp_kategori_periode k
    WHERE k.siswa_id=p_siswa_id AND k.jenis_id=p_jenis_id AND k.periode=p_bulan_mulai
      AND k.nominal_bruto IS DISTINCT FROM p_nominal) THEN$old$;
  v_new text := 'IF public.spmb_spp_period_nominal_conflict(p_siswa_id,p_jenis_id,p_bulan_mulai,p_nominal) THEN';
BEGIN
  v_definition := pg_get_functiondef(
    'public.terbitkan_spp_awal_spmb(uuid,uuid,uuid,date,numeric)'::regprocedure
  );
  IF (length(v_definition)-length(replace(v_definition,v_old,''))) <> length(v_old) THEN
    RAISE EXCEPTION 'Pemeriksaan snapshot SPP tidak cocok satu kali: hentikan migrasi';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$patch$;