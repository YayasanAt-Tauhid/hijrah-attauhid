import { describe, expect, it } from "vitest";
import {
  SPMB_FIRST_WAVE_END_AT,
  SPMB_FIRST_WAVE_START_AT,
  isSpmbFirstWaveFree,
  isSpmbPaymentVisible,
  isSpmbRegistrationOpen,
} from "./spmbPolicy";

describe("kebijakan SPMB Gelombang Pertama", () => {
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

  it("menutup pembayaran selama promo dan membuka kembali 31 Okt 2026 00:00 WIB", () => {
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT - 1)).toBe(true);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT - 1)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT)).toBe(true);
  });
});
