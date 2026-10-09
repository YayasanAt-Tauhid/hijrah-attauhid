import { describe, expect, it } from "vitest";
import { blocksNewPayment, canResumeMidtransSession, samePaymentItems } from "./pendingMidtransSession";

const now = Date.parse("2026-10-09T06:20:00.000Z");
const pending = {
  status: "pending",
  snap_token: "old-snap-token",
  gateway_closed_at: null,
  expired_at: "2026-10-09T07:00:00.000Z",
};

describe("Midtrans pending checkout reuse", () => {
  it("reuses the original valid token and never reuses paid, closed or expired sessions", () => {
    expect(canResumeMidtransSession(pending, now)).toBe(true);
    expect(canResumeMidtransSession({ ...pending, status: "paid" }, now)).toBe(false);
    expect(canResumeMidtransSession({ ...pending, status: "failed" }, now)).toBe(false);
    expect(canResumeMidtransSession({ ...pending, snap_token: null }, now)).toBe(false);
    expect(canResumeMidtransSession({ ...pending, gateway_closed_at: "2026-10-09T06:00:00Z" }, now)).toBe(false);
    expect(canResumeMidtransSession({ ...pending, expired_at: "2026-10-09T06:19:59Z" }, now)).toBe(false);
    expect(canResumeMidtransSession({ ...pending, expired_at: "invalid" }, now)).toBe(false);
  });

  it("matches the exact bill ids and amounts independent of cart order", () => {
    const original = [{ tagihan_id: "bill-a", jumlah: 400000 }, { tagihan_id: "bill-b", jumlah: 800000 }];
    expect(samePaymentItems(original, [...original].reverse())).toBe(true);
    expect(samePaymentItems(original, [{ tagihan_id: "bill-a", jumlah: 400000 }])).toBe(false);
    expect(samePaymentItems(original, [{ tagihan_id: "bill-a", jumlah: 400001 }, original[1]])).toBe(false);
    expect(samePaymentItems(original, [{ tagihan_id: "bill-a", jumlah: 400000 }, { tagihan_id: "bill-a", jumlah: 800000 }])).toBe(false);
    expect(samePaymentItems([{ tagihan_id: "bill-a", jumlah: 400000 }, { tagihan_id: "bill-b", jumlah: 400000 }], [{ tagihan_id: "bill-a", jumlah: 400000 }, { tagihan_id: "bill-a", jumlah: 400000 }])).toBe(false);
    expect(samePaymentItems([], [])).toBe(false);
  });

  it("blocks a fresh checkout until any unclosed prior session is canceled at gateway", () => {
    expect(blocksNewPayment({ status: "pending", gateway_closed_at: null, snap_token: "token" })).toBe(true);
    expect(blocksNewPayment({ status: "expired", gateway_closed_at: null, snap_token: "token" })).toBe(true);
    expect(blocksNewPayment({ status: "failed", gateway_closed_at: null, snap_token: "token" })).toBe(true);
    expect(blocksNewPayment({ status: "expired", gateway_closed_at: "2026-10-09T06:00:00Z", snap_token: "token" })).toBe(false);
    expect(blocksNewPayment({ status: "paid", gateway_closed_at: null, pembayaran_id: null })).toBe(true);
    expect(blocksNewPayment({ status: "paid", gateway_closed_at: null, pembayaran_id: "recorded" })).toBe(false);
  });
});
