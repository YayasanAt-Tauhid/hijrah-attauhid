import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authMiddleware, requireContext, ForbiddenError } from "./auth";
import { createAdminClient } from "./supabase";
import {
  calculatePaymentProgress, jakartaDate, matchesRegistration, selectRegistrationBills,
  type MonitorRegistration, type MonitorBill, type MonitorPayment, type MonitorFeeType,
  type MonitorEvent, type PaymentProgress, type PaymentScheme,
} from "@/lib/spmbPaymentMonitor";
import { isUangPangkalPaymentName } from "@/lib/installment";

interface Detail extends MonitorRegistration {
  spmb_status_kelulusan: string | null; status_asrama: string | null; spmb_siswa_internal: boolean | null;
}
interface Student { id: string; nama: string; nis: string | null; status: string }
interface Department { id: string; nama: string; kode: string }
interface AcademicYear { id: string; nama: string }
export interface PaymentMonitorRow extends Record<string, unknown> {
  id: string; siswa_id: string; nama: string; nis: string | null; status_siswa: string;
  registration: MonitorRegistration;
  departemen_id: string | null; departemen_nama: string; tahun_ajaran_id: string | null;
  tahun_ajaran_nama: string; status_asrama: string | null; internal: boolean;
  tanggal_lulus: string | null; skema: PaymentScheme | null; events: MonitorEvent[];
  progress: PaymentProgress; unmatchedBills: number;
}
const DETAIL_SELECT = "id,siswa_id,tahun_ajaran_id,spmb_departemen_tujuan_id,spmb_gelombang_id,spmb_registered_at,spmb_tanggal_lulus,spmb_status_kelulusan,status_asrama,spmb_siswa_internal";
const ROLES = ["admin", "keuangan", "kasir"];
const uuid = z.string().uuid();
export const monitorEventSchema = z.object({
  detail_id: uuid, tahun_ajaran_id: uuid, departemen_id: uuid, gelombang_id: uuid,
  registered_at: z.string().datetime({ offset: true }),
  jenis: z.enum(["skema", "tindak_lanjut", "perpanjangan"]),
  skema: z.enum(["lunas", "cicilan"]).nullable().default(null),
  tahap: z.number().int().min(1).max(3).nullable().default(null),
  tenggat: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(value + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
  }, "Tanggal tidak valid").nullable().default(null),
  catatan: z.string().trim().min(5, "Catatan minimal 5 karakter").max(2000),
}).superRefine((value, ctx) => {
  if (value.jenis === "skema" && (!value.skema || value.tahap || value.tenggat))
    ctx.addIssue({ code: "custom", message: "Pilihan skema tidak lengkap" });
  if (value.jenis === "perpanjangan" && (!value.tahap || !value.tenggat || value.skema))
    ctx.addIssue({ code: "custom", message: "Tahap dan tenggat perpanjangan wajib diisi" });
  if (value.jenis === "tindak_lanjut" && (value.skema || value.tahap || value.tenggat))
    ctx.addIssue({ code: "custom", message: "Catatan tindak lanjut tidak mengubah jadwal" });
});
export type SaveMonitorEventInput = z.input<typeof monitorEventSchema>;
async function authorize(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin.from("users_profile").select("role,aktif").eq("id", userId).single();
  if (error || !data || data.aktif === false || !ROLES.includes(data.role)) throw new ForbiddenError();
  return data.role;
}
async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const response = await query(from, from + 499);
    if (response.error) throw new Error(response.error.message);
    const rows = response.data || [];
    result.push(...rows);
    if (rows.length < 500) return result;
  }
}
async function loadRows(admin: SupabaseClient, details: Detail[]) {
  if (!details.length) return { items: [] as PaymentMonitorRow[], historyAvailable: true };
  const ids = [...new Set(details.map(d => d.siswa_id))];
  const students: Student[] = [], bills: MonitorBill[] = [], events: MonitorEvent[] = [];
  let historyAvailable = true;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const [s, b] = await Promise.all([
      pages<Student>((from,to) => admin.from("siswa").select("id,nama,nis,status").in("id", chunk).order("id").range(from,to)),
      pages<MonitorBill>((from,to) => admin.from("tagihan").select("id,siswa_id,jenis_id,tahun_akademik_id,nominal,status")
        .in("siswa_id", chunk).in("status", ["terjadwal","belum_bayar","sebagian","lunas"]).order("id").range(from,to)),
    ]);
    students.push(...s); bills.push(...b);
  }
  for (let offset = 0; offset < details.length; offset += 100) {
    const chunk = details.slice(offset, offset + 100).map(d => d.id);
    // A missing migration is shown explicitly; other database failures must not look like an empty list.
    const probe = await admin.from("spmb_payment_monitor_events").select("id").limit(1);
    if (probe.error && ["42P01","PGRST205"].includes(probe.error.code)) { historyAvailable = false; break; }
    if (probe.error) throw new Error(probe.error.message);
    events.push(...await pages<MonitorEvent>((from,to) => admin.from("spmb_payment_monitor_events")
      .select("*").in("siswa_detail_id", chunk).order("id").range(from,to)));
  }
  const [types, departments, years] = await Promise.all([
    pages<MonitorFeeType>((from,to) => admin.from("jenis_pembayaran").select("id,nama,departemen_id").order("id").range(from,to)),
    pages<Department>((from,to) => admin.from("departemen").select("id,nama,kode").order("id").range(from,to)),
    pages<AcademicYear>((from,to) => admin.from("tahun_ajaran").select("id,nama").order("id").range(from,to)),
  ]);
  const eligibleBills = details.flatMap(detail => selectRegistrationBills(detail, bills, types));
  const billIds = [...new Set(eligibleBills.map(bill => bill.id))];
  const payments: MonitorPayment[] = [];
  for (let offset = 0; offset < billIds.length; offset += 100) {
    const chunk = billIds.slice(offset, offset + 100);
    payments.push(...await pages<MonitorPayment>((from,to) => admin.from("pembayaran")
      .select("id,tagihan_id,jumlah,tanggal_bayar").in("tagihan_id", chunk).order("id").range(from,to)));
  }
  const studentMap = new Map(students.map(s => [s.id,s]));
  const deptMap = new Map(departments.map(d => [d.id,d]));
  const yearMap = new Map(years.map(y => [y.id,y]));
  const today = jakartaDate(new Date().toISOString());
  const items: PaymentMonitorRow[] = [];
  for (const detail of details) {
    const student = studentMap.get(detail.siswa_id);
    if (!student || ["keluar", "mengundurkan_diri"].includes(student.status)) continue;
    const selectedBills = selectRegistrationBills(detail, bills, types);
    const currentEvents = events.filter(e => matchesRegistration(e, detail)).sort((a,b) => b.id-a.id);
    const schemeEvent = currentEvents.find(e => e.jenis === "skema");
    const allowedTypes = new Set(types.filter(t => t.departemen_id === detail.spmb_departemen_tujuan_id
      && isUangPangkalPaymentName(t.nama)).map(t => t.id));
    const unmatchedBills = bills.filter(b => b.siswa_id === detail.siswa_id
      && b.tahun_akademik_id === null && allowedTypes.has(b.jenis_id)).length;
    const needsVerification = !detail.tahun_ajaran_id || !detail.spmb_departemen_tujuan_id
      || !detail.spmb_registered_at || (!selectedBills.length && unmatchedBills > 0);
    items.push({
      id: detail.id, siswa_id: student.id, nama: student.nama, nis: student.nis, registration: { id: detail.id, siswa_id: detail.siswa_id, tahun_ajaran_id: detail.tahun_ajaran_id, spmb_departemen_tujuan_id: detail.spmb_departemen_tujuan_id, spmb_gelombang_id: detail.spmb_gelombang_id, spmb_registered_at: detail.spmb_registered_at, spmb_tanggal_lulus: detail.spmb_tanggal_lulus },
      status_siswa: student.status, departemen_id: detail.spmb_departemen_tujuan_id,
      departemen_nama: deptMap.get(detail.spmb_departemen_tujuan_id || "")?.nama || "Belum diisi",
      tahun_ajaran_id: detail.tahun_ajaran_id,
      tahun_ajaran_nama: yearMap.get(detail.tahun_ajaran_id || "")?.nama || "Belum diisi",
      status_asrama: detail.status_asrama, internal: detail.spmb_siswa_internal === true,
      tanggal_lulus: detail.spmb_tanggal_lulus, skema: schemeEvent?.skema || null,
      events: currentEvents,
      progress: calculatePaymentProgress({
        total: selectedBills.reduce((sum,b) => sum + Number(b.nominal),0),
        billIds: selectedBills.map(b => b.id), payments, passedAt: detail.spmb_tanggal_lulus,
        scheme: schemeEvent?.skema || null, events: currentEvents, schemeEventId: schemeEvent?.id,
        today, needsVerification,
      }), unmatchedBills,
    });
  }
  items.sort((a,b) => b.progress.overdueDays-a.progress.overdueDays || a.nama.localeCompare(b.nama,"id"));
  return { items, historyAvailable };
}

export const getSpmbPaymentMonitor = createServerFn({ method: "GET" })
  .middleware([authMiddleware]).handler(async ({ context }) => {
    const { userId } = requireContext(context);
    const admin = createAdminClient() as SupabaseClient;
    await authorize(admin, userId);
    const details = await pages<Detail>((from,to) => admin.from("siswa_detail").select(DETAIL_SELECT)
      .eq("spmb_status_kelulusan","lulus").not("spmb_gelombang_id","is",null).order("id").range(from,to));
    return loadRows(admin, details);
  });

export const saveSpmbMonitorEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware]).inputValidator((input: SaveMonitorEventInput) => monitorEventSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = requireContext(context);
    const admin = createAdminClient() as SupabaseClient;
    const role = await authorize(admin, userId);
    if (data.jenis !== "tindak_lanjut" && role === "kasir") throw new ForbiddenError();
    const { data: raw, error } = await admin.from("siswa_detail").select(DETAIL_SELECT).eq("id", data.detail_id).single();
    if (error || !raw || raw.spmb_status_kelulusan !== "lulus" || !raw.spmb_gelombang_id)
      throw new Error("Pendaftaran lulus tes tidak ditemukan");
    const detail = raw as Detail;
    if (detail.tahun_ajaran_id !== data.tahun_ajaran_id || detail.spmb_departemen_tujuan_id !== data.departemen_id
      || detail.spmb_gelombang_id !== data.gelombang_id || detail.spmb_registered_at !== data.registered_at)
      throw new Error("Pendaftaran telah berubah. Muat ulang sebelum menyimpan.");
    if (data.jenis === "perpanjangan") {
      const { items } = await loadRows(admin, [detail]);
      const progress = items[0]?.progress;
      if (!progress?.due || progress.stage !== data.tahap || !data.tenggat || data.tenggat <= progress.due
        || data.tenggat < jakartaDate(new Date().toISOString())
        || jakartaDate(data.tenggat) !== data.tenggat || Number.isNaN(Date.parse(data.tenggat)))
        throw new Error("Perpanjangan harus untuk tahap berjalan dan setelah tenggat sebelumnya.");
    }
    const { error: insertError } = await admin.from("spmb_payment_monitor_events").insert({
      siswa_detail_id: detail.id, tahun_ajaran_id: detail.tahun_ajaran_id,
      departemen_id: detail.spmb_departemen_tujuan_id, gelombang_id: detail.spmb_gelombang_id,
      registered_at: detail.spmb_registered_at, jenis: data.jenis, skema: data.skema,
      tahap: data.tahap, tenggat: data.tenggat, catatan: data.catatan, created_by: userId,
    });
    if (insertError) throw new Error("Gagal menyimpan monitoring: " + insertError.message);
    return { success: true };
  });
