-- Ensure the portal billing view obeys the caller's RLS policies.
ALTER VIEW public.v_tagihan_belum_bayar SET (security_invoker = true);