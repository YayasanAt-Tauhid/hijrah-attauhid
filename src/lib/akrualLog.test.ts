import { describe, expect, it } from "vitest";
import { akrualChecklistStatus, hasAkrualGalat, normalizeAkrualRow, summarizeAkrualLog, type AkrualLogRow } from "./akrualLog";

const row = (over: Partial<AkrualLogRow> = {}): AkrualLogRow => ({
  id: "r", dijalankan_at: "2026-10-29T00:05:00Z", sumber: "cron", sampai_tanggal: "2026-10-29",
  piutang_diposting: 0, piutang_nominal: 0, pendapatan_diakui: 0, pendapatan_nominal: 0,
  jumlah_galat: 0, galat: [], galat_terpotong: false, gagal_total: false, pesan_gagal: null, ...over,
});
const now = new Date("2026-10-29T10:00:00Z");

describe("log akrual harian: deteksi galat", () => {
  it("galat terdeteksi dari jumlah galat atau kegagalan total", () => {
    expect(hasAkrualGalat(row())).toBe(false);
    expect(hasAkrualGalat(row({ jumlah_galat: 1 }))).toBe(true);
    expect(hasAkrualGalat(row({ gagal_total: true }))).toBe(true);
    expect(hasAkrualGalat(null)).toBe(false);
    expect(hasAkrualGalat(undefined)).toBe(false);
  });
  it("menormalkan baris dari database (numeric berupa string, galat bukan array, nilai null)", () => {
    const n = normalizeAkrualRow({ id: "x", dijalankan_at: "2026-10-29T00:05:00Z", sumber: "cron", sampai_tanggal: null,
      piutang_diposting: "3", piutang_nominal: "1500000.50", pendapatan_diakui: null, pendapatan_nominal: undefined,
      jumlah_galat: "2", galat: "bukan-array", galat_terpotong: null, gagal_total: null, pesan_gagal: null });
    expect(n).toMatchObject({ piutang_diposting: 3, piutang_nominal: 1500000.5, pendapatan_diakui: 0, pendapatan_nominal: 0,
      jumlah_galat: 2, galat: [], galat_terpotong: false, gagal_total: false, sampai_tanggal: null });
  });
});

describe("log akrual harian: ringkasan", () => {
  it("tanpa riwayat", () => {
    expect(summarizeAkrualLog([])).toMatchObject({ terakhir: null, adaGalat: false, hariBerturutGalat: 0, belumPernahJalan: true });
  });
  it("menghitung hari berturut-turut yang bergalat dari yang terbaru, berhenti di eksekusi bersih", () => {
    const rows = [row({ id: "3", jumlah_galat: 33 }), row({ id: "2", jumlah_galat: 33 }), row({ id: "1" }), row({ id: "0", jumlah_galat: 5 })];
    expect(summarizeAkrualLog(rows)).toMatchObject({ terakhir: { id: "3" }, adaGalat: true, hariBerturutGalat: 2, totalGalatTerakhir: 33, belumPernahJalan: false });
  });
});

describe("log akrual harian: butir checklist tutup buku", () => {
  it("belum ada riwayat: tidak dianggap masalah, tetapi dijelaskan", () => {
    const s = akrualChecklistStatus([], now);
    expect(s.ok).toBe(true);
    expect(s.detail).toMatch(/Belum ada riwayat/);
  });
  it("eksekusi terbaru bersih dan segar: hijau", () => {
    const s = akrualChecklistStatus([row()], now);
    expect(s.ok).toBe(true);
    expect(s.detail).toMatch(/tanpa galat/i);
  });
  it("eksekusi terbaru bergalat: peringatan dengan jumlah dan hari berturut-turut", () => {
    const s = akrualChecklistStatus([row({ id: "2", jumlah_galat: 33 }), row({ id: "1", jumlah_galat: 33 })], now);
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/33 galat/);
    expect(s.detail).toMatch(/2 hari berturut-turut/);
    expect(s.detail).toMatch(/Riwayat akrual harian/);
  });
  it("kegagalan total: peringatan memuat pesan", () => {
    const s = akrualChecklistStatus([row({ gagal_total: true, jumlah_galat: 1, pesan_gagal: "Akun piutang siswa belum dikonfigurasi" })], now);
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/gagal total/i);
    expect(s.detail).toMatch(/Akun piutang siswa/);
  });
  it("eksekusi terakhir lebih dari 36 jam lalu: job kemungkinan berhenti", () => {
    const s = akrualChecklistStatus([row({ dijalankan_at: "2026-10-27T00:05:00Z" })], now);
    expect(s.ok).toBe(false);
    expect(s.detail).toMatch(/lebih dari 1 hari/i);
  });
  it("eksekusi 30 jam lalu masih dianggap segar", () => {
    expect(akrualChecklistStatus([row({ dijalankan_at: "2026-10-28T04:00:00Z" })], now).ok).toBe(true);
  });
});
