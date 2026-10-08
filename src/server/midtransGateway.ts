
export type GatewayPayload = Record<string, any>;
export interface GatewaySession {
  order_id: string;
  snap_token: string | null;
  created_at: string;
}
const paid = (p: GatewayPayload | null) => p?.transaction_status === "settlement" ||
  (p?.transaction_status === "capture" && p?.fraud_status === "accept");
const terminal = (p: GatewayPayload | null) =>
  ["expire", "cancel", "deny", "failure"].includes(p?.transaction_status);
export const isGatewayPaid = paid;

function endpoint(key: string, kind: "api" | "app") {
  return `https://${kind}${key.startsWith("SB-") ? ".sandbox" : ""}.midtrans.com`;
}
async function request(key: string, url: string, method: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    method, headers: { Authorization: `Basic ${btoa(key + ":")}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json() as GatewayPayload;
  return { response, data };
}

export async function readGatewayStatus(order: string, key: string, fetcher = fetch): Promise<GatewayPayload | null> {
  const { response, data } = await request(key, `${endpoint(key, "api")}/v2/${encodeURIComponent(order)}/status`, "GET", fetcher);
  // A Snap session without a selected payment method has no Core transaction.
  // This is NOT evidence that its checkout page is closed.
  if ((response.status === 404 || String(data.status_code) === "404") && String(data.status_code) === "404") return null;
  if (!response.ok || !data.transaction_status) throw new Error("Status Midtrans belum dapat dipastikan. Silakan coba lagi.");
  return data;
}

/** Close both the Snap page and any VA/QR/payment code before releasing a bill. */
export async function closeGatewaySession(
  session: GatewaySession, key: string,
  processPaid: (payload: GatewayPayload) => Promise<void>,
  fetcher = fetch,
): Promise<void> {
  let state = await readGatewayStatus(session.order_id, key, fetcher);
  async function rejectPaid() {
    if (paid(state)) {
      await processPaid(state!);
      throw new Error("Pembayaran online sudah berhasil. Muat ulang tagihan sebelum membayar kembali.");
    }
  }
  await rejectPaid();
  if (!session.snap_token) throw new Error("Sesi pembayaran sedang dibuat atau perlu diperiksa. Silakan coba lagi.");
  const snapUrl = `${endpoint(key, "app")}/snap/v1/transactions/${encodeURIComponent(session.snap_token)}/cancel`;
  const expire = async () => {
    const result = await request(key, `${endpoint(key, "api")}/v2/${encodeURIComponent(session.order_id)}/expire`, "POST", fetcher);
    if (!result.response.ok || !terminal(result.data)) {
      state = await readGatewayStatus(session.order_id, key, fetcher);
      await rejectPaid();
      if (!terminal(state)) throw new Error("Kode pembayaran lama belum dapat ditutup di Midtrans. Silakan coba lagi.");
    }
  };
  const cancel = () => request(key, snapUrl, "POST", fetcher);
  let cancellation = await cancel();
  const message = (data: GatewayPayload) =>
    [data.message, data.status_message, ...(Array.isArray(data.error_messages) ? data.error_messages : [])].filter(Boolean).join(" ").toLowerCase();
  if (message(cancellation.data).includes("transaction is on progress")) {
    state = await readGatewayStatus(session.order_id, key, fetcher);
    await rejectPaid();
    if (state?.transaction_status === "pending") await expire();
    cancellation = await cancel();
  }
  const alreadyCanceled = message(cancellation.data).includes("token already canceled");
  // Tokens have a documented maximum lifetime of seven days. Only use this
  // fallback for an old missing token; payment codes still need Core expiry.
  const agedMissingToken = message(cancellation.data).includes("token not found") &&
    Date.now() - Date.parse(session.created_at) > 7 * 24 * 3600 * 1000;
  if (!(cancellation.response.ok && cancellation.data.canceled_at) && !alreadyCanceled && !agedMissingToken) {
    throw new Error("Sesi pembayaran lama belum dapat ditutup di Midtrans. Pembayaran baru ditahan; silakan coba lagi.");
  }
  state = await readGatewayStatus(session.order_id, key, fetcher);
  await rejectPaid();
  if (state?.transaction_status === "pending") {
    await expire();
    state = await readGatewayStatus(session.order_id, key, fetcher);
    await rejectPaid();
  }
  if (state && !terminal(state)) throw new Error("Transaksi lama masih diproses Midtrans. Pembayaran baru ditahan.");
}

export function paymentExpiry(now: Date) {
  return {
    start_time: now.toISOString().slice(0, 19).replace("T", " ") + " +0000",
    unit: "hours",
    duration: 24,
  };
}
