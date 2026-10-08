import { describe, expect, it } from "vitest";
import { historyBillBalance, isPendingHistoryOutdated } from "./paymentHistory";

describe("payment history installments", () => {
  const balance = historyBillBalance({
    id: "khalid-uang-pangkal", nominal: "4200000", status: "terjadwal",
    pembayaran: [{ jumlah: "1000000" }],
  })!;

  it("shows the current remaining bill after a successful installment", () => {
    expect(balance).toMatchObject({ nominal: 4200000, paid: 1000000, remaining: 3200000, payable: true });
  });
  it("warns about the older full-amount order without changing a successful transaction", () => {
    expect(isPendingHistoryOutdated("pending", [{ jumlah: 4200000, balance }])).toBe(true);
    expect(isPendingHistoryOutdated("paid", [{ jumlah: 1000000, balance }])).toBe(false);
    expect(isPendingHistoryOutdated("expired", [{ jumlah: 4200000, balance }])).toBe(false);
  });
  it("allows an unpaid order matching the remaining amount", () => {
    expect(isPendingHistoryOutdated("pending", [{ jumlah: 3200000, balance }])).toBe(false);
  });
  it("aggregates repeated items for the same bill", () => {
    expect(isPendingHistoryOutdated("pending", [
      { jumlah: 2000000, balance }, { jumlah: 2000000, balance },
    ])).toBe(true);
  });
  it("does not invent a bill balance for historical unlinked payments", () => {
    expect(historyBillBalance(null)).toBeNull();
    expect(isPendingHistoryOutdated("pending", [{ jumlah: 1000000, balance: null }])).toBe(false);
  });
  it("warns when the bill was canceled and clamps overpayments to zero", () => {
    const canceled = historyBillBalance({ id: "c", nominal: 1000000, status: "dibatalkan", pembayaran: [] })!;
    expect(isPendingHistoryOutdated("pending", [{ jumlah: 1000000, balance: canceled }])).toBe(true);
    expect(historyBillBalance({ id: "p", nominal: 1000000, status: "lunas", pembayaran: [{ jumlah: 1200000 }] })?.remaining).toBe(0);
  });
});
