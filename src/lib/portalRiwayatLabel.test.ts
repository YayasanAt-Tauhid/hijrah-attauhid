import { describe, expect, it } from "vitest";
import { labelMetode } from "./portalRiwayatLabel";

describe("labelMetode", () => {
  it("menerjemahkan jenis pembayaran Midtrans yang umum", () => {
    expect(labelMetode("qris")).toBe("QRIS");
    expect(labelMetode("bank_transfer")).toBe("Transfer bank");
    expect(labelMetode("gopay")).toBe("GoPay");
    expect(labelMetode("credit_card")).toBe("Kartu kredit");
  });

  it("mengubah nilai lain menjadi teks yang rapi tanpa menebak artinya", () => {
    expect(labelMetode("cstore")).toBe("Minimarket");
    expect(labelMetode("some_new_method")).toBe("Some new method");
  });

  it("kosong bila tidak ada", () => {
    expect(labelMetode(null)).toBe("");
    expect(labelMetode(undefined)).toBe("");
    expect(labelMetode("  ")).toBe("");
  });
});
