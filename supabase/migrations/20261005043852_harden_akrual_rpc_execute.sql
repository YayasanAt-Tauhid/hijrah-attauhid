-- Hardening RPC akrual jatuh tempo.
-- Fungsi-fungsi ini SECURITY DEFINER dan tidak boleh dieksekusi langsung
-- oleh role publik. Pemanggilan aplikasi memakai service_role, sedangkan
-- pg_cron harian berjalan sebagai postgres.

REVOKE ALL ON FUNCTION public.posting_piutang_jatuh_tempo(date, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.posting_piutang_jatuh_tempo(date, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.posting_piutang_jatuh_tempo(date, uuid, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public.jalankan_akrual_jatuh_tempo(date, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jalankan_akrual_jatuh_tempo(date, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.jalankan_akrual_jatuh_tempo(date, uuid, integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.posting_piutang_jatuh_tempo(date, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.posting_piutang_jatuh_tempo(date, uuid, integer) TO postgres;

GRANT EXECUTE ON FUNCTION public.jalankan_akrual_jatuh_tempo(date, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.jalankan_akrual_jatuh_tempo(date, uuid, integer) TO postgres;
