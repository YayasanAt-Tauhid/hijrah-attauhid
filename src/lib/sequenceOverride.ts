/**
 * Dispensasi urutan pembayaran.
 *
 * Aturan urutan (tagihan sebelumnya harus lunas dulu) kadang perlu dilonggarkan,
 * mis. ada komitmen orang tua kepada sekolah. Dispensasi bukan potongan nominal
 * (itu fitur Diskon Siswa): tagihan tetap dibayar penuh, hanya syarat
 * urutannya yang dilewati, dan selalu disertai alasan tertulis.
 */

export const SEQUENCE_OVERRIDE_ROLES = ["admin", "kepala_sekolah", "keuangan"] as const;

export const SEQUENCE_OVERRIDE_MIN_REASON = 10;
export const SEQUENCE_OVERRIDE_MAX_REASON = 300;

// Diskriminan berupa string literal (bukan boolean) karena proyek ini tidak
// memakai strictNullChecks, sehingga pengecilan tipe lewat `ok: true/false`
// tidak bekerja.
export type SequenceOverrideResult =
  | { status: "ok"; alasan: string }
  | { status: "error"; error: string };

export function canGrantSequenceOverride(role: string | null | undefined): boolean {
  return (
    !!role &&
    (SEQUENCE_OVERRIDE_ROLES as readonly string[]).includes(role)
  );
}

/** Rapikan alasan: buang spasi di tepi dan padatkan spasi/baris baru berlebih. */
export function normalizeSequenceOverrideReason(
  alasan: string | null | undefined,
): string {
  return (alasan ?? "").replace(/\s+/g, " ").trim();
}

export function resolveSequenceOverride(input: {
  role: string | null | undefined;
  alasan: string | null | undefined;
}): SequenceOverrideResult {
  if (!canGrantSequenceOverride(input.role)) {
    return {
      status: "error",
      error:
        "Peran Anda tidak berwenang memberi dispensasi urutan pembayaran. Minta admin, kepala sekolah, atau keuangan.",
    };
  }

  const alasan = normalizeSequenceOverrideReason(input.alasan);
  if (!alasan) {
    return { status: "error", error: "Alasan dispensasi wajib diisi." };
  }
  if (alasan.length < SEQUENCE_OVERRIDE_MIN_REASON) {
    return {
      status: "error",
      error: `Alasan dispensasi minimal ${SEQUENCE_OVERRIDE_MIN_REASON} karakter.`,
    };
  }
  if (alasan.length > SEQUENCE_OVERRIDE_MAX_REASON) {
    return {
      status: "error",
      error: `Alasan dispensasi maksimal ${SEQUENCE_OVERRIDE_MAX_REASON} karakter.`,
    };
  }

  return { status: "ok", alasan };
}

export function formatSequenceOverrideNote(alasan: string): string {
  return `[DISPENSASI URUTAN] ${alasan}`;
}
