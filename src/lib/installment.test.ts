import { describe, expect, it } from "vitest";
import { calculateRemainingBill, isSppPaymentName, isUangPangkalPaymentName, resolveInstallmentAmount } from "./installment";

describe("resolveInstallmentAmount", () => {
  it("membolehkan cicilan bebas selama tidak melebihi sisa", () => {
    expect(resolveInstallmentAmount({
      requestedAmount: 1_250_000,
      remainingAmount: 7_000_000,
      allowPartial: true,
    })).toBe(1_250_000);
  });

  it("menolak pembayaran melebihi sisa", () => {
    expect(() => resolveInstallmentAmount({
      requestedAmount: 7_000_001,
      remainingAmount: 7_000_000,
      allowPartial: true,
    })).toThrow("melebihi sisa tagihan");
  });

  it("mewajibkan nominal penuh ketika cicilan tidak diizinkan", () => {
    expect(() => resolveInstallmentAmount({
      requestedAmount: 5_000_000,
      remainingAmount: 7_000_000,
      allowPartial: false,
    })).toThrow("harus dibayar penuh");
  });
});

describe("calculateRemainingBill", () => {
  it("menghitung total terbayar dan sisa secara aman", () => {
    expect(calculateRemainingBill(10_000_000, 3_250_000)).toEqual({
      total: 10_000_000,
      paid: 3_250_000,
      remaining: 6_750_000,
      paidOff: false,
    });
  });
});

describe("isSppPaymentName", () => {
  it("mengenali nama jenis SPP berbagai jenjang", () => {
    expect(isSppPaymentName("SPP SD")).toBe(true);
    expect(isSppPaymentName("SPP SMPITA NON ASRAMA")).toBe(true);
    expect(isSppPaymentName("SPP-SMA")).toBe(true);
  });

  it("tidak menganggap jenis non-SPP sebagai SPP", () => {
    expect(isSppPaymentName("UANG PANGKAL SD")).toBe(false);
    expect(isSppPaymentName("DAFTAR ULANG")).toBe(false);
    expect(isSppPaymentName("SPPPLUS")).toBe(false);
  });
});


describe("isUangPangkalPaymentName", () => {
  it("mengenali hanya Uang Pangkal jenjang yang didukung", () => {
    for (const jenjang of ["TK", "SD", "SMP", "SMA", "MTA"]) {
      expect(isUangPangkalPaymentName(`UANG PANGKAL ${jenjang}`)).toBe(true);
    }
  });

  it("tidak memperluas kebijakan cicilan ke biaya sekali bayar lain", () => {
    expect(isUangPangkalPaymentName("DAFTAR ULANG TK")).toBe(false);
    expect(isUangPangkalPaymentName("BIAYA PENDAFTARAN")).toBe(false);
    expect(isUangPangkalPaymentName("UANG PANGKAL DAYCARE")).toBe(false);
  });
});
