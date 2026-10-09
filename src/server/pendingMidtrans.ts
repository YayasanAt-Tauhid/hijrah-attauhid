import { createAdminClient, readEnv } from "./supabase";
import { readGatewayStatus, isGatewayPaid } from "./midtransGateway";
import { closeStoredSession, processGatewayPayment } from "./midtransSessions";
import { blocksNewPayment, canResumeMidtransSession, samePaymentItems, type PaymentItemShape } from "@/lib/pendingMidtransSession";

export interface ExistingMidtransPayment {
  success: true;
  snap_token: string;
  order_id: string;
  transaksi_id: string;
  total_amount: number;
  biaya_admin: number;
  reused: true;
  redirect_url: string;
}

const ORDER_PATTERN = /^HAT-[A-Z0-9-]+$/;

export async function resumeOwnedMidtransPayment(userId: string, orderId: string): Promise<ExistingMidtransPayment> {
  if (!ORDER_PATTERN.test(orderId)) throw new Error("Order ID tidak valid");
  const admin = createAdminClient() as any;
  const { data: tx, error } = await admin.from("transaksi_midtrans")
    .select("id, order_id, user_id, status, snap_token, gateway_closed_at, expired_at, created_at, total_amount, metadata, transaksi_midtrans_item(tagihan_id, jumlah)")
    .eq("order_id", orderId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!tx) throw new Error("Transaksi tidak ditemukan untuk akun Anda");
  if (!canResumeMidtransSession(tx)) {
    throw new Error("Sesi pembayaran sudah tidak aktif. Batalkan sesi lama dari Riwayat sebelum membuat pembayaran baru.");
  }

  const links = (tx.transaksi_midtrans_item || []) as PaymentItemShape[];
  if (!links.length) throw new Error("Rincian pembayaran tidak ditemukan. Hubungi admin sekolah.");
  for (const link of links) {
    if (!link.tagihan_id) throw new Error("Tagihan transaksi tidak valid.");
    const { data: bill, error: billError } = await admin.from("tagihan")
      .select("nominal, status, pembayaran!pembayaran_tagihan_id_fkey(jumlah)")
      .eq("id", link.tagihan_id).single();
    if (billError) throw billError;
    const paid = (bill.pembayaran || []).reduce(
      (sum: number, p: { jumlah: number | string }) => sum + Number(p.jumlah), 0);
    const remaining = Number(bill.nominal) - paid;
    const oldBalance = tx.metadata?.bill_balances?.[link.tagihan_id];
    if (!["belum_bayar", "sebagian", "terjadwal"].includes(bill.status) ||
      remaining < Number(link.jumlah) ||
      (oldBalance != null && Number(oldBalance) !== remaining)) {
      throw new Error("Sisa tagihan berubah atau sudah dibayar. Batalkan sesi lama, lalu periksa kembali tagihan.");
    }
    // A different settled checkout after this token was created makes re-use unsafe.
    const { data: siblings, error: siblingError } = await admin.from("transaksi_midtrans_item")
      .select("transaksi:transaksi_id(status, paid_at)")
      .eq("tagihan_id", link.tagihan_id);
    if (siblingError) throw siblingError;
    if ((siblings || []).some((s: any) => s.transaksi?.status === "paid" &&
      Date.parse(s.transaksi.paid_at || "") > Date.parse(tx.created_at))) {
      throw new Error("Tagihan sudah dibayar melalui transaksi lain. Jangan gunakan token lama.");
    }
  }

  const key = readEnv("MIDTRANS_SERVER_KEY");
  if (!key) throw new Error("Konfigurasi pembayaran belum tersedia.");
  const gateway = await readGatewayStatus(orderId, key);
  if (isGatewayPaid(gateway)) {
    await processGatewayPayment(gateway!);
    throw new Error("Pembayaran sudah berhasil di Midtrans. Muat ulang riwayat pembayaran.");
  }
  if (gateway && ["expire", "cancel", "deny", "failure"].includes(gateway.transaction_status)) {
    throw new Error("Transaksi telah berakhir di Midtrans. Batalkan sesi lama, lalu buat pembayaran baru.");
  }

  // Check again after network calls: a webhook or another cancellation may have
  // changed the row while the official gateway status was being verified.
  const { data: fresh, error: freshError } = await admin.from("transaksi_midtrans")
    .select("status, snap_token, expired_at, gateway_closed_at")
    .eq("id", tx.id).eq("user_id", userId).single();
  if (freshError) throw freshError;
  if (!canResumeMidtransSession(fresh) || fresh.snap_token !== tx.snap_token) {
    throw new Error("Status sesi pembayaran berubah. Muat ulang halaman.");
  }
  const base = key.startsWith("SB-") ? "https://app.sandbox.midtrans.com" : "https://app.midtrans.com";
  return {
    success: true, snap_token: tx.snap_token, order_id: tx.order_id, transaksi_id: tx.id,
    total_amount: Number(tx.total_amount), biaya_admin: 0, reused: true,
    redirect_url: base + "/snap/v2/vtweb/" + encodeURIComponent(tx.snap_token),
  };
}

export async function findReusablePaymentForBills(userId: string, items: PaymentItemShape[]) {
  const admin = createAdminClient() as any;
  const billIds = items.map(item => item.tagihan_id).filter(Boolean);
  if (!billIds.length) return null;
  const { data: rows, error } = await admin.from("transaksi_midtrans_item")
    .select("transaksi_id, tagihan_id, jumlah, pembayaran_id, transaksi:transaksi_id(id,order_id,user_id,status,snap_token,gateway_closed_at,expired_at)")
    .in("tagihan_id", [...new Set(billIds)]);
  if (error) throw error;
  const blockers = new Map<string, any>();
  for (const item of rows || []) {
    const tx = item.transaksi;
    if (!tx) continue;
    if (blocksNewPayment({ status: tx.status, gateway_closed_at: tx.gateway_closed_at,
      snap_token: tx.snap_token, pembayaran_id: item.pembayaran_id })) blockers.set(tx.id, tx);
  }
  if (!blockers.size) return null;
  if (blockers.size !== 1) {
    throw new Error("Ada beberapa sesi online lama untuk tagihan ini. Hubungi admin agar tidak terjadi pembayaran ganda.");
  }

  const tx = Array.from(blockers.values())[0];
  if (tx.user_id !== userId) {
    throw new Error("Ada pembayaran online lain yang masih diproses pada tagihan ini. Hubungi admin sekolah.");
  }
  if (tx.status === "paid") {
    throw new Error("Pembayaran online berhasil dan sedang dibukukan. Muat ulang tagihan sebelum membayar kembali.");
  }
  const { data: txItems, error: itemsError } = await admin.from("transaksi_midtrans_item")
    .select("tagihan_id, jumlah").eq("transaksi_id", tx.id);
  if (itemsError) throw itemsError;
  if (!samePaymentItems((txItems || []) as PaymentItemShape[], items)) {
    throw new Error("Masih ada sesi pembayaran untuk sebagian tagihan yang dipilih. Batalkan dari Riwayat sebelum membuat pembayaran baru.");
  }
  // Expired/failed sessions cannot be reused and must first be closed via Midtrans.
  return resumeOwnedMidtransPayment(userId, tx.order_id);
}

export async function cancelOwnedMidtransPayment(userId: string, orderId: string) {
  if (!ORDER_PATTERN.test(orderId)) throw new Error("Order ID tidak valid");
  const admin = createAdminClient() as any;
  const { data: tx, error } = await admin.from("transaksi_midtrans")
    .select("*").eq("order_id", orderId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!tx) throw new Error("Transaksi tidak ditemukan untuk akun Anda");
  if (tx.status === "paid" || tx.paid_at) {
    throw new Error("Pembayaran sudah lunas dan tidak dapat dibatalkan melalui menu ini.");
  }
  if (!tx.gateway_closed_at) await closeStoredSession(tx, "parent_canceled_payment");
  return { success: true, order_id: orderId };
}
