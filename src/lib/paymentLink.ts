/**
 * Aturan murni link pembayaran orang tua (dibuat kasir/admin, dibayar tanpa login).
 *
 * Keamanan:
 *  - Token 32 byte acak (256-bit), base64url tanpa padding → 43 karakter.
 *  - Database hanya menyimpan SHA-256 token; token mentah hanya muncul sekali
 *    saat link dibuat.
 *  - Token diletakkan di fragment URL (`/bayar#token`) sehingga tidak ikut
 *    terkirim ke server, log akses, maupun header Referer.
 */

import { isUangPangkalPaymentName } from "./installment";

export const PAYMENT_LINK_TTL_DAYS = 7;
export const PAYMENT_LINK_MAX_BILLS = 50;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PaymentLinkState = "aktif" | "kedaluwarsa" | "dibatalkan" | "lunas";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePaymentLinkToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function isPaymentLinkTokenFormat(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export async function hashPaymentLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildPaymentLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/bayar#${token}`;
}

export function readPaymentLinkTokenFromHash(hash: string | null | undefined): string | null {
  const raw = String(hash ?? "").replace(/^#/, "").trim();
  return isPaymentLinkTokenFormat(raw) ? raw : null;
}

export function paymentLinkExpiry(now: Date): Date {
  return new Date(now.getTime() + PAYMENT_LINK_TTL_DAYS * 24 * 3600 * 1000);
}

export function paymentLinkState(
  link: { expires_at: string; canceled_at: string | null },
  openBillCount: number,
  now: Date = new Date(),
): PaymentLinkState {
  if (openBillCount <= 0) return "lunas";
  if (link.canceled_at) return "dibatalkan";
  if (Date.parse(link.expires_at) <= now.getTime()) return "kedaluwarsa";
  return "aktif";
}

export function normalizeWhatsappPhone(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  else if (digits.startsWith("8")) digits = "62" + digits;
  if (!digits.startsWith("62")) return null;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function buildWhatsappShareUrl(phone: string | null, message: string): string {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`;
}

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

export function formatLinkDeadline(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function paymentLinkMessage(params: {
  namaSiswa: string;
  total: number;
  url: string;
  expiresAt: string;
}): string {
  return [
    "Assalamu'alaikum Bapak/Ibu,",
    "",
    `Berikut link pembayaran tagihan ananda ${params.namaSiswa} sebesar ${formatRupiah(params.total)}.`,
    "Pembayaran dapat dilakukan melalui QRIS, transfer bank (Virtual Account), e-wallet, atau minimarket.",
    "",
    params.url,
    "",
    `Link berlaku sampai ${formatLinkDeadline(params.expiresAt)}. Mohon tidak membagikan link ini kepada orang lain.`,
    "Jazakumullahu khairan.",
  ].join("\n");
}

/** Pastikan pilihan tagihan tidak kosong, tanpa duplikat, dan bagian dari link. */
export function validateLinkSelection(scope: string[], selected: string[]): string[] {
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new Error("Pilih minimal satu tagihan");
  }
  const unique = [...new Set(selected.map((id) => String(id)))];
  if (unique.length > PAYMENT_LINK_MAX_BILLS) {
    throw new Error(`Satu link maksimal ${PAYMENT_LINK_MAX_BILLS} tagihan`);
  }
  const allowed = new Set(scope);
  if (unique.some((id) => !allowed.has(id))) {
    throw new Error("Ada tagihan yang tidak termasuk dalam link pembayaran ini");
  }
  return unique;
}

/**
 * Centang tagihan di halaman /bayar dengan aturan sama seperti server:
 * tagihan bulanan per jenis harus dibayar dari bulan terlama. Daftar `bills`
 * harus sudah berurutan dari terlama (sebagaimana dikirim server).
 */
export function toggleLinkBillSelection(
  bills: Array<{ id: string; jenis_nama: string; bulan: number | null }>,
  selected: Set<string>,
  id: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  const target = bills.find((b) => b.id === id);
  if (!target) return next;
  if (!target.bulan) {
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  }
  const sequence = bills.filter((b) => b.bulan && b.jenis_nama === target.jenis_nama);
  const index = sequence.findIndex((b) => b.id === id);
  if (checked) sequence.slice(0, index + 1).forEach((b) => next.add(b.id));
  else sequence.slice(index).forEach((b) => next.delete(b.id));
  return next;
}

/**
 * Tagihan yang boleh dibayar sebagian lewat link — aturan yang sama dengan
 * checkout portal: tagihan sekali bayar, dan bila belum jatuh tempo (terjadwal)
 * hanya uang pangkal. Tagihan bulanan selalu wajib penuh.
 */
export function isLinkInstallmentAllowed(bill: { bulan: number | null; status: string; jenis_nama: string }): boolean {
  return !bill.bulan && (bill.status !== "terjadwal" || isUangPangkalPaymentName(bill.jenis_nama));
}
