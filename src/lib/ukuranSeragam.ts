// Katalog dari lampiran pengguna, 21 Oktober 2026. TK dan MTA putri belum tersedia.
export const UNIFORM_CATALOG: Record<string, Record<string, string[]>> = {
  "MTA/L": {
    "PRAMUKA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "PUTIH BIRU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SD/L": {
    "SATUAN BAJU (MERAH PUTIH DAN COKLAT)": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SATUAN BAJU BIRU (GAMIS)": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SATUAN CELANA BIRU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SATUAN CELANA (MERAH PUTIH DAN COKLAT)": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SETELAN OLAH RAGA": [
      "ALL SIZE"
    ],
    "SETELAN SERAGAM (MERAH PUTIH DAN COKLAT)": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SETELAN SERAGAM BIRU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SMA/L": {
    "PRAMUKA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "PUTIH BIRU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SMP/L": {
    "PRAMUKA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "PUTIH BIRU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SD/P": {
    "1 SET GAMIS": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "SATUAN BAJU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL"
    ],
    "BAJU+ROK/CELANA": [
      "ALL SIZE"
    ],
    "JILBAB + LOGO SEKOLAH": [
      "STANDART",
      "JUMBO"
    ],
    "KHIMAR": [
      "ALL SIZE"
    ],
    "SATUAN ROK/CELANA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL"
    ],
    "SETELAN SERAGAM": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SMA/P": {
    "Jilbab Jersey Super": [
      "ALL SIZE"
    ],
    "Setelan Rok Celana dan Atasan": [
      "ALL SIZE"
    ],
    "PRAMUKA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "PUTIH BIRU/ABU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ]
  },
  "SMP/P": {
    "Jilbab Jersey Super": [
      "ALL SIZE"
    ],
    "PRAMUKA": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "PUTIH BIRU/ABU": [
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL"
    ],
    "Setelan Rok Celana dan Atasan": [
      "ALL SIZE"
    ]
  }
};

export type UniformSize = { jenis: string; ukuran: string };
export const emptyUniformSizes = (): UniformSize[] => Array.from({ length: 4 }, () => ({ jenis: "", ukuran: "" }));

export function uniformDepartment(dept?: { kode?: string | null; nama?: string | null }): string {
  const code = (dept?.kode || dept?.nama || "").trim().toUpperCase();
  return ["TK", "SD", "SMP", "SMA", "MTA"].find((key) => code === key || code.startsWith(key + " ")) || "";
}

export function uniformOptions(department: string, gender: string): Record<string, string[]> {
  return UNIFORM_CATALOG[department + "/" + gender] || {};
}

export function readUniformSizes(value: unknown): UniformSize[] {
  if (!Array.isArray(value)) return emptyUniformSizes();
  return emptyUniformSizes().map((empty, index) => {
    const item = value[index];
    return item && typeof item.jenis === "string" && typeof item.ukuran === "string"
      ? { jenis: item.jenis, ukuran: item.ukuran } : empty;
  });
}

export function validateUniformSizes(values: UniformSize[], options: Record<string, string[]>): string | null {
  for (const [index, item] of values.entries()) {
    if (!item.jenis && !item.ukuran) continue;
    if (!item.jenis || !item.ukuran) return "Lengkapi jenis dan ukuran seragam stel " + (index + 1) + ".";
    if (!options[item.jenis]?.includes(item.ukuran)) return "Jenis atau ukuran seragam stel " + (index + 1) + " tidak sesuai lembaga dan jenis kelamin. Pilih ulang atau kosongkan stel tersebut.";
  }
  return null;
}
