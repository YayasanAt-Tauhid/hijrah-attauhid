import { describe, expect, it } from "vitest";
import {
  SPMB_FIRST_WAVE_END_AT,
  SPMB_FIRST_WAVE_START_AT,
  SPMB_TARGET_ACADEMIC_YEAR,
  SPMB_TARGET_COHORT,
  isSpmbFirstWaveFree,
  isSpmbPaymentVisible,
  isSpmbRegistrationOpen,
} from "./spmbPolicy";

describe("kebijakan SPMB Gelombang Pertama", () => {
  it("menggunakan nama target yang sama dengan konfigurasi akademik database", () => {
    expect(SPMB_TARGET_ACADEMIC_YEAR).toBe("Tahun Ajaran 2027/2028");
    expect(SPMB_TARGET_COHORT).toBe("2027");
  });

  it("membuka pendaftaran hanya 23 Sep sampai 30 Okt 2026 WIB", () => {
    expect(isSpmbRegistrationOpen(SPMB_FIRST_WAVE_START_AT - 1)).toBe(false);
    expect(isSpmbRegistrationOpen(SPMB_FIRST_WAVE_START_AT)).toBe(true);
    expect(isSpmbRegistrationOpen(SPMB_FIRST_WAVE_END_AT - 1)).toBe(true);
    expect(isSpmbRegistrationOpen(SPMB_FIRST_WAVE_END_AT)).toBe(false);
  });

  it("memberikan gratis biaya pendaftaran pada periode Gelombang 1", () => {
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_START_AT - 1)).toBe(false);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_START_AT)).toBe(true);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_END_AT - 1)).toBe(true);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_END_AT)).toBe(false);
  });

  it("menutup pembayaran sebelum dan selama Gelombang 1, lalu membuka 31 Okt 2026 00:00 WIB", () => {
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT - 1)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT - 1)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT)).toBe(true);
  });
});
