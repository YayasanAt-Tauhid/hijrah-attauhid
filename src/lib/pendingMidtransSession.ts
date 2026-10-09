/** Pure decision rules shared by checkout and pending-payment actions. */
export interface PendingSessionShape {
  status: string;
  snap_token: string | null;
  gateway_closed_at: string | null;
  expired_at: string | null;
}
export interface PaymentItemShape {
  tagihan_id: string | null;
  jumlah: number | string;
}

export function canResumeMidtransSession(session: PendingSessionShape, now = Date.now()): boolean {
  return session.status === "pending" &&
    !!session.snap_token &&
    !session.gateway_closed_at &&
    !!session.expired_at &&
    Number.isFinite(Date.parse(session.expired_at)) &&
    Date.parse(session.expired_at) > now;
}

export function samePaymentItems(existing: PaymentItemShape[], requested: PaymentItemShape[]): boolean {
  if (existing.length !== requested.length || !existing.length) return false;
  const amounts = new Map<string, number>();
  for (const item of existing) {
    if (!item.tagihan_id || amounts.has(item.tagihan_id)) return false;
    amounts.set(item.tagihan_id, Number(item.jumlah));
  }
  if (new Set(requested.map(item => item.tagihan_id)).size !== requested.length) return false;
  return requested.every(item =>
    !!item.tagihan_id &&
    amounts.has(item.tagihan_id) &&
    amounts.get(item.tagihan_id) === Number(item.jumlah));
}

/** Paid transactions are never implicitly canceled. Unclosed legacy sessions
 * must be explicitly confirmed closed before a fresh checkout can proceed. */
export function blocksNewPayment(session: {
  status: string;
  gateway_closed_at: string | null;
  snap_token?: string | null;
  pembayaran_id?: string | null;
}): boolean {
  if (session.status === "paid") return !session.pembayaran_id;
  return !session.gateway_closed_at && (session.status === "pending" || !!session.snap_token);
}
