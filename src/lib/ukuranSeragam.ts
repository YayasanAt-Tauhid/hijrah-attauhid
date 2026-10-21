// Empat jenis per lembaga mengikuti klarifikasi pengguna 21 Oktober 2026.
export const UNIFORM_TYPES: Record<string, string[]> = {
  "SD/L": ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"],
  "SD/P": ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"],
  "SMP/L": ["Olah raga", "Putih Biru", "Coklat", "Gamis Biru"],
  "SMP/P": ["Olah raga", "Putih Biru", "Coklat", "Gamis Ungu"],
  "SMA/L": ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"],
  "SMA/P": ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"],
};
export const UNIFORM_SIZES = ["S", "M", "L", "XL", "XXL", "3XL", "4XL", "ALL SIZE"];
export type UniformSize = { jenis: string; ukuran: string };
export const emptyUniformSizes = (): UniformSize[] => Array.from({ length: 4 }, () => ({ jenis: "", ukuran: "" }));

export function uniformDepartment(dept?: { kode?: string | null; nama?: string | null }): string {
  const code = (dept?.kode || dept?.nama || "").trim().toUpperCase();
  return ["TK", "SD", "SMP", "SMA", "MTA"].find((key) => code === key || code.startsWith(key + " ")) || "";
}

export function readUniformSizes(value: unknown): UniformSize[] {
  if (!Array.isArray(value)) return emptyUniformSizes();
  return emptyUniformSizes().map((empty, index) => {
    const item = value[index];
    return item && typeof item.jenis === "string" && typeof item.ukuran === "string"
      ? { jenis: item.jenis, ukuran: item.ukuran } : empty;
  });
}

// Nilai tersimpan (termasuk nama yang diedit dan data versi lama) tetap dipertahankan.
export function defaultUniformSizes(value: unknown, department: string, gender: string): UniformSize[] {
  const defaults = UNIFORM_TYPES[department + "/" + gender] || [];
  return readUniformSizes(value).map((item, index) => ({
    ...item,
    jenis: item.jenis || defaults[index] || "",
  }));
}

export function validateUniformSizes(values: UniformSize[]): string | null {
  for (const [index, item] of values.entries()) {
    if (item.ukuran && !item.jenis.trim()) return "Isi nama jenis seragam stel " + (index + 1) + ".";
    if (item.jenis.length > 80) return "Nama jenis seragam maksimal 80 karakter.";
    if (item.ukuran.length > 32) return "Ukuran seragam maksimal 32 karakter.";
  }
  return null;
}
