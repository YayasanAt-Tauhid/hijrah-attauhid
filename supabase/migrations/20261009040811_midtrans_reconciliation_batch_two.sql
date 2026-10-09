-- Reduce each signed scheduler invocation to two gateway sessions.
-- This modifies only candidate reservation timestamps, never payment amounts,
-- payment states, gateway closure timestamps, or journals.
-- The batch still rotates fairly and locks candidate rows atomically.
CREATE OR REPLACE FUNCTION public.get_midtrans_reconciliation_candidates()
RETURNS SETOF public.transaksi_midtrans
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH picked AS MATERIALIZED (
    SELECT t.id
    FROM public.transaksi_midtrans AS t
    WHERE (
      t.gateway_closed_at IS NULL AND
      (t.status = 'pending' OR (t.status <> 'paid' AND t.snap_token IS NOT NULL))
    ) OR (
      t.status = 'paid' AND EXISTS (
        SELECT 1 FROM public.transaksi_midtrans_item AS i
        WHERE i.transaksi_id = t.id AND i.pembayaran_id IS NULL
      )
    )
    ORDER BY t.reconciliation_checked_at NULLS FIRST, t.created_at, t.id
    LIMIT 2
    FOR UPDATE OF t SKIP LOCKED
  )
  UPDATE public.transaksi_midtrans AS t
    SET reconciliation_checked_at = clock_timestamp()
  FROM picked
  WHERE t.id = picked.id
  RETURNING t.*;
$function$;

REVOKE ALL ON FUNCTION public.get_midtrans_reconciliation_candidates()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_midtrans_reconciliation_candidates()
  TO service_role;
