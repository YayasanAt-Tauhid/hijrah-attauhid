import { describe, expect, it } from "vitest";
import { rentangTanggalWib, susunFilterTanggal } from "./onlinePaymentFilter";

describe("rentangTanggalWib", () => {
  it("memakai batas hari dalam WIB (+07:00), bukan zona waktu server", () => {
    const r = rentangTanggalWib("2026-11-25", "2026-11-26");
    expect(r.gte).toBe("2026-11-25T00:00:00+07:00");
    expect(r.lte).toBe("2026-11-26T23:59:59.999+07:00");
    // 00:00 WIB = 17:00 UTC hari sebelumnya
    expect(new Date(r.gte!).toISOString()).toBe("2026-11-24T17:00:00.000Z");
    expect(new Date(r.lte!).toISOString()).toBe("2026-11-26T16:59:59.999Z");
  });

  it("boleh hanya salah satu batas", () => {
    expect(rentangTanggalWib("2026-11-25", "")).toEqual({ gte: "2026-11-25T00:00:00+07:00" });
    expect(rentangTanggalWib("", "2026-11-26")).toEqual({ lte: "2026-11-26T23:59:59.999+07:00" });
  });

  it("kosong atau format tidak valid berarti tanpa batas", () => {
    expect(rentangTanggalWib("", "")).toEqual({});
    expect(rentangTanggalWib("25/11/2026", "2026-13-40")).toEqual({});
  });
});

describe("susunFilterTanggal", () => {
  it("tanggal dibuat: perilaku lama, transaksi tanpa paid_at tetap tampil", () => {
    expect(susunFilterTanggal("created_at", "2026-11-25", "")).toEqual({
      kolom: "created_at",
      gte: "2026-11-25T00:00:00+07:00",
      hanyaTerisi: false,
    });
  });

  it("tanggal dibayar: hanya transaksi yang sudah punya paid_at, walau tanpa rentang tanggal", () => {
    expect(susunFilterTanggal("paid_at", "", "")).toEqual({ kolom: "paid_at", hanyaTerisi: true });
    expect(susunFilterTanggal("paid_at", "2026-11-25", "2026-11-26")).toEqual({
      kolom: "paid_at",
      gte: "2026-11-25T00:00:00+07:00",
      lte: "2026-11-26T23:59:59.999+07:00",
      hanyaTerisi: true,
    });
  });
});
