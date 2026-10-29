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

function isOneTimeBill(bill: BillingSequenceBill): boolean {
  return bill.bulan == null || Number(bill.bulan) <= 0;
}

/**
 * Label periode untuk tagihan sekali bayar (tidak punya bulan): tahun ajaran.
 */
export function oneTimePeriodLabel(bill: BillingSequenceBill): string {
  const name = bill.tahun_ajaran?.nama?.trim();
  if (name) return `tahun ajaran ${name}`;

  const year = academicStartDate(bill)?.slice(0, 4);
  if (year && /^\d{4}$/.test(year)) return `tahun ajaran ${year}`;

  return "tahun ajaran sebelumnya";
}

/**
 * Prasyarat untuk tagihan sekali bayar (mis. Uang Pangkal): tagihan jenis yang
 * sama milik siswa yang sama pada tahun ajaran sebelumnya harus lunas lebih
 * dulu, atau ikut dibayar penuh pada transaksi yang sama (`selectedBillIds`).
 *
 * Mengembalikan tagihan terlama yang masih menghalangi, atau null bila tidak
 * ada. Bila tahun ajaran target tidak diketahui, tidak ada yang diblokir agar
 * data yang tidak lengkap tidak menghentikan kasir secara keliru.
 */
export function findOneTimePrerequisite<T extends BillingSequenceBill>(
  target: T,
  openBills: T[],
  selectedBillIds: ReadonlySet<string> = new Set<string>(),
): T | null {
  if (!isOneTimeBill(target)) return null;

  const targetStart = academicStartDate(target);
  if (!targetStart) return null;

  const earlier = openBills
    .filter((bill) => {
      if (bill.id === target.id) return false;
      if (!isOneTimeBill(bill)) return false;
      if (bill.jenis_id !== target.jenis_id) return false;
      if (target.siswa_id != null && bill.siswa_id !== target.siswa_id) return false;
      const start = academicStartDate(bill);
      return !!start && start < targetStart;
    })
    .sort((a, b) => {
      const byYear = (academicStartDate(a) as string).localeCompare(
        academicStartDate(b) as string,
      );
      return byYear !== 0 ? byYear : a.id.localeCompare(b.id);
    });

  return earlier.find((bill) => !selectedBillIds.has(bill.id)) ?? null;
}
