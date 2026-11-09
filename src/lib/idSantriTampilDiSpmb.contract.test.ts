import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ID Santri dibuat sejak pendaftaran (migrasi 20261108050000) dan harus terlihat
// oleh admin di /akademik/spmb: daftar, ekspor, pencarian, dan halaman detail.
const spmb = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");
const detailSpmb = readFileSync(resolve(process.cwd(), "src/pages/akademik/DetailSPMB.tsx"), "utf8");

describe("ID Santri tampil di halaman /akademik/spmb", () => {
  it("daftar SPMB punya kolom ID Santri dari siswa.id_santri_pihak3, kosong ditulis '-'", () => {
    expect(spmb).toMatch(/key:\s*"id_santri_pihak3",\s*label:\s*"ID Santri"[^\n]*\(value as string\)\s*\|\|\s*"-"/);
  });

  it("kolom ID Santri tampil secara bawaan (bukan hanya lewat 'Pilih kolom')", () => {
    const m = spmb.match(/const primaryColumnKeys = \[([^\]]*)\]/);
    expect(m, "primaryColumnKeys tidak ditemukan").not.toBeNull();
    expect(m![1]).toContain('"id_santri_pihak3"');
    // Aksi "id" tetap kolom terakhir.
    expect(m![1].trim().endsWith('"id"')).toBe(true);
  });

  it("ekspor Excel memuat kolom ID Santri", () => {
    const m = spmb.match(/const SPMB_EXPORT_COLUMNS = \[([\s\S]*?)\n\];/);
    expect(m, "SPMB_EXPORT_COLUMNS tidak ditemukan").not.toBeNull();
    expect(m![1]).toMatch(/key:\s*"id_santri_pihak3",\s*label:\s*"ID Santri"/);
  });

  it("pencarian daftar bisa memakai ID Santri", () => {
    const m = spmb.match(/searchKeys=\{\[([^\]]*)\]\}/);
    expect(m, "searchKeys tidak ditemukan").not.toBeNull();
    expect(m![1]).toContain('"id_santri_pihak3"');
    expect(spmb).toMatch(/searchPlaceholder="[^"]*ID Santri[^"]*"/);
  });

  it("halaman detail mengambil dan menampilkan ID Santri", () => {
    // Query siswa di detail memakai daftar kolom eksplisit, jadi kolomnya harus diminta.
    expect(detailSpmb).toMatch(/\.from\("siswa"\)\s*\.select\("[^"]*\bid_santri_pihak3\b[^"]*"\)/);
    expect(detailSpmb).toMatch(/<SummaryItem label="ID Santri" value=\{siswa\.id_santri_pihak3 \|\| "-"\} \/>/);
  });
});
