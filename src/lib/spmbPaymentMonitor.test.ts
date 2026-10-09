import { describe, expect, it } from "vitest";
import {
  calculatePaymentProgress, selectRegistrationBills, matchesRegistration, jakartaDate,
  type MonitorRegistration, type MonitorEvent, type MonitorPayment,
} from "./spmbPaymentMonitor";
const detail: MonitorRegistration = {
  id: "detail", siswa_id: "student", tahun_ajaran_id: "2027",
  spmb_departemen_tujuan_id: "smp", spmb_gelombang_id: "wave", spmb_registered_at: "2026-09-25T00:00:00+00:00",
  spmb_tanggal_lulus: "2026-10-01T00:00:00Z",
};
function payment(id: string, amount: number, date: string, bill = "bill"): MonitorPayment {
  return { id, tagihan_id: bill, jumlah: amount, tanggal_bayar: date };
}
function progress(payments: MonitorPayment[] = [], options: Partial<Parameters<typeof calculatePaymentProgress>[0]> = {}) {
  return calculatePaymentProgress({
    total: 10_100_000, billIds: ["bill"], payments, passedAt: detail.spmb_tanggal_lulus,
    scheme: "cicilan", today: "2026-10-09", ...options,
  });
}
function event(id: number, stage: number, deadline: string): MonitorEvent {
  return {
    id, siswa_detail_id: "detail", tahun_ajaran_id: "2027", departemen_id: "smp",
    gelombang_id: "wave", registered_at: detail.spmb_registered_at!,
    jenis: "perpanjangan", skema: null, tahap: stage, tenggat: deadline,
    catatan: "Kesepakatan orang tua", created_at: "2026-10-09T00:00:00Z", created_by: "admin",
  };
}
describe("monitoring uang pangkal SPMB", () => {
  it("tenggat pertama 14 hari sejak lulus tes menurut kalender WIB", () => {
    expect(jakartaDate("2026-10-01T18:30:00Z")).toBe("2026-10-02");
    expect(progress([], { passedAt: "2026-10-01T18:30:00Z" }).due).toBe("2026-10-16");
  });
  it("pembayaran 1 juta dari 10,1 juta belum memenuhi minimum dan tidak memundurkan tenggat", () => {
    expect(progress([payment("a",1_000_000,"2026-10-05")])).toMatchObject({
      minimum: 2_525_000, paid: 1_000_000, shortage: 1_525_000,
      status: "kurang_minimum", stage: 1, due: "2026-10-15",
    });
  });
  it("menggabungkan pembayaran kecil; jadwal berikutnya mulai ketika minimum terpenuhi", () => {
    expect(progress([payment("a",1_000_000,"2026-10-05"),payment("b",1_525_000,"2026-10-09")]))
      .toMatchObject({ stage: 2, firstFulfilledAt: "2026-10-09", target: 5_050_000, due: "2026-11-08" });
  });
  it("cicilan kedua lebih awal menghasilkan tenggat ketiga 30 hari setelah pembayaran kedua", () => {
    expect(progress([payment("a",2_525_000,"2026-10-05"),payment("b",2_525_000,"2026-10-09")]))
      .toMatchObject({ stage: 3, target: 10_100_000, shortage: 5_050_000, due: "2026-11-08" });
  });
  it("cicilan pertama 50% tetap diikuti cicilan kedua minimal 25%, bukan target kumulatif tetap 50%", () => {
    expect(progress([payment("a",5_050_000,"2026-10-05")]))
      .toMatchObject({ stage: 2, target: 7_575_000, shortage: 2_525_000 });
  });
  it("cicilan ketiga mengambil sisa sebenarnya ketika cicilan awal lebih besar", () => {
    expect(progress([payment("a",5_050_000,"2026-10-05"),payment("b",2_525_000,"2026-10-09")]))
      .toMatchObject({ stage: 3, shortage: 2_525_000 });
  });
  it("skema sekaligus meminta seluruh sisa sampai tenggat pertama", () => {
    expect(progress([payment("a",1_000_000,"2026-10-05")], { scheme: "lunas" }))
      .toMatchObject({ target: 10_100_000, shortage: 9_100_000, stage: 1, due: "2026-10-15" });
  });
  it("tidak menandai terlambat pada hari tenggat; terlambat mulai hari berikutnya", () => {
    expect(progress([], { today: "2026-10-15" })).toMatchObject({ overdueDays: 0, nearDue: true });
    expect(progress([], { today: "2026-10-16" }).overdueDays).toBe(1);
  });
  it("mengenali pembayaran lunas di tengah cicilan dan menghapus tenggat aktif", () => {
    expect(progress([payment("a",10_100_000,"2026-10-05")])).toMatchObject({ status: "lunas", due: null, remaining: 0, overdueDays: 0 });
  });
  it("tidak melabeli tagihan yang belum dibuat sebagai lunas / tunggakan", () => {
    expect(progress([], { billIds: [], total: 0 })).toMatchObject({ status: "belum_ada_tagihan", due: null });
  });
  it("tagihan nol setelah keringanan dapat dinyatakan selesai tanpa pembayaran palsu", () => {
    expect(progress([], { total: 0 })).toMatchObject({ status: "lunas", due: null, remaining: 0 });
  });
  it("tidak menetapkan skema dan keterlambatan sebelum kesepakatan dicatat", () => {
    expect(progress([], { scheme: null, today: "2026-11-01" })).toMatchObject({ status: "belum_diatur", due: null, overdueDays: 0 });
  });
  it("mengabaikan pembayaran jenjang/tahun lama dan transaksi belum bertanggal efektif", () => {
    expect(progress([payment("a",8_000_000,"2026-10-05","old"),payment("b",1_000_000,"2026-10-20")]).paid).toBe(0);
  });
  it("anomali kelebihan bayar atau pembayaran negatif memerlukan verifikasi", () => {
    expect(progress([payment("a",11_000_000,"2026-10-05")]).status).toBe("perlu_verifikasi");
    expect(progress([payment("a",-1_000_000,"2026-10-05")]).status).toBe("perlu_verifikasi");
  });
  it("tenggat tidak dihitung dari tanggal tagihan jika tanggal lulus hilang", () => {
    expect(progress([], { passedAt: null })).toMatchObject({ status: "perlu_verifikasi", due: null });
  });
  it("perpanjangan berlaku hanya untuk tahap berjalan dan versi skema saat ini", () => {
    expect(progress([], { events: [event(2,1,"2026-10-20"),event(3,2,"2026-12-01")], schemeEventId: 1 }).due).toBe("2026-10-20");
    expect(progress([], { events: [event(2,1,"2026-10-20")], schemeEventId: 4 }).due).toBe("2026-10-15");
  });
  it("dua perpanjangan bersamaan tidak memperpendek tenggat", () => {
    expect(progress([], { events: [event(2,1,"2026-10-25"),event(3,1,"2026-10-20")] }).due).toBe("2026-10-25");
  });
  it("catatan tidak terbawa ketika jenjang, gelombang, tahun atau siklus pendaftaran berubah", () => {
    const e = event(1,1,"2026-10-20");
    expect(matchesRegistration(e, detail)).toBe(true);
    for (const patch of [
      { spmb_departemen_tujuan_id: "sma" }, { tahun_ajaran_id: "2028" },
      { spmb_gelombang_id: "next" }, { spmb_registered_at: "2027-01-01T00:00:00Z" },
    ]) expect(matchesRegistration(e, { ...detail, ...patch })).toBe(false);
  });
  it("tagihan hanya dipilih untuk siswa, jenis uang pangkal, lembaga dan tahun akademik yang tepat", () => {
    const types = [
      { id: "pangkal", nama: "UANG PANGKAL SMP", departemen_id: "smp" },
      { id: "legacy", nama: "SALDO UANG PANGKAL LAMA SMP ASRAMA", departemen_id: "smp" },
      { id: "sd", nama: "UANG PANGKAL SD", departemen_id: "sd" },
      { id: "spp", nama: "SPP SMP", departemen_id: "smp" },
    ];
    const bill = { id: "valid", siswa_id: "student", jenis_id: "pangkal", tahun_akademik_id: "2027", nominal: 10_100_000, status: "terjadwal" };
    const bills = [bill, ...[
      { id: "oldyear", tahun_akademik_id: "2026" }, { id: "unknown", tahun_akademik_id: null },
      { id: "cancelled", status: "dibatalkan" }, { id: "otherstudent", siswa_id: "other" },
      { id: "legacy", jenis_id: "legacy" }, { id: "otherunit", jenis_id: "sd" }, { id: "spp", jenis_id: "spp" },
    ].map(patch => ({ ...bill, ...patch }))];
    expect(selectRegistrationBills(detail, bills, types).map(b => b.id)).toEqual(["valid"]);
  });
});
