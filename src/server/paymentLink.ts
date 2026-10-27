/**
 * Link pembayaran tagihan untuk orang tua yang tidak memakai aplikasi portal.
 *
 * Staf (admin/keuangan/kasir) membuat link berisi tagihan exact satu siswa.
 * Orang tua membuka /bayar#<token>, memilih tagihan dari daftar itu, lalu
 * membayar lewat Midtrans Snap. Pembukuan memakai webhook Midtrans yang sama
 * dengan portal (tidak ada jalur pencatatan baru).
 *
 * Lihat src/lib/paymentLink.ts untuk aturan token, dan migrasi
 * 20261027010000_payment_link_orang_tua.sql untuk penjaga di database.
 */
import { createServerFn } from "@tanstack/react-start";
import { sortBillingSequence, billingPeriodLabel, type BillingSequenceBill } from "@/lib/billingSequence";
import {
  buildPaymentLinkUrl,
  buildWhatsappShareUrl,
  generatePaymentLinkToken,
  hashPaymentLinkToken,
  isLinkInstallmentAllowed,
  isPaymentLinkTokenFormat,
  normalizeWhatsappPhone,
  paymentLinkExpiry,
  paymentLinkMessage,
  paymentLinkState,
  validateLinkSelection,
  type PaymentLinkState,
} from "@/lib/paymentLink";
import { canResumeMidtransSession } from "@/lib/pendingMidtransSession";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";
import { buatTransaksiSnap } from "./payment";
import { closeStoredSession } from "./midtransSessions";
import { cancelOwnedMidtransPayment, resumeOwnedMidtransPayment } from "./pendingMidtrans";

const STAFF_ROLES = ["admin", "keuangan", "kasir"];
const OPEN_STATUSES = ["belum_bayar", "sebagian", "terjadwal"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_PATTERN = /^HAT-[A-Z0-9-]+$/;
/**
 * Tabel payment_link dan kolom transaksi_midtrans.payment_link_id belum ada di
 * tipe Supabase hasil generate, jadi klien admin di modul ini sengaja longgar.
 * Bentuk data yang dibaca tetap diberi tipe eksplisit di bawah.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseAdmin = any;
const adminClient = (): LooseAdmin => createAdminClient();

interface TagihanDbRow extends BillingSequenceBill {
  siswa_id: string;
  nominal: number | string;
  status: string;
  tahun_ajaran_id: string | null;
  jenis: { nama: string } | null;
  pembayaran: Array<{ jumlah: number | string }> | null;
}

interface LinkListDbRow {
  id: string;
  siswa_id: string;
  tagihan_ids: string[];
  cicilan: CicilanMap | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  canceled_at: string | null;
  siswa: { nama: string; nis: string | null } | null;
  pembuat: { email: string | null; pegawai: { nama: string } | null } | null;
}

interface SessionDbRow {
  order_id: string;
  total_amount: number | string;
  status: string;
  snap_token: string | null;
  gateway_closed_at: string | null;
  expired_at: string | null;
}

const INVALID_LINK = "Link pembayaran tidak valid. Mohon gunakan link terbaru dari sekolah.";

export interface PaymentLinkBill {
  id: string;
  jenis_id: string;
  jenis_nama: string;
  bulan: number | null;
  periode: string;
  tahun_ajaran_id: string | null;
  jatuh_tempo: string | null;
  status: string;
  /** Sisa tagihan di database. */
  sisa: number;
  /** Boleh dibayar sebagian (uang pangkal dan tagihan sekali bayar sejenis). */
  boleh_cicil: boolean;
}

/** Tagihan sebagaimana dibayar lewat link: nominal jatuh tempo untuk link ini. */
export interface PaymentLinkDueBill extends PaymentLinkBill {
  siswa_id: string;
  /** Sisa tagihan di database (bisa lebih besar dari `due` bila dicicil). */
  sisa_tagihan: number;
  /** Nominal yang dibayar lewat link ini. */
  due: number;
  cicilan: boolean;
}

type CicilanMap = Record<string, number>;

interface LinkRow {
  id: string;
  siswa_id: string;
  tagihan_ids: string[];
  cicilan: CicilanMap | null;
  expires_at: string;
  canceled_at: string | null;
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} tidak valid`);
  }
  return value;
}

/** Tagihan terbuka (sisa > 0) milik siswa dari daftar id, urut dari yang terlama. */
async function loadOpenBills(admin: LooseAdmin, ids: string[], siswaId?: string): Promise<Array<PaymentLinkBill & { siswa_id: string }>> {
  if (!ids.length) return [];
  let query = admin
    .from("tagihan")
    .select(
      "id, siswa_id, jenis_id, bulan, nominal, status, jatuh_tempo, tahun_ajaran_id, " +
      "jenis:jenis_id(nama), tahun_ajaran:tahun_ajaran_id(nama, tanggal_mulai), " +
      "pembayaran!pembayaran_tagihan_id_fkey(jumlah)",
    )
    .in("id", [...new Set(ids)]);
  if (siswaId) query = query.eq("siswa_id", siswaId);
  const { data, error } = await query.in("status", OPEN_STATUSES);
  if (error) throw new Error("Gagal memuat tagihan: " + error.message);

  const open = ((data ?? []) as TagihanDbRow[])
    .map((row) => {
      const paid = (row.pembayaran ?? []).reduce((sum: number, p: { jumlah: number | string }) => sum + Number(p.jumlah || 0), 0);
      return { ...row, sisa: Math.max(Number(row.nominal || 0) - paid, 0) };
    })
    .filter((row) => OPEN_STATUSES.includes(row.status) && row.sisa > 0);

  return sortBillingSequence(open).map((row) => ({
    id: row.id,
    siswa_id: row.siswa_id,
    jenis_id: row.jenis_id,
    jenis_nama: row.jenis?.nama ?? "Tagihan",
    bulan: row.bulan ?? null,
    periode: row.bulan ? billingPeriodLabel(row) : (row.tahun_ajaran?.nama ?? ""),
    tahun_ajaran_id: row.tahun_ajaran_id ?? null,
    jatuh_tempo: row.jatuh_tempo ?? null,
    status: row.status,
    sisa: row.sisa,
    boleh_cicil: isLinkInstallmentAllowed({ bulan: row.bulan ?? null, status: row.status, jenis_nama: row.jenis?.nama ?? "" }),
  }));
}

/** Total yang sudah dibayar lewat setiap link, per tagihan (hanya transaksi lunas). */
async function loadPaidViaLinks(admin: LooseAdmin, linkIds: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (!linkIds.length) return result;
  const { data: txs, error } = await admin
    .from("transaksi_midtrans")
    .select("id, payment_link_id")
    .in("payment_link_id", linkIds)
    .eq("status", "paid");
  if (error) throw new Error("Gagal memuat transaksi link: " + error.message);
  const txLink = new Map<string, string>(((txs ?? []) as Array<{ id: string; payment_link_id: string }>).map((t) => [t.id, t.payment_link_id]));
  if (!txLink.size) return result;
  const { data: items, error: itemError } = await admin
    .from("transaksi_midtrans_item")
    .select("transaksi_id, tagihan_id, jumlah")
    .in("transaksi_id", [...txLink.keys()]);
  if (itemError) throw new Error("Gagal memuat rincian transaksi link: " + itemError.message);
  for (const item of (items ?? []) as Array<{ transaksi_id: string; tagihan_id: string | null; jumlah: number | string }>) {
    const linkId = txLink.get(item.transaksi_id);
    if (!linkId || !item.tagihan_id) continue;
    const perBill = result.get(linkId) ?? new Map<string, number>();
    perBill.set(item.tagihan_id, (perBill.get(item.tagihan_id) ?? 0) + Number(item.jumlah || 0));
    result.set(linkId, perBill);
  }
  return result;
}

/**
 * Nominal yang masih bisa dibayar lewat link. Tagihan biasa: sisa tagihan.
 * Tagihan dengan cicilan: nominal cicilan dikurangi yang sudah dibayar lewat
 * link ini, dibatasi sisa tagihan. Cicilan yang sudah terbayar tidak muncul lagi.
 */
function dueBillsForLink(
  link: Pick<LinkRow, "siswa_id" | "tagihan_ids" | "cicilan">,
  bills: Array<PaymentLinkBill & { siswa_id: string }>,
  paidViaLink: Map<string, number> | undefined,
): PaymentLinkDueBill[] {
  const cicilan = link.cicilan ?? {};
  return bills
    .filter((bill) => bill.siswa_id === link.siswa_id && link.tagihan_ids.includes(bill.id))
    .map((bill) => {
      const installment = Number(cicilan[bill.id]);
      const isCicilan = Number.isFinite(installment) && installment > 0;
      const due = isCicilan
        ? Math.min(installment - (paidViaLink?.get(bill.id) ?? 0), bill.sisa)
        : bill.sisa;
      return { ...bill, sisa_tagihan: bill.sisa, due, cicilan: isCicilan };
    })
    .filter((bill) => bill.due > 0);
}

async function loadDueBills(admin: LooseAdmin, link: LinkRow): Promise<PaymentLinkDueBill[]> {
  const [bills, paid] = await Promise.all([
    loadOpenBills(admin, link.tagihan_ids, link.siswa_id),
    loadPaidViaLinks(admin, [link.id]),
  ]);
  return dueBillsForLink(link, bills, paid.get(link.id));
}

// ---------------------------------------------------------------------------
// Staf
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkInput {
  siswa_id: string;
  tagihan_ids: string[];
  /** Nominal cicilan per tagihan (rupiah). Tagihan tanpa entri dilunasi penuh. */
  cicilan?: Record<string, number>;
}

export interface CreatePaymentLinkResult {
  id: string;
  /** Hanya dikembalikan sekali; database tidak menyimpan token mentah. */
  url: string;
  expires_at: string;
  nama_siswa: string;
  total: number;
  telepon: string | null;
  message: string;
  whatsapp_url: string;
}

function validateCicilan(raw: unknown, bills: PaymentLinkBill[]): CicilanMap {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Nominal cicilan tidak valid");
  const byId = new Map(bills.map((b) => [b.id, b]));
  const result: CicilanMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const bill = byId.get(id);
    if (!bill) throw new Error("Nominal cicilan untuk tagihan yang tidak termasuk dalam link");
    if (!bill.boleh_cicil) throw new Error(`${bill.jenis_nama} tidak dapat dicicil dan harus dibayar penuh`);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Nominal cicilan ${bill.jenis_nama} harus berupa angka rupiah lebih dari 0`);
    }
    if (value >= bill.sisa) {
      throw new Error(`Nominal cicilan ${bill.jenis_nama} harus lebih kecil dari sisa tagihan; kosongkan untuk melunasi`);
    }
    result[id] = value;
  }
  return result;
}

export async function createPaymentLinkForStaff(
  userId: string,
  input: CreatePaymentLinkInput,
  origin: string,
): Promise<CreatePaymentLinkResult> {
  const siswaId = assertUuid(input?.siswa_id, "Siswa");
  const ids = validateLinkSelection(input?.tagihan_ids ?? [], input?.tagihan_ids ?? []);
  ids.forEach((id) => assertUuid(id, "Tagihan"));

  const admin = adminClient();
  await requireRole(admin, userId, STAFF_ROLES);

  const bills = await loadOpenBills(admin, ids, siswaId);
  if (bills.length !== ids.length || bills.some((b) => b.siswa_id !== siswaId)) {
    throw new Error("Ada tagihan yang sudah lunas, berubah, atau bukan milik siswa ini. Muat ulang tagihan lalu coba lagi.");
  }
  const cicilan = validateCicilan(input?.cicilan, bills);

  const { data: siswa, error: siswaError } = await admin
    .from("siswa").select("nama, telepon").eq("id", siswaId).single();
  if (siswaError || !siswa) throw new Error("Data siswa tidak ditemukan");

  const token = generatePaymentLinkToken();
  const { data: link, error: insertError } = await admin
    .from("payment_link")
    .insert({
      token_hash: await hashPaymentLinkToken(token),
      siswa_id: siswaId,
      tagihan_ids: ids,
      cicilan,
      created_by: userId,
      expires_at: paymentLinkExpiry(new Date()).toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (insertError || !link) throw new Error("Gagal membuat link pembayaran: " + (insertError?.message ?? ""));

  const url = buildPaymentLinkUrl(origin, token);
  const total = bills.reduce((sum, b) => sum + (cicilan[b.id] ?? b.sisa), 0);
  const telepon = normalizeWhatsappPhone(siswa.telepon);
  const message = paymentLinkMessage({ namaSiswa: siswa.nama, total, url, expiresAt: link.expires_at });
  return {
    id: link.id,
    url,
    expires_at: link.expires_at,
    nama_siswa: siswa.nama,
    total,
    telepon,
    message,
    whatsapp_url: buildWhatsappShareUrl(telepon, message),
  };
}

export type PaymentLinkListRow = {
  id: string;
  nama_siswa: string;
  nis: string | null;
  pembuat: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  canceled_at: string | null;
  state: PaymentLinkState;
  jumlah_tagihan: number;
  sisa_tagihan: number;
  total_sisa: number;
};

export async function listPaymentLinksForStaff(userId: string): Promise<PaymentLinkListRow[]> {
  const admin = adminClient();
  const role = await requireRole(admin, userId, STAFF_ROLES);

  let query = admin
    .from("payment_link")
    .select(
      "id, siswa_id, tagihan_ids, cicilan, created_by, created_at, expires_at, canceled_at, " +
      "siswa:siswa_id(nama, nis), pembuat:created_by(email, pegawai:pegawai_id(nama))",
    );
  // Kasir hanya melihat link buatannya sendiri.
  if (role === "kasir") query = query.eq("created_by", userId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error("Gagal memuat link pembayaran: " + error.message);

  const links = (data ?? []) as LinkListDbRow[];
  const [bills, paid] = await Promise.all([
    loadOpenBills(admin, links.flatMap((l) => l.tagihan_ids ?? [])),
    loadPaidViaLinks(admin, links.map((l) => l.id)),
  ]);
  const now = new Date();
  return links.map((link) => {
    const open = dueBillsForLink(link, bills, paid.get(link.id));
    return {
      id: link.id,
      nama_siswa: link.siswa?.nama ?? "-",
      nis: link.siswa?.nis ?? null,
      pembuat: link.pembuat?.pegawai?.nama ?? link.pembuat?.email ?? "-",
      created_by: link.created_by,
      created_at: link.created_at,
      expires_at: link.expires_at,
      canceled_at: link.canceled_at,
      state: paymentLinkState(link, open.length, now),
      jumlah_tagihan: link.tagihan_ids.length,
      sisa_tagihan: open.length,
      total_sisa: open.reduce((sum, b) => sum + b.due, 0),
    };
  });
}

export async function cancelPaymentLinkForStaff(userId: string, linkId: string): Promise<{ success: true }> {
  assertUuid(linkId, "Link");
  const admin = adminClient();
  const role = await requireRole(admin, userId, STAFF_ROLES);

  const { data: link, error } = await admin
    .from("payment_link").select("id, created_by, canceled_at").eq("id", linkId).maybeSingle();
  if (error) throw new Error("Gagal memuat link: " + error.message);
  if (!link) throw new Error("Link pembayaran tidak ditemukan");
  if (role === "kasir" && link.created_by !== userId) {
    throw new Error("Kasir hanya dapat membatalkan link buatan sendiri");
  }

  if (!link.canceled_at) {
    const { error: updateError } = await admin
      .from("payment_link")
      .update({ canceled_at: new Date().toISOString(), canceled_by: userId })
      .eq("id", linkId)
      .is("canceled_at", null)
      .select("id");
    if (updateError) throw new Error("Gagal membatalkan link: " + updateError.message);
  }

  // Link sudah tidak bisa membuat sesi baru. Tutup sesi yang mungkin sedang
  // berjalan agar tagihan kembali bisa dibayar di kasir.
  const { data: sessions, error: sessionError } = await admin
    .from("transaksi_midtrans")
    .select("*")
    .eq("payment_link_id", linkId)
    .eq("status", "pending")
    .is("gateway_closed_at", null);
  if (sessionError) throw new Error("Gagal memeriksa sesi pembayaran link: " + sessionError.message);
  for (const session of sessions ?? []) {
    try {
      await closeStoredSession(session, "payment_link_canceled");
    } catch (closeError) {
      throw new Error(
        "Link sudah dibatalkan, tetapi sesi Midtrans yang sedang berjalan belum dapat ditutup " +
        `(${closeError instanceof Error ? closeError.message : "gagal"}). Coba batalkan lagi beberapa saat lagi.`,
      );
    }
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Publik (orang tua, tanpa login) — diotorisasi token
// ---------------------------------------------------------------------------

async function loadLinkByToken(admin: LooseAdmin, token: unknown): Promise<LinkRow> {
  if (!isPaymentLinkTokenFormat(token)) throw new Error(INVALID_LINK);
  const { data, error } = await admin
    .from("payment_link")
    .select("id, siswa_id, tagihan_ids, cicilan, expires_at, canceled_at")
    .eq("token_hash", await hashPaymentLinkToken(token))
    .maybeSingle();
  if (error || !data) throw new Error(INVALID_LINK);
  return data as LinkRow;
}

export interface PublicPaymentLinkView {
  state: PaymentLinkState;
  nama_siswa: string;
  expires_at: string;
  /** `sisa` = nominal yang dibayar lewat link; `sisa_tagihan` = sisa tagihan keseluruhan. */
  bills: Array<Pick<PaymentLinkBill, "id" | "jenis_nama" | "periode" | "bulan" | "jatuh_tempo" | "sisa"> & {
    sisa_tagihan: number;
    cicilan: boolean;
  }>;
  total: number;
  pending: { order_id: string; total_amount: number; expired_at: string } | null;
}

export async function resolvePaymentLinkByToken(token: unknown): Promise<PublicPaymentLinkView> {
  const admin = adminClient();
  const link = await loadLinkByToken(admin, token);
  const bills = await loadDueBills(admin, link);
  const state = paymentLinkState(link, bills.length);

  const { data: siswa } = await admin.from("siswa").select("nama").eq("id", link.siswa_id).single();

  let pending: PublicPaymentLinkView["pending"] = null;
  if (state === "aktif") {
    const { data: sessions } = await admin
      .from("transaksi_midtrans")
      .select("order_id, total_amount, status, snap_token, gateway_closed_at, expired_at")
      .eq("payment_link_id", link.id)
      .eq("status", "pending");
    const active = ((sessions ?? []) as SessionDbRow[]).find((s) => canResumeMidtransSession(s));
    if (active) {
      pending = { order_id: active.order_id, total_amount: Number(active.total_amount), expired_at: active.expired_at };
    }
  }

  const visible = state === "aktif" ? bills : [];
  return {
    state,
    nama_siswa: siswa?.nama ?? "Siswa",
    expires_at: link.expires_at,
    bills: visible.map(({ id, jenis_nama, periode, bulan, jatuh_tempo, due, sisa_tagihan, cicilan }) => ({
      id, jenis_nama, periode, bulan, jatuh_tempo, sisa: due, sisa_tagihan, cicilan,
    })),
    total: visible.reduce((sum, b) => sum + b.due, 0),
    pending,
  };
}

const STATE_MESSAGE: Record<Exclude<PaymentLinkState, "aktif">, string> = {
  lunas: "Semua tagihan pada link ini sudah dibayar.",
  dibatalkan: "Link pembayaran ini sudah dibatalkan sekolah. Silakan minta link baru.",
  kedaluwarsa: "Link pembayaran ini sudah kedaluwarsa. Silakan minta link baru ke sekolah.",
};

export async function checkoutPaymentLinkByToken(token: unknown, tagihanIds: string[], origin: string) {
  const admin = adminClient();
  const link = await loadLinkByToken(admin, token);
  const selected = validateLinkSelection(link.tagihan_ids, tagihanIds);

  const bills = await loadDueBills(admin, link);
  const state = paymentLinkState(link, bills.length);
  if (state !== "aktif") throw new Error(STATE_MESSAGE[state]);

  const byId = new Map(bills.map((b) => [b.id, b]));
  if (selected.some((id) => !byId.has(id))) {
    throw new Error("Sebagian tagihan sudah dibayar atau berubah. Muat ulang halaman ini.");
  }

  const { data: siswa } = await admin.from("siswa").select("nama").eq("id", link.siswa_id).single();
  const namaSiswa = siswa?.nama ?? "Siswa";

  const items = selected.map((id) => {
    const bill = byId.get(id)!;
    return {
      tagihan_id: bill.id,
      siswa_id: link.siswa_id,
      nama_siswa: namaSiswa,
      jenis_id: bill.jenis_id,
      jenis_nama: bill.jenis_nama,
      bulan: bill.bulan ?? 0,
      // Sisa tagihan, atau nominal cicilan yang ditetapkan kasir. Divalidasi
      // ulang oleh buatTransaksiSnap dan RPC link di database.
      jumlah: bill.due,
      tahun_ajaran_id: bill.tahun_ajaran_id ?? undefined,
    };
  });

  return buatTransaksiSnap({
    paymentLink: { id: link.id, siswaId: link.siswa_id, tagihanIds: link.tagihan_ids },
    input: { items, customer: { user_id: "", email: "", nama: `Wali ${namaSiswa}`.slice(0, 50) } },
    // Token sengaja tidak disertakan di URL callback agar tidak tersimpan di Midtrans.
    callbacks: (orderId) => ({
      finish: `${origin}/bayar?status=selesai&order=${encodeURIComponent(orderId)}`,
      unfinish: `${origin}/bayar?status=tertunda&order=${encodeURIComponent(orderId)}`,
      error: `${origin}/bayar?status=gagal&order=${encodeURIComponent(orderId)}`,
    }),
  });
}

export async function resumePaymentLinkSessionByToken(token: unknown, orderId: string) {
  const admin = adminClient();
  const link = await loadLinkByToken(admin, token);
  if (!ORDER_PATTERN.test(String(orderId || ""))) throw new Error("Order ID tidak valid");
  const bills = await loadDueBills(admin, link);
  const state = paymentLinkState(link, bills.length);
  if (state !== "aktif") throw new Error(STATE_MESSAGE[state]);
  return resumeOwnedMidtransPayment({ paymentLinkId: link.id }, orderId);
}

/** Membatalkan sesi Midtrans milik link agar orang tua bisa memilih ulang tagihan. */
export async function cancelPaymentLinkSessionByToken(token: unknown, orderId: string) {
  const admin = adminClient();
  const link = await loadLinkByToken(admin, token);
  if (!ORDER_PATTERN.test(String(orderId || ""))) throw new Error("Order ID tidak valid");
  return cancelOwnedMidtransPayment({ paymentLinkId: link.id }, orderId);
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

async function requestOrigin(): Promise<string> {
  // Origin dari URL request yang diterima server (bukan header klien) agar
  // link dan callback tidak dapat diarahkan ke domain lain.
  const { getRequest } = await import("@tanstack/react-start/server");
  return new URL(getRequest().url).origin;
}

export const createPaymentLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CreatePaymentLinkInput) => d)
  .handler(async ({ data, context }) =>
    createPaymentLinkForStaff(requireContext(context).userId, data, await requestOrigin()));

export const listPaymentLinks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listPaymentLinksForStaff(requireContext(context).userId));

export const cancelPaymentLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => cancelPaymentLinkForStaff(requireContext(context).userId, data?.id));

export const getPublicPaymentLink = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => resolvePaymentLinkByToken(data?.token));

export const checkoutPublicPaymentLink = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; tagihan_ids: string[] }) => d)
  .handler(async ({ data }) =>
    checkoutPaymentLinkByToken(data?.token, data?.tagihan_ids ?? [], await requestOrigin()));

export const resumePublicPaymentLinkSession = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; order_id: string }) => d)
  .handler(async ({ data }) => resumePaymentLinkSessionByToken(data?.token, data?.order_id));

export const cancelPublicPaymentLinkSession = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; order_id: string }) => d)
  .handler(async ({ data }) => cancelPaymentLinkSessionByToken(data?.token, data?.order_id));
