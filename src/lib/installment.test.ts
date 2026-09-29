import { describe, expect, it } from "vitest";
import { calculateRemainingBill, resolveInstallmentAmount } from "./installment";

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