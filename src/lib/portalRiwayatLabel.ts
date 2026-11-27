// Nama metode pembayaran yang ramah dibaca orang tua (tampilan saja).
const METODE: Record<string, string> = {
  qris: "QRIS",
  bank_transfer: "Transfer bank",
  echannel: "Mandiri Bill",
  gopay: "GoPay",
  shopeepay: "ShopeePay",
  credit_card: "Kartu kredit",
  cstore: "Minimarket",
};

export function labelMetode(paymentType: string | null | undefined): string {
  const nilai = (paymentType ?? "").trim().toLowerCase();
  if (!nilai) return "";
  if (METODE[nilai]) return METODE[nilai];
  const teks = nilai.replace(/_/g, " ");
  return teks.charAt(0).toUpperCase() + teks.slice(1);
}
