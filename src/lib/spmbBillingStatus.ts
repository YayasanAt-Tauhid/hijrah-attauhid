
import { isSppPaymentName, isUangPangkalPaymentName } from "./installment";

export type SpmbInputBill = {
  id: string; siswa_id: string; jenis_id: string; tahun_ajaran_id: string;
  tahun_akademik_id: string | null; bulan: number | null; nominal: number; status: string;
  jenis: { nama: string; tipe: string; departemen_id: string | null } | null;
  tahun_buku: { tanggal_mulai: string; tanggal_selesai: string } | null;
};
export type SpmbInputStatus = {
  status: "sudah_diinput" | "belum_diinput" | "perlu_diperiksa";
  nominal: number;
  dibatalkan: number;
  tagihan: { id: string; jenis_id: string; nama: string; nominal: number; status: string; periode: string | null }[];
};
type Target = { id: string; target_departemen_id: string | null; tahun_ajaran_id: string | null; tahun_ajaran_mulai: string | null; tahun_ajaran_selesai: string | null };

function billPeriod(bill: SpmbInputBill): string | null {
  if (!bill.bulan || !bill.tahun_buku) return null;
  const start = bill.tahun_buku.tanggal_mulai;
  const end = bill.tahun_buku.tanggal_selesai;
  const dates: string[] = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    const date = year + "-" + String(bill.bulan).padStart(2, "0") + "-01";
    if (date >= start && date <= end) dates.push(date);
  }
  return dates.length === 1 ? dates[0] : null;
}
export function summarizeSpmbBillingInputs(target: Target, bills: SpmbInputBill[]) {
  const spp: SpmbInputBill[] = [];
  const pangkal: SpmbInputBill[] = [];
  for (const bill of bills) {
    if (!bill.jenis || !target.target_departemen_id || bill.siswa_id !== target.id || bill.jenis.departemen_id !== target.target_departemen_id) continue;
    if (bill.tahun_akademik_id && bill.tahun_akademik_id !== target.tahun_ajaran_id) continue;
    if (bill.jenis.tipe === "bulanan" && isSppPaymentName(bill.jenis.nama)) {
      const period = billPeriod(bill);
      if (!period || !target.tahun_ajaran_mulai || !target.tahun_ajaran_selesai
        || period < target.tahun_ajaran_mulai || period > target.tahun_ajaran_selesai) continue;
      spp.push(bill);
    } else if (bill.bulan === null && bill.jenis.tipe === "sekali" && isUangPangkalPaymentName(bill.jenis.nama)) {
      // Existing manual bills can lack academic-year metadata; use the same
      // financial book as the entrance-fee RPC rather than an old school bill.
      if (!bill.tahun_akademik_id && (!target.tahun_ajaran_mulai || !bill.tahun_buku
        || target.tahun_ajaran_mulai < bill.tahun_buku.tanggal_mulai
        || target.tahun_ajaran_mulai > bill.tahun_buku.tanggal_selesai)) continue;
      pangkal.push(bill);
    }
  }
  const summarize = (matching: SpmbInputBill[]): SpmbInputStatus => {
    const cancelled = matching.filter((bill) => ["dibatalkan", "dihapusbuku"].includes(bill.status));
    const active = matching.filter((bill) => !["dibatalkan", "dihapusbuku"].includes(bill.status));
    return {
      status: active.length ? "sudah_diinput" : cancelled.length ? "perlu_diperiksa" : "belum_diinput",
      nominal: active.reduce((sum, bill) => sum + Number(bill.nominal || 0), 0),
      dibatalkan: cancelled.length,
      tagihan: active.map((bill) => ({
        id: bill.id, jenis_id: bill.jenis_id, nama: bill.jenis!.nama,
        nominal: Number(bill.nominal || 0), status: bill.status, periode: billPeriod(bill),
      })).sort((a, b) => String(a.periode || "").localeCompare(String(b.periode || "")) || a.id.localeCompare(b.id)),
    };
  };
  return { spp_awal: summarize(spp), uang_pangkal: summarize(pangkal) };
}
