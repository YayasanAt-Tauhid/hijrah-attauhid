import { readUniformSizes, uniformDepartment, UNIFORM_TYPES } from "@/lib/ukuranSeragam";

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
