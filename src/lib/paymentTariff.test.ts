import { describe, expect, it } from "vitest";
import { resolvePaymentAmount, resolvePaymentTariff } from "./paymentTariff";

describe("resolvePaymentAmount", () => {
  it("mengambil sisa tagihan terpilih walau tarif siswa lebih besar", () => {
    expect(resolvePaymentAmount(150000, 500000, 500000)).toBe(150000);
  });

  it("tidak kembali menagih tarif penuh bila nominal tagihan rusak", () => {
    expect(resolvePaymentAmount(null, 500000, 500000)).toBe(0);
    expect(resolvePaymentAmount(undefined, 500000, 500000)).toBe(500000);
  });
});

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
