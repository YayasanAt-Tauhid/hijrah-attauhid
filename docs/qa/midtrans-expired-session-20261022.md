# Expired Midtrans sessions — 22 October 2026

An uncharged Snap checkout could remain pending in Hijrah after its payment expiry. The authenticated Core status API returned 404, but Snap cancellation returned `expiry must be greater than the current time`. The existing closure path correctly refused to release the bill, leaving parents unable to start another payment.

The closure path now rechecks Core status, then replaces that same uncharged order using its stored server-generated request with a fresh five-minute payment/page expiry. Midtrans documents that recreating an uncharged order invalidates its earlier token. The replacement is saved with guards against paid, closed, or concurrently replaced sessions, canceled immediately, and followed by another Core status check. The bill is released only after verified cancellation. Lost-token recovery uses the same path instead of replaying an expired absolute timestamp.

Checkout also closes expired blockers through this verified path before deciding whether to resume an active payment. This applies to bills whose ownership was already checked by checkout, including expired sessions created by another linked parent. Active sessions and paid transactions retain their existing protections.

## Validation

- Existing 573 tests plus 18 new regression tests passed (591 total across local runs).
- Production build completed successfully.
- Real Midtrans Sandbox test reproduced the exact expiry error: Core 404 → cancel 400 expiry validation → Core 404 → same-order replacement 201 → cancellation 200 with `canceled_at` → Core 404.
- Regression coverage includes an issued payment code, settlement before/during recovery, database write races, replacement cancellation failure, metadata preservation, and active sessions from another parent.
- No SQL migrations, payment entries, receipt entries, or bill amounts are changed by this fix.

Gateway/network errors continue to hold the bill until closure can be verified. The recovery does not rotate orders that already have a Core transaction.

## References

- https://docs.midtrans.com/docs/snap-advanced-feature — Re-creating Snap Token for Particular Order
- https://docs.midtrans.com/reference/cancel-a-snap-session
