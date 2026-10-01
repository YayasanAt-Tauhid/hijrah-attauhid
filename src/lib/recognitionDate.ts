import { hitungJatuhTempo } from "./jatuhTempo";
export function isMonthlySppRevenue(name: unknown, type: unknown): boolean {
  return type === "bulanan" && /^spp([\s-]|$)/i.test(String(name ?? "").trim());
}

/** Jadwal pengakuan terpisah dari jatuh tempo; SPP penuh pada awal bulan layanan. */
export function recognitionDueDate(input: {
  billRecognitionDate?: string | null;
  billDueDate?: string | null;
  targetBookStart?: string | null;
  month?: number | null;
  dueDay?: number | null;
  paymentName?: string | null;
  paymentType?: string | null;
}): string | null {
  if (isMonthlySppRevenue(input.paymentName, input.paymentType)) {
    if (input.billRecognitionDate) return input.billRecognitionDate;
    if (!input.month || input.month < 1 || input.month > 12) return null;
    const periodStart = hitungJatuhTempo(input.targetBookStart, input.month, 1);
    if (!periodStart) return null;
    return periodStart;
  }
  return input.billDueDate || hitungJatuhTempo(input.targetBookStart, input.month, input.dueDay);
}

export function canRecognizeRevenue(dueDate: string | null, today: string): boolean {
  return !!dueDate && dueDate <= today;
}
