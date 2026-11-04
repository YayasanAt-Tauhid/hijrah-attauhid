import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(process.cwd(), "src/server/pembayaran.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/InputPembayaran.tsx"), "utf8");
const types = readFileSync(resolve(process.cwd(), "src/types/keuangan.ts"), "utf8");

const searchFn = server.slice(
  server.indexOf("export const cariSiswaPembayaran"),
  server.indexOf("export interface RekapKasirSayaInput"),
);

describe("info orang tua di loket pembayaran", () => {
  it("pencarian siswa menyertakan ringkasan orang tua lewat helper, bukan kolom mentah", () => {
    expect(server).toContain('from "@/lib/orangTuaSiswa"');
    expect(searchFn).toContain("ringkasOrangTua(");
    expect(searchFn).toContain("orang_tua:");
  });

  it("hanya mengambil kolom nama dan HP orang tua, tidak NIK, alamat, atau penghasilan", () => {
    const detailSelect = /"([^"]*nama_ayah[^"]*)"/.exec(searchFn)?.[1];
    expect(detailSelect).toBeDefined();
    for (const column of ["siswa_id", "nama_ayah", "nama_ibu", "telepon_ortu", "telepon_ayah", "telepon_ibu"]) {
      expect(detailSelect).toContain(column);
    }
    for (const forbidden of ["nik", "alamat", "penghasilan", "pekerjaan", "pendidikan", "tanggal_lahir"]) {
      expect(detailSelect).not.toContain(forbidden);
    }
  });

  it("memperkaya hanya hasil akhir (maksimal limit), bukan seluruh kandidat pencarian", () => {
    expect(searchFn.indexOf(".slice(0, limit)")).toBeGreaterThan(-1);
    expect(searchFn.indexOf('.from("siswa_detail")', searchFn.indexOf(".slice(0, limit)"))).toBeGreaterThan(
      searchFn.indexOf(".slice(0, limit)"),
    );
  });

  it("tipe siswa pembayaran membawa orang_tua dan halaman menampilkannya di hasil pencarian serta header siswa", () => {
    expect(types).toContain("orang_tua?:");
    expect(page).toContain('from "@/lib/orangTuaSiswa"');
    expect(page.match(/formatOrangTua\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
