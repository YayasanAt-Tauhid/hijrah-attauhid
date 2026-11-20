import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { kelasAktifNama, labelSiswaInternalSpmb } from "./pencarianSiswaPembayaran";

const server = readFileSync(resolve(process.cwd(), "src/server/pembayaran.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/PembayaranPMB.tsx"), "utf8");

const searchFn = server.slice(
  server.indexOf("export const cariSiswaPembayaran"),
  server.indexOf("export interface RekapKasirSayaInput"),
);

// Kasus Syifaussakinah (20 Nov 2026): siswa internal (SD kelas 6C -> SMP) berstatus
// siswa.status = 'aktif' dan departemen_id = SD, sehingga tidak pernah ditemukan oleh
// pencarian halaman Pembayaran SPMB yang mensyaratkan status 'calon' + lembaga yang sama.
describe("Pembayaran SPMB: siswa internal berstatus pendaftaran calon ikut dicari", () => {
  it("mengambil siswa internal calon dari siswa_detail berdasarkan lembaga TUJUAN SPMB, bukan lembaga asal", () => {
    expect(searchFn).toContain('"spmb_siswa_internal", true');
    expect(searchFn).toContain('"spmb_status_pendaftaran", "calon"');
    expect(searchFn).toContain('"spmb_departemen_tujuan_id", data.departemen_id');
  });

  it("hanya berlaku untuk mode SPMB (status calon) dan tidak melebarkan pencarian Input Pembayaran biasa", () => {
    expect(searchFn).toMatch(/status === "calon" && data\?\.departemen_id/);
    // Mode biasa tetap tidak boleh membuka calon/diterima tanpa opsi includeCalonLulus.
    expect(searchFn).toContain('...(includeCalonLulus ? ["calon", "diterima"] : [])');
  });

  it("mencari identitas siswa internal dengan ilike per kolom yang sama (tanpa .or() mentah)", () => {
    expect(searchFn).not.toContain(".or(");
    expect(searchFn).toContain('.in("id", internalSpmbIds)');
  });

  it("menandai hasil sebagai siswa internal agar kasir tidak salah memilih nama kembar", () => {
    expect(server).toContain("spmb_internal");
    expect(page).toContain("labelSiswaInternalSpmb");
    expect(page).not.toMatch(/<p className="text-xs text-muted-foreground">Status: Calon<\/p>/);
  });
});

describe("labelSiswaInternalSpmb", () => {
  it("menampilkan kelas aktif, lembaga asal, dan lembaga tujuan", () => {
    expect(
      labelSiswaInternalSpmb({ kelasNama: "6C", asalKode: "SD", tujuanKode: "SMP" }),
    ).toBe("Siswa internal · Kelas 6C · SD → SMP");
  });

  it("tetap rapi bila kelas atau lembaga asal tidak diketahui", () => {
    expect(labelSiswaInternalSpmb({ kelasNama: null, asalKode: null, tujuanKode: "SMP" })).toBe(
      "Siswa internal → SMP",
    );
    expect(labelSiswaInternalSpmb({ kelasNama: "6C", asalKode: "SD", tujuanKode: null })).toBe(
      "Siswa internal · Kelas 6C · SD",
    );
  });
});

describe("kelasAktifNama", () => {
  it("mengambil nama kelas yang sedang aktif, mengabaikan kelas historis", () => {
    expect(
      kelasAktifNama([
        { kelas_id: "a", aktif: false, kelas: { id: "a", nama: "5C", departemen_id: "sd" } },
        { kelas_id: "b", aktif: true, kelas: { id: "b", nama: "6C", departemen_id: "sd" } },
      ]),
    ).toBe("6C");
  });

  it("mengembalikan null bila tidak ada kelas aktif", () => {
    expect(kelasAktifNama([])).toBeNull();
    expect(
      kelasAktifNama([{ kelas_id: "a", aktif: false, kelas: { id: "a", nama: "5C", departemen_id: "sd" } }]),
    ).toBeNull();
  });
});
