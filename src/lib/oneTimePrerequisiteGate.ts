import {
  findOneTimePrerequisite,
  oneTimePeriodLabel,
  type BillingSequenceBill,
} from "./billingSequence";
import {
  canGrantSequenceOverride,
  resolveSequenceOverride,
} from "./sequenceOverride";

export type OneTimeGateResult =
  /** Tidak ada yang menghalangi. */
  | { status: "clear" }
  /** Terhalang, tetapi dilewati lewat dispensasi yang sah (peran + alasan). */
  | { status: "override"; alasan: string; prerequisiteId: string }
  /** Terhalang dan tidak boleh dilanjutkan; `message` siap ditampilkan. */
  | { status: "blocked"; message: string };

/**
 * Keputusan gerbang untuk pembayaran tagihan sekali bayar: tagihan tahun ajaran
 * sebelumnya (jenis dan siswa sama) harus lunas dulu, kecuali ada dispensasi
 * dari peran berwenang yang disertai alasan.
 *
 * Dipakai server (`prosesPembayaran`) sebagai sumber kebenaran. Fungsi murni
 * agar semua cabang bisa diuji tanpa database.
 */
export function evaluateOneTimeGate(input: {
  role: string | null | undefined;
  jenisNama: string;
  target: BillingSequenceBill;
  openBills: BillingSequenceBill[];
  alasan?: string | null;
}): OneTimeGateResult {
  const prerequisite = findOneTimePrerequisite(input.target, input.openBills);
  if (!prerequisite) return { status: "clear" };

  if (!input.alasan?.trim()) {
    const arahan = canGrantSequenceOverride(input.role)
      ? "Jika ada komitmen orang tua, isi alasan dispensasi untuk melanjutkan."
      : "Jika ada komitmen orang tua, minta admin atau keuangan memberi dispensasi.";
    return {
      status: "blocked",
      message:
        `Selesaikan ${input.jenisNama} ${oneTimePeriodLabel(prerequisite)} terlebih dahulu ` +
        `sebelum membayar ${oneTimePeriodLabel(input.target)}. ${arahan}`,
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
