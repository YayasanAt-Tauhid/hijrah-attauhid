export interface InstallmentResolutionInput {
  requestedAmount: unknown;
  remainingAmount: unknown;
  allowPartial: boolean;
}

export function resolveInstallmentAmount({
  requestedAmount,
  remainingAmount,
  allowPartial,
}: InstallmentResolutionInput): number {
  const remaining = Number(remainingAmount);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error("Tagihan sudah lunas atau sisa tagihan tidak valid");
  }

  const requested = Number(requestedAmount);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("Jumlah pembayaran harus lebih dari 0");
  }

  if (requested > remaining) {
    throw new Error("Jumlah pembayaran melebihi sisa tagihan");
  }

  if (!allowPartial && requested !== remaining) {
    throw new Error("Tagihan ini harus dibayar penuh");
  }

  return requested;
}

export function calculateRemainingBill(
  billAmount: unknown,
  paidAmount: unknown,
): { total: number; paid: number; remaining: number; paidOff: boolean } {
  const totalRaw = Number(billAmount);
  const paidRaw = Number(paidAmount);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
  const paid = Number.isFinite(paidRaw) && paidRaw > 0 ? paidRaw : 0;
  const remaining = Math.max(total - paid, 0);
  return { total, paid, remaining, paidOff: total > 0 && remaining <= 0 };
}

export function isSppPaymentName(value: unknown): boolean {
  const name = String(value ?? "").trim();
  return /(^|\s|[-_/])SPP($|\s|[-_/])/i.test(name);
}

export function isUangPangkalPaymentName(value: unknown): boolean {
  const name = String(value ?? "").trim();
  return /^UANG PANGKAL (TK|SD|SMP|SMA|MTA)$/i.test(name);
}
