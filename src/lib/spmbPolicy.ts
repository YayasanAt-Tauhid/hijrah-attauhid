export const SPMB_TARGET_ACADEMIC_YEAR = "Tahun Ajaran 2027-2028";
export const SPMB_TARGET_COHORT = "Angkatan 2027";
export const SPMB_CATEGORY_VALUE = "MURID BARU";
export const SPMB_CATEGORY_LABEL = "Murid";

// 21 Sep 2026 00:00 WIB = 20 Sep 2026 17:00 UTC.
export const SPMB_FIRST_WAVE_START_AT = Date.parse("2026-09-20T17:00:00.000Z");
// 24 Oct 2026 00:00 WIB = 23 Oct 2026 17:00 UTC.
export const SPMB_FIRST_WAVE_END_AT = Date.parse("2026-10-23T17:00:00.000Z");
export const SPMB_PAYMENT_VISIBLE_FROM = SPMB_FIRST_WAVE_END_AT;

function toMillis(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

export function isSpmbFirstWaveFree(createdAt: Date | number | string): boolean {
  const time = toMillis(createdAt);
  return Number.isFinite(time) && time >= SPMB_FIRST_WAVE_START_AT && time < SPMB_FIRST_WAVE_END_AT;
}

export function isSpmbPaymentVisible(now: Date | number | string = Date.now()): boolean {
  const time = toMillis(now);
  return Number.isFinite(time) && time >= SPMB_PAYMENT_VISIBLE_FROM;
}

export const SPMB_FIRST_WAVE_MESSAGE =
  "Selamat! Anda mendapatkan gratis biaya pendaftaran sebagai apresiasi bagi pendaftar gelombang pertama, 21 September–23 Oktober 2026. Tim kami akan menghubungi orang tua/wali untuk menginformasikan jadwal dan tahapan seleksi.";
