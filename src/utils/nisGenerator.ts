import { generateNis } from "@/server/nis";

export interface NISComponents {
  tahun2: string;
  kodeLembaga: string;
  nomorUrut: string;
}

export function getKodeLembagaNIS(kodeAtauNama: string): string {
  const value = String(kodeAtauNama || "").trim().toUpperCase();

  if (value === "TK" || /(^|\s)TK(\s|$)/.test(value)) return "01";
  if (value === "SD" || /(^|\s)SD(\s|$)/.test(value)) return "02";
  if (value === "SMP" || /(^|\s)SMP(\s|$)/.test(value)) return "03";
  if (value === "SMA" || /(^|\s)SMA(\s|$)/.test(value)) return "04";
  if (
    value === "MTA"
    || value === "MTQ"
    || /(^|\s)(MTA|MTQ)(\s|$)/.test(value)
  ) return "05";

  return "--";
}

/**
 * Parse komponen preview NIS baru: YY-KK-NNN.
 */
export function parseNISComponents(
  kodeLembaga: string,
  namaAngkatan: string,
  nomorUrut: number,
): NISComponents {
  const tahunMatch = String(namaAngkatan || "").trim().match(/\d{4}/);
  const tahun2 = tahunMatch ? tahunMatch[0].slice(-2) : "--";

  return {
    tahun2,
    kodeLembaga: getKodeLembagaNIS(kodeLembaga),
    nomorUrut: String(nomorUrut).padStart(3, "0"),
  };
}

/**
 * Generate preview NIS. Nomor urut sebenarnya ditentukan atomik oleh database.
 */
export function generateNISPreview(
  kodeLembaga: string,
  namaAngkatan: string,
  nomorUrut: number,
): string {
  const c = parseNISComponents(kodeLembaga, namaAngkatan, nomorUrut);
  return `${c.tahun2}-${c.kodeLembaga}-${c.nomorUrut}`;
}

/**
 * Panggil server function untuk generate & simpan NIS lembaga aktif.
 */
export async function generateNISViaEdgeFunction(payload: {
  siswa_id: string;
  departemen_id: string;
  angkatan_id: string;
  kelas_id?: string;
}): Promise<{ nis: string }> {
  const data = await generateNis({ data: payload });
  return { nis: data.nis };
}
