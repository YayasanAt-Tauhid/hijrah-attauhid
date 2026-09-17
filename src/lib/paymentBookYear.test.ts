import { describe, expect, it } from "vitest";
import { resolvePaymentBookYear } from "./paymentBookYear";

describe("resolvePaymentBookYear", () => {
  it("memakai tahun buku yang memuat tanggal pembayaran", () => {
    expect(resolvePaymentBookYear({
      requestedBookYearId: "tahun-dari-klien",
      paymentDateBookYearId: "tahun-buku-tanggal-bayar",
    })).toBe("tahun-buku-tanggal-bayar");
  });

  it("mengabaikan ID tahun akademik yang keliru dari klien", () => {
    expect(resolvePaymentBookYear({
      requestedBookYearId: "tahun-akademik-2027-2028",
      paymentDateBookYearId: "tahun-buku-2026",
    })).toBe("tahun-buku-2026");
  });

  it("menolak transaksi bila tahun buku tanggal bayar belum tersedia", () => {
    expect(() => resolvePaymentBookYear({
      requestedBookYearId: "tahun-dari-klien",
      paymentDateBookYearId: null,
    })).toThrow("Tahun buku untuk tanggal bayar belum dikonfigurasi");
  });
});
