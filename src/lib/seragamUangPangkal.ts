import { MONITOR_PAYMENT_LABELS, monitorPaymentStatus, type MonitorPaymentStatus, type PaymentProgress } from "@/lib/spmbPaymentMonitor";

/** Ringkasan uang pangkal satu siswa, diambil dari data Monitoring Pembayaran SPMB (nominal netto dari tagihan). */
export type UangPangkalInfo = { total: number; paid: number; remaining: number; status: MonitorPaymentStatus };

export function uangPangkalFromMonitor(
  items: ReadonlyArray<{ siswa_id: string; progress: PaymentProgress }>,
): Map<string, UangPangkalInfo> {
  const map = new Map<string, UangPangkalInfo>();
  for (const item of items) {
    map.set(item.siswa_id, {
      total: item.progress.total,
      paid: item.progress.paid,
      remaining: item.progress.remaining,
      status: monitorPaymentStatus(item.progress),
    });
  }
  return map;
}

export function uangPangkalStatus(info: UangPangkalInfo | null | undefined): MonitorPaymentStatus {
  return info?.status ?? "belum_ada_tagihan";
}

/** Keterangan otomatis: label yang sama dengan halaman Monitoring Pembayaran SPMB. */
export function uangPangkalKeterangan(info: UangPangkalInfo | null | undefined): string {
  return MONITOR_PAYMENT_LABELS[uangPangkalStatus(info)];
}

/** Angka hanya ditampilkan bila tagihan jelas; belum ada tagihan atau belum dapat dipastikan dikosongkan. */
export function uangPangkalAmounts(info: UangPangkalInfo | null | undefined): { nominal: number; dibayar: number; sisa: number } | null {
  if (!info || info.status === "belum_ada_tagihan" || info.status === "perlu_verifikasi") return null;
  return { nominal: info.total, dibayar: info.paid, sisa: info.remaining };
}

export const formatUangPangkal = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

/** Sama dengan server: izin pembayaran keuangan, ditambah Admin TU (baca saja, dibatasi lembaganya oleh server). */
export function canViewUangPangkal(role: string | null | undefined, hasPaymentPermission: boolean): boolean {
  return role === "admin_tu" || hasPaymentPermission;
}
