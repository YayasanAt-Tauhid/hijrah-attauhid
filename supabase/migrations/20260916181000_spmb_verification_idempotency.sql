-- Idempotency is guaranteed by row locks + the already-verified early return in
-- spmb_mark_verified(). Do not deduplicate solely by data fingerprint because a
-- record can legitimately change and later return to the same saved values after
-- a new officer review.
DROP INDEX IF EXISTS public.spmb_verifikasi_audit_verified_once_idx;
