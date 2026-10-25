import { readUniformSizes, uniformDepartment, UNIFORM_TYPES, UNIFORM_SIZES } from "@/lib/ukuranSeragam";

type Registration = Record<string, unknown>;
type Department = { id: string; nama: string; kode?: string };
export type UniformCountRow = {
  id: string; lembaga: string; jenisKelamin: string; jenis: string; ukuran: string; jumlah: number;
};
export function summarizeUniforms(rows: Registration[], departments: Department[]) {
  const groups = new Map<string, UniformCountRow>();
  let complete = 0;
  let recorded = 0;
  let eligible = 0;
  let unavailable = 0;
  for (const row of rows) {
    const dept = departments.find((item) => item.id === row.departemen_id);
    const label = dept?.kode || dept?.nama || String(row._lembagaNama || row._lembagaKode || "Belum ditentukan");
    const code = uniformDepartment({ kode: String(row._lembagaKode || dept?.kode || ""), nama: dept?.nama || label });
    if (code === "TK") { unavailable++; continue; }
    eligible++;
    const gender = row.jenis_kelamin === "L" ? "Ikhwan" : row.jenis_kelamin === "P" ? "Akhwat" : "Belum diisi";
    const detail = row._spmbDetail && typeof row._spmbDetail === "object"
      ? row._spmbDetail as Record<string, unknown> : {};
    const entries = readUniformSizes(detail.ukuran_seragam);
    const defaultNames = UNIFORM_TYPES[code + "/" + String(row.jenis_kelamin)] || [];
    let filled = 0;
    entries.forEach((item, index) => {
      const savedName = item.jenis.trim().replace(/\s+/g, " ");
      const savedSize = item.ukuran.trim().replace(/\s+/g, " ").toUpperCase();
      const valid = Boolean(savedName && savedSize);
      // Nama bawaan hanya melabeli entri kosong, bukan bukti ukuran sudah dicatat.
      const jenis = savedName || defaultNames[index] || "Stel " + (index + 1) + " (nama belum diisi)";
      const ukuran = valid ? savedSize.replace(/^X([345])L$/, "$1XL") : "Belum diisi";
      if (valid) { filled++; recorded++; }
      const key = JSON.stringify([String(row.departemen_id || ""), label.toLowerCase(), gender, jenis.toLowerCase(), ukuran]);
      const group = groups.get(key);
      if (group) group.jumlah++;
      else groups.set(key, { id: key, lembaga: label, jenisKelamin: gender, jenis, ukuran, jumlah: 1 });
    });
    if (filled === 4) complete++;
  }
  const rekap = [...groups.values()].sort((a, b) =>
    a.lembaga.localeCompare(b.lembaga, "id") || a.jenisKelamin.localeCompare(b.jenisKelamin, "id")
    || a.jenis.localeCompare(b.jenis, "id") || a.ukuran.localeCompare(b.ukuran, "id", { numeric: true }));
  return { eligible, unavailable, complete, incomplete: eligible - complete, recorded, missing: eligible * 4 - recorded, rekap };
}

// Satu baris per lembaga/jenis kelamin/jenis; ukuran menjadi kolom.
export type UniformSizeCountRow = {
  id: string; lembaga: string; jenisKelamin: string; jenis: string;
  jumlah: number; belumDiisi: number; [key: string]: string | number;
};
export function buildUniformSizeTable(rekap: UniformCountRow[]) {
  const sizes = [...UNIFORM_SIZES, ...[...new Set(rekap.map((row) => row.ukuran))]
    .filter((size) => size !== "Belum diisi" && !UNIFORM_SIZES.includes(size))
    .sort((a, b) => a.localeCompare(b, "id", { numeric: true }))];
  const groups = new Map<string, UniformSizeCountRow>();
  for (const row of rekap) {
    // ID rekap memuat ID lembaga, sehingga lembaga dengan label sama tetap terpisah.
    const originalKey = JSON.parse(row.id) as string[];
    const id = JSON.stringify(originalKey.slice(0, -1));
    let group = groups.get(id);
    if (!group) {
      group = { id, lembaga: row.lembaga, jenisKelamin: row.jenisKelamin, jenis: row.jenis, jumlah: 0, belumDiisi: 0 };
      sizes.forEach((_, index) => { group!["size_" + index] = 0; });
      groups.set(id, group);
    }
    if (row.ukuran === "Belum diisi") group.belumDiisi += row.jumlah;
    else {
      const key = "size_" + sizes.indexOf(row.ukuran);
      group[key] = Number(group[key]) + row.jumlah;
      group.jumlah += row.jumlah;
    }
  }
  return { sizes, rows: [...groups.values()] };
}

// Gabungkan rincian lembaga/jenis kelamin untuk rekap tiap jenis seragam.
export function summarizeUniformSizeTotals(rows: UniformSizeCountRow[], sizes: string[]) {
  const empty = (id: string, jenis: string): UniformSizeCountRow => ({
    id, jenis, lembaga: "", jenisKelamin: "", jumlah: 0, belumDiisi: 0,
    ...Object.fromEntries(sizes.map((_, index) => ["size_" + index, 0])),
  });
  const total = empty("total", "Total per ukuran");
  const groups = new Map<string, UniformSizeCountRow>();
  const add = (target: UniformSizeCountRow, row: UniformSizeCountRow) => {
    target.jumlah += row.jumlah;
    target.belumDiisi += row.belumDiisi;
    sizes.forEach((_, index) => {
      const key = "size_" + index;
      target[key] = Number(target[key]) + Number(row[key] || 0);
    });
  };
  for (const row of rows) {
    const label = row.jenis.trim().replace(/\s+/g, " ");
    const key = label.toLocaleLowerCase("id");
    const group = groups.get(key) || empty(key, label);
    add(group, row);
    add(total, row);
    groups.set(key, group);
  }
  return {
    rows: [...groups.values()].sort((a, b) => a.jenis.localeCompare(b.jenis, "id")),
    total,
  };
}

export function transposeUniformSizeTable(columns: UniformSizeCountRow[], sizes: string[]) {
  const makeRow = (id: string, ukuran: string, key: string) => {
    const values = columns.map((column, index) => ["column_" + index, Number(column[key] || 0)] as const);
    return { id, ukuran, ...Object.fromEntries(values), jumlah: values.reduce((sum, [, value]) => sum + value, 0) };
  };
  return {
    rows: [...sizes.map((size, index) => makeRow("size_" + index, size, "size_" + index)), makeRow("missing", "Belum diisi", "belumDiisi")],
    total: makeRow("total", "Total per jenis", "jumlah"),
  };
}
