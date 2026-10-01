import { hitungJatuhTempo } from "./jatuhTempo";

/** Jadwal tagihan otoritatif; data lama tanpa tagihan memakai periode target. */
export function recognitionDueDate(input: {
  billDueDate?: string | null;
  targetBookStart?: string | null;
  month?: number | null;
  dueDay?: number | null;
}): string | null {
  return input.billDueDate || hitungJatuhTempo(input.targetBookStart, input.month, input.dueDay);
}

export function canRecognizeRevenue(dueDate: string | null, today: string): boolean {
  return !!dueDate && dueDate <= today;
}
