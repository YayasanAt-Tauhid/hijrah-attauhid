-- Log akrual harian: galat job pg_cron `akrual-jatuh-tempo-harian` tidak lagi senyap.
--
-- Latar belakang: jalankan_akrual_jatuh_tempo() hanya mengembalikan galat di array `errors` pada hasil jsonb;
-- pg_cron selalu mencatat `succeeded`, jadi galat (mis. 33 SPP Okt 2026 yang pembayarannya tanpa jurnal) tidak
-- pernah terlihat. Migration ini ADITIF terhadap fungsi: fungsi lama TIDAK diubah.
--   * tabel akrual_harian_log (immutable, RLS: hanya admin/keuangan yang dapat membaca);
--   * fungsi jalankan_akrual_harian_berlog() yang membungkus fungsi lama, mencatat hasilnya, dan mencatat
--     kegagalan total tanpa ikut menggagalkan job;
--   * satu-satunya perubahan pada objek yang sudah ada: perintah job cron id `akrual-jatuh-tempo-harian`
--     (dijaga: hanya bila pg_cron ada dan perintah lama persis seperti yang ditinjau).
--
-- Rollback perintah cron:
--   select cron.alter_job(job_id := <jobid>, command := 'select public.jalankan_akrual_jatuh_tempo();');

DO $preflight$
BEGIN
  IF to_regprocedure('public.jalankan_akrual_jatuh_tempo(date,uuid,integer)') IS NULL
     OR to_regprocedure('public.has_role(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Dependensi log akrual harian belum lengkap; tinjau schema sebelum migrasi';
  END IF;
  IF md5(pg_get_functiondef('public.jalankan_akrual_jatuh_tempo(date,uuid,integer)'::regprocedure))<>'d5c32a9b95511fa51dcb40e087cb0200' THEN
    RAISE EXCEPTION 'Definisi jalankan_akrual_jatuh_tempo berubah sejak ditinjau; hentikan dan tinjau ulang sebelum migrasi';
  END IF;
END;
$preflight$;

CREATE TABLE public.akrual_harian_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dijalankan_at timestamptz NOT NULL DEFAULT now(),
  sumber text NOT NULL DEFAULT 'cron' CHECK (sumber IN ('cron','manual')),
  sampai_tanggal date,
  piutang_diposting integer NOT NULL DEFAULT 0,
  piutang_nominal numeric NOT NULL DEFAULT 0,
  pendapatan_diakui integer NOT NULL DEFAULT 0,
  pendapatan_nominal numeric NOT NULL DEFAULT 0,
  jumlah_galat integer NOT NULL DEFAULT 0 CHECK (jumlah_galat >= 0),
  galat jsonb NOT NULL DEFAULT '[]'::jsonb,
  galat_terpotong boolean NOT NULL DEFAULT false,
  gagal_total boolean NOT NULL DEFAULT false,
  pesan_gagal text
);
CREATE INDEX akrual_harian_log_waktu_idx ON public.akrual_harian_log (dijalankan_at DESC);

ALTER TABLE public.akrual_harian_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.akrual_harian_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.akrual_harian_log TO authenticated;
CREATE POLICY akrual_harian_log_staff_read ON public.akrual_harian_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'keuangan'));

CREATE FUNCTION public.guard_akrual_harian_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Log akrual harian tidak dapat diubah atau dihapus';
END;
$function$;
CREATE TRIGGER guard_akrual_harian_log_immutable
  BEFORE UPDATE OR DELETE ON public.akrual_harian_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_akrual_harian_log_immutable();
CREATE TRIGGER guard_akrual_harian_log_truncate
  BEFORE TRUNCATE ON public.akrual_harian_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_akrual_harian_log_immutable();

CREATE FUNCTION public.jalankan_akrual_harian_berlog(
  p_sampai_tanggal date DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_sumber text DEFAULT 'cron'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v jsonb;
  v_galat jsonb;
  v_jumlah integer;
BEGIN
  BEGIN
    v := public.jalankan_akrual_jatuh_tempo(p_sampai_tanggal, p_user_id, p_limit);
  EXCEPTION WHEN OTHERS THEN
    -- Pekerjaan fungsi lama di-rollback oleh blok ini; kegagalan dicatat dan job tidak ikut gagal.
    INSERT INTO public.akrual_harian_log(sumber, sampai_tanggal, jumlah_galat, galat, gagal_total, pesan_gagal)
    VALUES (p_sumber, COALESCE(p_sampai_tanggal, (now() AT TIME ZONE 'Asia/Jakarta')::date), 1,
            jsonb_build_array(left(SQLERRM, 500)), true, left(SQLERRM, 1000));
    RETURN jsonb_build_object('gagal_total', true, 'pesan', left(SQLERRM, 1000));
  END;

  v_galat := CASE WHEN jsonb_typeof(v->'errors') = 'array' THEN v->'errors' ELSE '[]'::jsonb END;
  v_jumlah := jsonb_array_length(v_galat);
  INSERT INTO public.akrual_harian_log(sumber, sampai_tanggal, piutang_diposting, piutang_nominal, pendapatan_diakui,
    pendapatan_nominal, jumlah_galat, galat, galat_terpotong)
  VALUES (p_sumber, NULLIF(v->>'sampai_tanggal','')::date,
    COALESCE(NULLIF(v->>'piutang_diposting','')::integer, 0), COALESCE(NULLIF(v->>'piutang_nominal','')::numeric, 0),
    COALESCE(NULLIF(v->>'pendapatan_diakui','')::integer, 0), COALESCE(NULLIF(v->>'pendapatan_nominal','')::numeric, 0),
    v_jumlah,
    COALESCE((SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_galat) e LIMIT 200) x), '[]'::jsonb),
    v_jumlah > 200);
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.jalankan_akrual_harian_berlog(date,uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jalankan_akrual_harian_berlog(date,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jalankan_akrual_harian_berlog(date,uuid,integer,text) TO postgres;

DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron tidak tersedia di database ini; perintah job akrual tidak diubah';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job
   WHERE jobname = 'akrual-jatuh-tempo-harian' AND command = 'select public.jalankan_akrual_jatuh_tempo();';
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Job akrual-jatuh-tempo-harian tidak ditemukan atau perintahnya sudah berubah; tinjau sebelum migrasi';
  END IF;
  PERFORM cron.alter_job(job_id := v_job, command := 'select public.jalankan_akrual_harian_berlog();');
END;
$cron$;
