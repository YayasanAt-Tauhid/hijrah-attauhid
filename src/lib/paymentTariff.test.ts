import { describe, expect, it } from "vitest";
import { resolvePaymentTariff } from "./paymentTariff";

describe("resolvePaymentTariff", () => {
  it("memprioritaskan tarif khusus siswa", () => {
    expect(resolvePaymentTariff("275000", "300000")).toBe(275000);
  });

  it("menggunakan nominal default jenis pembayaran jika tarif khusus tidak ada", () => {
    expect(resolvePaymentTariff(null, "300000.00")).toBe(300000);
  });

  it("menolak tarif jika tarif khusus dan nominal default tidak valid", () => {
    expect(resolvePaymentTariff(null, null)).toBe(0);
    expect(resolvePaymentTariff(0, -1)).toBe(0);
  });
});
