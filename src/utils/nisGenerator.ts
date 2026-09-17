import { generateNis } from "@/server/nis";
import { getKodeRombel } from "@/lib/nisRombel";

export { getKodeRombel } from "@/lib/nisRombel";

export interface NISComponents {
  npsn4: string;
  nomorUrut: string;
  kodeRombel: string;
  tahun2: string;
}

/**
 * Parse komponen NIS dari data mentah.
 */
export function parseNISComponents(
  npsn: string,
  namaKelas: string,
  namaAngkatan: string,
  nomorUrut: number
): NISComponents {
  const npsn4 = npsn.slice(-4);
  const tahunMatch = namaAngkatan.trim().match(/\d{4}/);
  const tahun2 = tahunMatch ? tahunMatch[0].slice(-2) : namaAngkatan.trim().slice(-2);
  const rombel = getKodeRombel(namaKelas);
  return {
    npsn4,
    nomorUrut: String(nomorUrut).padStart(3, "0"),
    kodeRombel: String(rombel ?? 0),
    tahun2,
  };
}

/**
 * Generate preview string NIS 10 digit.
 */
export function generateNISPreview(
  npsn: string,
  namaKelas: string,
  namaAngkatan: string,
  nomorUrut: number
): string {
  const c = parseNISComponents(npsn, namaKelas, namaAngkatan, nomorUrut);
  return `${c.npsn4}${c.nomorUrut}${c.kodeRombel}${c.tahun2}`;
}

/**
 * Panggil server function generateNis untuk generate & simpan NIS.
 */
export async function generateNISViaEdgeFunction(payload: {
  siswa_id: string;
  departemen_id: string;
  angkatan_id: string;
  kelas_id: string;
}): Promise<{ nis: string }> {
  const data = await generateNis({ data: payload });
  return { nis: data.nis };
}
