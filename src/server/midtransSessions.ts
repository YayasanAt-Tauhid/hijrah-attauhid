
import { createAdminClient, readEnv } from "./supabase";
import { closeGatewaySession, isGatewayPaid, readGatewayStatus, type GatewayPayload } from "./midtransGateway";
import { limitReconciliationCandidates, runReconciliationBatch } from "./reconciliationBatch";

export async function processGatewayPayment(payload: GatewayPayload) {
  // Status API is authenticated server-to-server. Feed its result through the
  // same verified, idempotent bookkeeping path used for gateway notifications.
  const key = readEnv("MIDTRANS_SERVER_KEY");
  const bytes = new TextEncoder().encode(`${payload.order_id}${payload.status_code}${payload.gross_amount}${key}`);
  const hash = await crypto.subtle.digest("SHA-512", bytes);
  const signature_key = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  const { handleNotification } = await import("./midtransNotification");
  const response = await handleNotification(new Request("https://internal/api/midtrans-notification", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, signature_key }),
  }));
  if (!response.ok) throw new Error("Pencatatan pembayaran online belum selesai. Silakan coba lagi.");
}

export async function closeStoredSession(transaction: any, reason: string) {
  const admin = createAdminClient() as any;
  const key = readEnv("MIDTRANS_SERVER_KEY");
  if (!key) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
  try {
    if (!transaction.snap_token && transaction.metadata?.snap_request &&
        Date.now() - Date.parse(transaction.created_at) > 90000) {
      const status = await readGatewayStatus(transaction.order_id, key);
      if (isGatewayPaid(status)) {
        await processGatewayPayment(status!);
        throw new Error("Pembayaran online sudah berhasil. Muat ulang tagihan.");
      }
      if (!status) {
        // Midtrans documents that recreating an uncharged order invalidates
        // the old token. The replacement token is then canceled, not presented.
        const base = key.startsWith("SB-") ? "https://app.sandbox.midtrans.com" : "https://app.midtrans.com";
        const response = await fetch(base + "/snap/v1/transactions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(key + ":")}` },
          body: JSON.stringify(transaction.metadata.snap_request), signal: AbortSignal.timeout(12000),
        });
        const recovered = await response.json();
        if (!response.ok || !recovered.token) throw new Error("Sesi Midtrans belum dapat dipulihkan. Pembayaran baru tetap ditahan.");
        const { data: saved, error: saveError } = await admin.from("transaksi_midtrans")
          .update({ snap_token: recovered.token }).eq("id", transaction.id).eq("status", "pending")
          .is("gateway_closed_at", null).select("id");
        if (saveError || !saved?.length) throw new Error("Status sesi berubah. Silakan muat ulang tagihan.");
        transaction = { ...transaction, snap_token: recovered.token };
      }
    }
    await closeGatewaySession(transaction, key, processGatewayPayment);
    const { data, error } = await admin.from("transaksi_midtrans").update({
      status: "expired", gateway_closed_at: new Date().toISOString(),
      reconciliation_checked_at: new Date().toISOString(), reconciliation_error: null,
      metadata: { ...(transaction.metadata || {}), session_closure: { reason, source: "automatic", closed_at: new Date().toISOString() } },
    }).eq("id", transaction.id).neq("status", "paid").is("paid_at", null).is("gateway_closed_at", null).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Status transaksi online berubah. Muat ulang tagihan.");
  } catch (error) {
    await admin.from("transaksi_midtrans").update({
      reconciliation_checked_at: new Date().toISOString(),
      reconciliation_error: error instanceof Error ? error.message : "Pemeriksaan Midtrans gagal",
    }).eq("id", transaction.id);
    throw error;
  }
}

/** Used by both checkout and cashier. DB guards remain the final race barrier. */
export async function closeOnlineSessionsForBills(billIds: string[], reason: string, excludeTransactionId?: string) {
  if (!billIds.length) return;
  const admin = createAdminClient() as any;
  const { data: links, error } = await admin.from("transaksi_midtrans_item")
    .select("pembayaran_id, transaksi:transaksi_id(*)").in("tagihan_id", [...new Set(billIds)]);
  if (error) throw error;
  const transactions = new Map<string, any>();
  for (const link of links || []) {
    const tx = link.transaksi;
    if (!tx || tx.id === excludeTransactionId) continue;
    if (tx.status === "paid") {
      if (!link.pembayaran_id) throw new Error("Pembayaran online berhasil dan sedang dicatat. Muat ulang tagihan sebelum melanjutkan.");
    } else if (!tx.gateway_closed_at && (tx.status === "pending" || tx.snap_token)) {
      transactions.set(tx.id, tx);
    }
  }
  for (const transaction of transactions.values()) await closeStoredSession(transaction, reason);
}

interface ReconciliationCandidate {
  id: string;
  order_id: string;
  status: string;
  created_at: string;
  expired_at: string;
  gateway_closed_at: string | null;
  metadata?: { bill_balances?: Record<string, number> } | null;
}

/** Periodic fallback: synchronize paid orders, then revoke stale pages/codes.
 * Failure recording is checked, not fire-and-forget. Candidate selection is
 * rotated atomically in the companion database migration. */
export async function reconcileOnlineSessions() {
  const admin = createAdminClient() as any;
  const key = readEnv("MIDTRANS_SERVER_KEY");
  if (!key) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
  const { data: candidates, error } = await admin.rpc("get_midtrans_reconciliation_candidates");
  if (error) throw error;

  return runReconciliationBatch(limitReconciliationCandidates((candidates || []) as ReconciliationCandidate[]), async (tx) => {
    if (tx.gateway_closed_at && tx.status !== "paid") return "skipped";
    if (Date.now() - Date.parse(tx.created_at) < 90000) return "skipped";

    // Loading one transaction at a time avoids aborting the whole batch when
    // a single historical item is malformed or its relation is unavailable.
    const { data: items, error: itemError } = await admin.from("transaksi_midtrans_item")
      .select("tagihan_id, pembayaran_id, jumlah").eq("transaksi_id", tx.id);
    if (itemError) throw itemError;
    const links = (items || []) as Array<{ tagihan_id: string | null; pembayaran_id: string | null; jumlah: number | string }>;
    if (tx.status === "paid" && links.length > 0 &&
        links.every((i) => i.pembayaran_id)) return "skipped";

    const status = await readGatewayStatus(tx.order_id, key);
    if (isGatewayPaid(status)) {
      await processGatewayPayment(status!);
      return "checked";
    }
    if (tx.status === "paid") {
      throw new Error("Status pembayaran berhasil berbeda dengan gateway; perlu rekonsiliasi.");
    }

    let stale = Date.now() >= Date.parse(tx.expired_at) || tx.status !== "pending";
    for (const item of links) {
      if (!item.tagihan_id) { stale = true; continue; }
      const { data: bill, error: billError } = await admin.from("tagihan")
        .select("nominal, status, pembayaran!pembayaran_tagihan_id_fkey(jumlah)")
        .eq("id", item.tagihan_id).single();
      if (billError) throw billError;
      const payments = bill.pembayaran || [];
      const remaining = Number(bill.nominal) - payments.reduce(
        (sum: number, p: { jumlah: number | string }) => sum + Number(p.jumlah), 0);
      const originalRemaining = tx.metadata?.bill_balances?.[item.tagihan_id];
      if (originalRemaining != null && remaining !== Number(originalRemaining)) stale = true;
      if (originalRemaining == null) {
        const { data: siblings, error: siblingError } = await admin.from("transaksi_midtrans_item")
          .select("transaksi:transaksi_id(status, paid_at)").eq("tagihan_id", item.tagihan_id);
        if (siblingError) throw siblingError;
        if ((siblings || []).some((s: { transaksi?: { status: string; paid_at: string | null } }) =>
            s.transaksi?.status === "paid" &&
            Date.parse(s.transaksi.paid_at || "") > Date.parse(tx.created_at))) stale = true;
      }
      if (remaining < Number(item.jumlah) ||
          !["belum_bayar", "sebagian", "terjadwal"].includes(bill.status)) stale = true;
    }

    if (stale || (status && ["expire", "cancel", "deny", "failure"].includes(status.transaction_status))) {
      // This performs the Snap cancel + Core expire checks before releasing
      // any bill. It never changes a paid transaction to expired.
      await closeStoredSession({ ...tx, transaksi_midtrans_item: items }, "periodic_reconciliation");
      return "closed";
    }
    return "checked";
  }, async (tx, errorText) => {
    const { data: saved, error: writeError } = await admin.from("transaksi_midtrans")
      .update({
        reconciliation_checked_at: new Date().toISOString(),
        reconciliation_error: errorText,
      }).eq("id", tx.id).select("id");
    if (writeError) throw new Error("Gagal menyimpan hasil rekonsiliasi: " + writeError.message);
    if (!saved?.length) throw new Error("Hasil rekonsiliasi tidak tercatat (0 baris)");
  }, 2);
}
