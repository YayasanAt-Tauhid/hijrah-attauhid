import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(process.cwd(), "src/server/pembayaran.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/InputPembayaran.tsx"), "utf8");

const searchFn = server.slice(
  server.indexOf("export const cariSiswaPembayaran"),
  server.indexOf("export interface RekapKasirSayaInput"),
);

describe("pencarian siswa di loket pembayaran: nama, NIS, NISN, dan ID Santri", () => {
  it("mencari di keempat kolom identitas lewat ilike per kolom (bukan string .or() mentah)", () => {
    for (const column of ["nama", "nis", "nisn", "id_santri_pihak3"]) {
      expect(searchFn).toContain(`"${column}"`);
    }
    // Input kasir tidak boleh disisipkan ke filter .or() PostgREST: koma/kurung bisa merusak filter.
    expect(searchFn).not.toContain(".or(");
    expect(searchFn).toContain('.ilike(field, "%" + identitySearch + "%")');
  });

  it("menjalankan satu query per kolom identitas dan memeriksa error masing-masing", () => {
    expect(searchFn).toMatch(/SEARCH_FIELDS\.map\(\(field\) => buildQuery\(field\)\)/);
    expect(searchFn).toContain("for (const res of results)");
    expect(searchFn).toContain('if (res.error) throw new Error("Gagal mencari siswa: " + res.error.message)');
  });

  it("tetap memakai filter status/tagihan terbuka yang sama (hanya kolom pencarian yang bertambah)", () => {
    expect(searchFn).toContain("includeNonaktifWithOpenBills");
    expect(searchFn).toContain("includeCalonLulus");
    expect(searchFn).toContain("nonaktifDenganTagihanTerbuka");
  });

  it("placeholder halaman memberi tahu kasir bahwa NISN dan ID Santri bisa dicari", () => {
    expect(page).toMatch(/placeholder=\{?"[^"]*NISN[^"]*ID Santri[^"]*"/);
  });
});
