import {
  billingPeriodLabel,
  findBillingPrerequisite,
  type BillingSequenceBill,
} from "./billingSequence";
import {
  canGrantSequenceOverride,
  resolveSequenceOverride,
} from "./sequenceOverride";

export type MonthlyGateResult =
  /** Tidak ada yang menghalangi. */
  | { status: "clear" }
  /** Terhalang, tetapi dilewati lewat dispensasi yang sah (peran + alasan). */
  | { status: "override"; alasan: string; prerequisiteId: string }
  /** Terhalang dan tidak boleh dilanjutkan; `message` siap ditampilkan. */
  | { status: "blocked"; message: string };

/**
 * Keputusan gerbang untuk tagihan bulanan: bulan sebelumnya (siswa dan jenis
 * sama, lintas tahun ajaran) harus lunas dulu atau dibayar penuh bersamaan.
 * Admin/keuangan boleh melewatinya hanya dengan alasan dispensasi tertulis;
 * kasir tidak boleh melewatinya sama sekali.
 *
 * Fungsi murni agar semua cabang bisa diuji tanpa database. Server
 * (`prosesPembayaran`) adalah sumber kebenaran.
 */
export function evaluateMonthlyGate(input: {
  role: string | null | undefined;
  jenisNama: string;
  target: BillingSequenceBill;
  openBills: BillingSequenceBill[];
  alasan?: string | null;
  selectedBillIds?: ReadonlySet<string>;
}): MonthlyGateResult {
  const prerequisite = findBillingPrerequisite(
    input.target,
    input.openBills,
    input.selectedBillIds,
  );
  if (!prerequisite) return { status: "clear" };

  const pokok =
    `Selesaikan ${input.jenisNama} ${billingPeriodLabel(prerequisite)} terlebih dahulu ` +
    `sebelum membayar ${billingPeriodLabel(input.target)}.`;

  if (!canGrantSequenceOverride(input.role)) {
    return {
      status: "blocked",
      message: `${pokok} Jika ada komitmen orang tua, minta admin atau keuangan memberi dispensasi.`,
    };
  }

  if (!input.alasan?.trim()) {
    return {
      status: "blocked",
      message:
        `${pokok} Jika ada komitmen orang tua, isi alasan dispensasi ` +
        `di keranjang halaman Input Pembayaran untuk melanjutkan.`,
    };
  }

  const override = resolveSequenceOverride({
    role: input.role,
    alasan: input.alasan,
  });
  if (override.status === "error") {
    return { status: "blocked", message: override.error };
  }

  return {
    status: "override",
    alasan: override.alasan,
    prerequisiteId: prerequisite.id,
  };
}

/**
 * Urutkan hanya item yang masuk lingkup (`inScope`), dan taruh hasilnya pada
 * slot yang sama dengan yang semula ditempati item-item itu. Item di luar
 * lingkup tidak bergeser. Tidak mengubah array asli; stabil untuk nilai sama.
 */
export function orderWithinSlots<T>(
  items: readonly T[],
  inScope: (item: T) => boolean,
  compare: (a: T, b: T) => number,
): T[] {
  const result = [...items];
  const indexes = result.flatMap((item, index) => (inScope(item) ? [index] : []));
  const sorted = indexes
    .map((index) => ({ item: result[index], index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
  indexes.forEach((slot, i) => {
    result[slot] = sorted[i];
  });
  return result;
}
