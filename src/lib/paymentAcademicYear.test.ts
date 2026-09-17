import { describe, expect, it } from "vitest";
import { resolvePaymentAcademicYear } from "./paymentAcademicYear";

describe("resolvePaymentAcademicYear", () => {
  it("memakai tahun ajaran pendaftaran untuk pembayaran SPMB", () => {
    expect(resolvePaymentAcademicYear({
      requestedYearId: "tahun-aktif-lama",
      spmbRegistrationYearId: "tahun-pendaftaran-baru",
      isSpmbPayment: true,
    })).toBe("tahun-pendaftaran-baru");
  });

  it("menolak pembayaran SPMB yang tidak memiliki tahun pendaftaran", () => {
    expect(() => resolvePaymentAcademicYear({
      requestedYearId: "tahun-aktif",
      spmbRegistrationYearId: null,
      isSpmbPayment: true,
    })).toThrow("Tahun ajaran pendaftaran SPMB belum dikonfigurasi");
  });

  it("mempertahankan tahun yang diminta untuk pembayaran biasa", () => {
    expect(resolvePaymentAcademicYear({
      requestedYearId: "tahun-diminta",
      isSpmbPayment: false,
    })).toBe("tahun-diminta");
  });
});
