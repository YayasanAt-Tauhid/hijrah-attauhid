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
