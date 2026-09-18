import { describe, expect, it } from "vitest";
import {
  SPMB_FIRST_WAVE_END_AT,
  SPMB_FIRST_WAVE_START_AT,
  isSpmbFirstWaveFree,
  isSpmbPaymentVisible,
} from "./spmbPolicy";

describe("kebijakan SPMB Gelombang Pertama", () => {
  it("memberikan gratis biaya pendaftaran hanya 21 Sep sampai 23 Okt 2026 WIB", () => {
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_START_AT - 1)).toBe(false);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_START_AT)).toBe(true);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_END_AT - 1)).toBe(true);
    expect(isSpmbFirstWaveFree(SPMB_FIRST_WAVE_END_AT)).toBe(false);
  });

  it("membuka pembayaran sebelum promo dan mulai lagi 24 Okt 2026 00:00 WIB", () => {
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT - 1)).toBe(true);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_START_AT)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT - 1)).toBe(false);
    expect(isSpmbPaymentVisible(SPMB_FIRST_WAVE_END_AT)).toBe(true);
  });
});
