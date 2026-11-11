/**
 * Validasi periode "Rekap Kasir Saya". Modul ini sengaja tanpa dependensi
 * (tidak mengimpor xlsx) karena dipakai juga oleh fungsi server.
 */

export const REKAP_KASIR_MAX_HARI = 31;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const time = Date.UTC(y, m - 1, d);
  const check = new Date(time);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return time;
}

/**
 * `tanggal` tunggal tetap diterima (perilaku lama); rentang dibatasi 31 hari
 * agar query dan file tetap ringan.
 */
export function parseRekapKasirRange(input: {
  tanggal?: string | null;
  tanggal_dari?: string | null;
  tanggal_sampai?: string | null;
}): { dari: string; sampai: string } {
  const dari = String(input?.tanggal_dari ?? input?.tanggal ?? "").trim();
  const sampai = String(input?.tanggal_sampai ?? input?.tanggal ?? dari).trim();
  const dariTime = parseIsoDate(dari);
  const sampaiTime = parseIsoDate(sampai);
  if (dariTime === null || sampaiTime === null) {
    throw new Error("Tanggal rekap tidak valid");
  }
  if (dariTime > sampaiTime) {
    throw new Error("Tanggal awal harus sebelum atau sama dengan tanggal akhir");
  }
  const hari = (sampaiTime - dariTime) / 86_400_000 + 1;
  if (hari > REKAP_KASIR_MAX_HARI) {
    throw new Error(`Rentang rekap maksimal ${REKAP_KASIR_MAX_HARI} hari`);
  }
  return { dari, sampai };
}
