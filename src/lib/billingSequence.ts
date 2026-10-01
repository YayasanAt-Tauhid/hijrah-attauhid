export interface BillingSequenceBill {
  id: string;
  siswa_id?: string | null;
  jenis_id: string;
  bulan: number | null;
  jatuh_tempo?: string | null;
  tahun_ajaran_mulai?: string | null;
  tahun_ajaran?: {
    nama?: string | null;
    tanggal_mulai?: string | null;
  } | null;
}

const MONTH_NAMES = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function academicStartDate(bill: BillingSequenceBill): string | null {
  return bill.tahun_ajaran_mulai ?? bill.tahun_ajaran?.tanggal_mulai ?? null;
}

function academicCalendarYear(bill: BillingSequenceBill): number | null {
  const month = Number(bill.bulan ?? 0);
  const start = academicStartDate(bill);
  if (!start || month < 1 || month > 12) return null;
  const startYear = Number(start.slice(0, 4));
  if (!Number.isFinite(startYear)) return null;
  return month >= 7 ? startYear : startYear + 1;
}

export function billingSequenceKey(bill: BillingSequenceBill): string {
  const due = bill.jatuh_tempo?.slice(0, 10);
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) return due;

  const month = Number(bill.bulan ?? 0);
  const year = academicCalendarYear(bill);
  if (year != null && month >= 1 && month <= 12) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  }

  return `9999-${String(month).padStart(2, "0")}-${bill.id}`;
}

export function sortBillingSequence<T extends BillingSequenceBill>(bills: T[]): T[] {
  return [...bills].sort((a, b) => {
    const byPeriod = billingSequenceKey(a).localeCompare(billingSequenceKey(b));
    return byPeriod !== 0 ? byPeriod : a.id.localeCompare(b.id);
  });
}

export function billingPeriodLabel(bill: BillingSequenceBill): string {
  const month = Number(bill.bulan ?? 0);
  if (month < 1 || month > 12) return "periode sebelumnya";

  const year = academicCalendarYear(bill);
  if (year != null) return `${MONTH_NAMES[month]} ${year}`;

  const due = bill.jatuh_tempo?.slice(0, 10);
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const dueYear = Number(due.slice(0, 4));
    const dueMonth = Number(due.slice(5, 7));
    if (dueMonth >= 1 && dueMonth <= 12 && Number.isFinite(dueYear)) {
      return `${MONTH_NAMES[dueMonth]} ${dueYear}`;
    }
  }

  return MONTH_NAMES[month];
}

export function findBillingPrerequisite<T extends BillingSequenceBill>(
  target: T,
  openBills: T[],
  selectedBillIds: ReadonlySet<string> = new Set<string>(),
): T | null {
  if (target.bulan == null || Number(target.bulan) <= 0) return null;

  const sameSequence = sortBillingSequence(
    openBills.filter((bill) => {
      if (bill.bulan == null || Number(bill.bulan) <= 0) return false;
      if (bill.jenis_id !== target.jenis_id) return false;
      if (target.siswa_id != null && bill.siswa_id !== target.siswa_id) return false;
      return true;
    }),
  );

  const targetIndex = sameSequence.findIndex((bill) => bill.id === target.id);
  if (targetIndex <= 0) return null;

  return (
    sameSequence
      .slice(0, targetIndex)
      .find((bill) => !selectedBillIds.has(bill.id)) ?? null
  );
}
