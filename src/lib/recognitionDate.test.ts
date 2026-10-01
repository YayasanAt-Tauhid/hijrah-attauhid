import { describe, expect, it } from "vitest";
import { recognitionDueDate, canRecognizeRevenue } from "./recognitionDate";

describe("pengakuan pendapatan lintas tahun buku", () => {
  it("uang pangkal TA 2027/2028 tetap menunggu Juli walaupun Tahun Buku mulai Januari", () => {
    const due = recognitionDueDate({ billDueDate: "2027-07-01", targetBookStart: "2027-01-01", month: null });
    expect(due).toBe("2027-07-01");
    expect(canRecognizeRevenue(due, "2026-10-01")).toBe(false);
    expect(canRecognizeRevenue(due, "2027-01-01")).toBe(false);
    expect(canRecognizeRevenue(due, "2027-06-30")).toBe(false);
    expect(canRecognizeRevenue(due, "2027-07-01")).toBe(true);
  });
  it("mempertahankan jadwal tagihan bulanan dan fallback data lama", () => {
    expect(recognitionDueDate({ billDueDate: "2027-02-15", targetBookStart: "2027-01-01", month: 2 })).toBe("2027-02-15");
    expect(recognitionDueDate({ targetBookStart: "2027-01-01", month: 2, dueDay: 10 })).toBe("2027-02-10");
  });
  it("memblokir pengakuan tanpa jadwal yang dapat ditentukan", () => {
    expect(canRecognizeRevenue(recognitionDueDate({}), "2027-07-01")).toBe(false);
  });
});

describe("SPP berdasarkan akhir bulan layanan", () => {
  const input = { paymentName: "SPP TK", paymentType: "bulanan", targetBookStart: "2027-01-01", month: 2, dueDay: 10 };
  it("memisahkan batas pembayaran tanggal 10 dari pengakuan penuh tanggal 28", () => {
    const due = recognitionDueDate({ ...input, billDueDate: "2027-02-10" });
    expect(due).toBe("2027-02-28");
    expect(canRecognizeRevenue(due, "2027-02-10")).toBe(false);
    expect(canRecognizeRevenue(due, "2027-02-27")).toBe(false);
    expect(canRecognizeRevenue(due, "2027-02-28")).toBe(true);
  });
  it("memakai akhir Februari kabisat dan pemetaan Juli-Juni", () => {
    expect(recognitionDueDate({ ...input, targetBookStart: "2027-07-01" })).toBe("2028-02-29");
    expect(recognitionDueDate({ ...input, targetBookStart: "2028-01-01" })).toBe("2028-02-29");
  });
  it("memakai tanggal pengakuan eksplisit meski jatuh tempo berubah", () => {
    expect(recognitionDueDate({ ...input, billDueDate: "2027-02-15", billRecognitionDate: "2027-02-28" })).toBe("2027-02-28");
  });
  it("tidak mengubah saldo lama atau tagihan non-SPP", () => {
    expect(recognitionDueDate({ ...input, paymentName: "SALDO PIUTANG LAMA TK", billDueDate: "2027-02-10" })).toBe("2027-02-10");
    expect(recognitionDueDate({ ...input, paymentName: "UANG PANGKAL TK", paymentType: "sekali", month: null, billDueDate: "2027-07-01" })).toBe("2027-07-01");
  });
  it("menolak SPP tanpa bulan layanan atau tahun buku yang valid", () => {
    expect(recognitionDueDate({ ...input, month: null })).toBe(null);
    expect(recognitionDueDate({ ...input, targetBookStart: null })).toBe(null);
  });
});
