// Ringkasan presensi dan nilai untuk portal orang tua (tampilan saja).

export type PresensiStatus = "H" | "I" | "S" | "A";

export interface RingkasanPresensi {
  counts: Record<PresensiStatus, number>;
  /** Jumlah presensi dengan status dikenal (H/I/S/A). */
  total: number;
  /** Persentase hadir, dibulatkan; 0 bila belum ada data. */
  persenHadir: number;
}

export function ringkasPresensi(
  rows: ReadonlyArray<{ status?: string | null }>,
): RingkasanPresensi {
  const counts: Record<PresensiStatus, number> = { H: 0, I: 0, S: 0, A: 0 };
  for (const row of rows) {
    const status = row.status as PresensiStatus | null | undefined;
    if (status && status in counts) counts[status] += 1;
  }
  const total = counts.H + counts.I + counts.S + counts.A;
  const persenHadir = total === 0 ? 0 : Math.round((counts.H / total) * 100);
  return { counts, total, persenHadir };
}

// Nilai kosong dihitung 0, sama dengan perilaku halaman sebelum ditata ulang.
export function rataRataNilai(nilai: ReadonlyArray<number | null | undefined>): number {
  if (nilai.length === 0) return 0;
  return nilai.reduce<number>((sum, n) => sum + (n || 0), 0) / nilai.length;
}

export function formatRataRata(rata: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rata);
}
