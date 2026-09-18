export const SPMB_TARGET_ACADEMIC_YEAR = "Tahun Ajaran 2027-2028";
export const SPMB_TARGET_COHORT = "Angkatan 2027";
export const SPMB_CATEGORY_VALUE = "MURID BARU";
export const SPMB_CATEGORY_LABEL = "Murid Baru";
export const SPMB_TRANSFER_CATEGORY_VALUE = "MURID PINDAHAN";
export const SPMB_TRANSFER_CATEGORY_LABEL = "Siswa Pindahan";

// 23 Sep 2026 00:00 WIB = 22 Sep 2026 17:00 UTC.
export const SPMB_FIRST_WAVE_START_AT = Date.parse("2026-09-22T17:00:00.000Z");
// 31 Oct 2026 00:00 WIB = 30 Oct 2026 17:00 UTC.
// Batas ini eksklusif, sehingga 30 Oktober 2026 tetap termasuk Gelombang 1.
export const SPMB_FIRST_WAVE_END_AT = Date.parse("2026-10-30T17:00:00.000Z");

function toMillis(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

export function isSpmbRegistrationOpen(now: Date | number | string = Date.now()): boolean {
  const time = toMillis(now);
  return Number.isFinite(time) && time >= SPMB_FIRST_WAVE_START_AT && time < SPMB_FIRST_WAVE_END_AT;
}

export function isSpmbFirstWaveFree(createdAt: Date | number | string): boolean {
  const time = toMillis(createdAt);
  return Number.isFinite(time) && time >= SPMB_FIRST_WAVE_START_AT && time < SPMB_FIRST_WAVE_END_AT;
}

export function isSpmbPaymentVisible(now: Date | number | string = Date.now()): boolean {
  const time = toMillis(now);
  return Number.isFinite(time) && time >= SPMB_FIRST_WAVE_END_AT;
}

export const SPMB_FIRST_WAVE_MESSAGE =
  "Selamat! Anda mendapatkan gratis biaya pendaftaran sebagai apresiasi bagi pendaftar Gelombang Pertama, 23 September–30 Oktober 2026. Tim kami akan menghubungi orang tua/wali untuk menginformasikan jadwal dan tahapan seleksi.";
