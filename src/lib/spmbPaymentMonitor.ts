import { isUangPangkalPaymentName } from "./installment";

export type PaymentScheme = "lunas" | "cicilan";
export interface MonitorBill {
  id: string; siswa_id: string; jenis_id: string; tahun_akademik_id: string | null;
  nominal: number; status: string;
}
export interface MonitorPayment {
  id: string; tagihan_id: string | null; jumlah: number; tanggal_bayar: string;
}
export interface MonitorEvent {
  id: number; siswa_detail_id: string; tahun_ajaran_id: string;
  departemen_id: string; gelombang_id: string; registered_at: string;
  jenis: "skema" | "tindak_lanjut" | "perpanjangan"; skema: PaymentScheme | null;
  tahap: number | null; tenggat: string | null; catatan: string;
  created_at: string; created_by: string;
}
export interface MonitorRegistration {
  id: string; siswa_id: string; tahun_ajaran_id: string | null;
  spmb_departemen_tujuan_id: string | null; spmb_gelombang_id: string | null;
  spmb_registered_at: string | null; spmb_tanggal_lulus: string | null;
}
export interface MonitorFeeType { id: string; nama: string; departemen_id: string | null }
export const MONITOR_STATUS_LABELS = {
  belum_diatur: "Skema belum ditentukan", belum_ada_tagihan: "Tagihan belum dibuat",
  perlu_verifikasi: "Perlu verifikasi", belum_bayar: "Belum bayar",
  kurang_minimum: "Belum memenuhi minimum cicilan pertama",
  cicilan_berjalan: "Cicilan berjalan", lunas: "Lunas",
} as const;
export interface PaymentProgress {
  total: number; paid: number; remaining: number; minimum: number;
  target: number; shortage: number; stage: number; due: string | null;
  originalDue: string | null; overdueDays: number; nearDue: boolean;
  firstFulfilledAt: string | null; secondFulfilledAt: string | null;
  status: keyof typeof MONITOR_STATUS_LABELS;
}
const DAY = 86_400_000;

/** Kalender WIB, termasuk timestamp UTC di sekitar pergantian hari. */
export function jakartaDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Tanggal tidak valid");
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
export function addCalendarDays(value: string, days: number): string {
  return new Date(Date.parse(jakartaDate(value) + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
}
export function matchesRegistration(event: MonitorEvent, detail: MonitorRegistration): boolean {
  return event.siswa_detail_id === detail.id && event.tahun_ajaran_id === detail.tahun_ajaran_id
    && event.departemen_id === detail.spmb_departemen_tujuan_id
    && event.gelombang_id === detail.spmb_gelombang_id
    && event.registered_at === detail.spmb_registered_at;
}
export function selectRegistrationBills(
  detail: MonitorRegistration, bills: MonitorBill[], types: MonitorFeeType[],
): MonitorBill[] {
  const allowed = new Set(types.filter(type => type.departemen_id === detail.spmb_departemen_tujuan_id
    && isUangPangkalPaymentName(type.nama)).map(type => type.id));
  return bills.filter(bill => detail.tahun_ajaran_id && bill.siswa_id === detail.siswa_id
    && bill.tahun_akademik_id === detail.tahun_ajaran_id && allowed.has(bill.jenis_id)
    && ["terjadwal", "belum_bayar", "sebagian", "lunas"].includes(bill.status));
}
export function calculatePaymentProgress(input: {
  total: number; billIds: string[]; payments: MonitorPayment[]; passedAt: string | null;
  scheme: PaymentScheme | null; events?: MonitorEvent[]; schemeEventId?: number;
  today: string; needsVerification?: boolean;
}): PaymentProgress {
  const total = Number(input.total);
  const validIds = new Set(input.billIds);
  const today = jakartaDate(input.today);
  const transactions = input.payments.filter(p => p.tagihan_id && validIds.has(p.tagihan_id)
    && p.tanggal_bayar <= today).sort((a,b) => a.tanggal_bayar.localeCompare(b.tanggal_bayar) || a.id.localeCompare(b.id));
  const paid = transactions.reduce((sum,p) => sum + Number(p.jumlah), 0);
  const remaining = Math.max(0, total - paid);
  const minimum = Math.ceil(total / 4);
  let cumulative = 0, firstAmount = 0;
  let firstFulfilledAt: string | null = null, secondFulfilledAt: string | null = null;
  for (const payment of transactions) {
    cumulative += Number(payment.jumlah);
    if (!firstFulfilledAt && cumulative >= minimum && cumulative > 0) {
      firstFulfilledAt = payment.tanggal_bayar;
      firstAmount = cumulative;
    } else if (firstFulfilledAt && !secondFulfilledAt && cumulative >= Math.min(total, firstAmount + minimum)) {
      secondFulfilledAt = payment.tanggal_bayar;
    }
  }
  let status: PaymentProgress["status"] = "belum_diatur";
  let stage = 1, target = input.scheme === "lunas" ? total : minimum;
  let due = input.passedAt ? addCalendarDays(input.passedAt, 14) : null;
  if (input.scheme === "cicilan" && firstFulfilledAt) {
    stage = 2; target = Math.min(total, firstAmount + minimum);
    due = addCalendarDays(firstFulfilledAt, 30);
    if (secondFulfilledAt) { stage = 3; target = total; due = addCalendarDays(secondFulfilledAt, 30); }
  }
  const badAmount = !Number.isFinite(total) || total < 0 || !Number.isFinite(paid) || paid < 0
    || transactions.some(p => !Number.isFinite(Number(p.jumlah)) || Number(p.jumlah) <= 0)
    || paid > total;
  if (input.needsVerification || badAmount) status = "perlu_verifikasi";
  else if (!input.billIds.length) status = "belum_ada_tagihan";
  else if (remaining === 0) status = "lunas";
  else if (!input.scheme) status = "belum_diatur";
  else if (!input.passedAt) status = "perlu_verifikasi";
  else if (paid === 0) status = "belum_bayar";
  else if (input.scheme === "cicilan" && paid < minimum) status = "kurang_minimum";
  else status = "cicilan_berjalan";
  const originalDue = due;
  const extensions = (input.events || []).filter(e => e.jenis === "perpanjangan"
    && e.tahap === stage && e.id > (input.schemeEventId || 0));
  for (const extension of extensions) {
    if (extension.tenggat && due && extension.tenggat > due) due = extension.tenggat;
  }
  const actionable = !["lunas", "belum_diatur", "belum_ada_tagihan", "perlu_verifikasi"].includes(status);
  const distance = due ? Math.round((Date.parse(today) - Date.parse(due)) / DAY) : 0;
  return {
    total, paid, remaining, minimum, target, shortage: Math.max(0, target - paid), stage,
    due: actionable ? due : null, originalDue: actionable ? originalDue : null,
    overdueDays: actionable ? Math.max(0, distance) : 0,
    nearDue: actionable && Boolean(due) && distance >= -3 && distance <= 0,
    firstFulfilledAt, secondFulfilledAt, status,
  };
}
