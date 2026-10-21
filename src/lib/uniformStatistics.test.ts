import { describe, expect, it } from "vitest";
import { summarizeUniforms } from "./uniformStatistics";
const departments = [{ id: "sd", nama: "SD", kode: "SD" }, { id: "smp", nama: "SMP", kode: "SMP" }, { id: "tk", nama: "TK", kode: "TK" }];
const make = (dep: string, gender: string, sizes: unknown) => ({ departemen_id: dep, jenis_kelamin: gender, _spmbDetail: { ukuran_seragam: sizes } });
describe("rekap seragam SPMB", () => {
  it("menghitung pendaftar lengkap dan stel terpisah; tidak menganggap ukuran kosong sudah dipesan", () => {
    const rows = [
      make("sd", "L", [{ jenis: "Olah raga", ukuran: "S" }, { jenis: "Putih Merah", ukuran: "M" }, { jenis: "Coklat", ukuran: "L" }, { jenis: "Gamis Biru", ukuran: "XL" }]),
      make("smp", "P", [{ jenis: "Olah raga", ukuran: "M" }, { jenis: "Putih Biru Khusus", ukuran: "XL" }, { jenis: "Coklat", ukuran: "" }, { jenis: "Gamis Ungu", ukuran: "" }]),
      make("sd", "L", null),
    ];
    const result = summarizeUniforms(rows, departments);
    expect(result).toMatchObject({ eligible: 3, complete: 1, incomplete: 2, recorded: 6, missing: 6 });
    expect(result.rekap.reduce((sum, row) => sum + row.jumlah, 0)).toBe(12);
    expect(result.rekap.find((row) => row.jenis === "Putih Biru Khusus")).toMatchObject({ ukuran: "XL", jumlah: 1 });
    expect(result.rekap.find((row) => row.jenis === "Gamis Ungu")).toMatchObject({ ukuran: "Belum diisi", jumlah: 1 });
  });
  it("mengabaikan TK dalam kebutuhan empat stel dan tidak menggandakan ukuran_baju lama", () => {
    const result = summarizeUniforms([
      make("tk", "L", null),
      { ...make("sd", "L", null), _spmbDetail: { ukuran_baju: "XL" } },
    ], departments);
    expect(result).toMatchObject({ eligible: 1, unavailable: 1, complete: 0, recorded: 0, missing: 4 });
    expect(result.rekap.every((row) => row.ukuran === "Belum diisi")).toBe(true);
  });
  it("mengelompokkan ejaan huruf/spasi tanpa menyatukan jenis, lembaga, dan jenis kelamin yang berbeda", () => {
    const result = summarizeUniforms([
      make("sd", "L", [{ jenis: " Olah   raga ", ukuran: "x3l" }, { jenis: "olah raga", ukuran: "3XL" }]),
      make("sd", "P", [{ jenis: "Olah raga", ukuran: "3XL" }]),
      make("smp", "L", [{ jenis: "Olah raga", ukuran: "3XL" }]),
    ], departments);
    expect(result.rekap.find((row) => row.lembaga === "SD" && row.jenisKelamin === "Ikhwan" && row.ukuran === "3XL")).toMatchObject({ jumlah: 2 });
    expect(result.rekap.filter((row) => row.ukuran === "3XL")).toHaveLength(3);
    expect(result.recorded).toBe(4);
  });
  it("mempertahankan ukuran khusus dan menangani data kosong/tidak valid", () => {
    const result = summarizeUniforms([
      make("sd", "P", [{ jenis: "Khimar Khusus", ukuran: "jumbo" }]),
      make("sd", "L", "invalid"),
      make("sd", "L", [{ jenis: "", ukuran: "XL" }]),
    ], departments);
    expect(result.recorded).toBe(1);
    expect(result.rekap.find((row) => row.jenis === "Khimar Khusus")).toMatchObject({ ukuran: "JUMBO" });
    expect(summarizeUniforms([], departments)).toMatchObject({ eligible: 0, complete: 0, incomplete: 0, recorded: 0, missing: 0, rekap: [] });
  });
  it("memakai lembaga tujuan dan hanya menghitung baris dalam scope yang diterima", () => {
    const result = summarizeUniforms([{ ...make("smp", "P", null), _academicDepartemenId: "sd" }], departments);
    expect(result.rekap.every((row) => row.lembaga === "SMP")).toBe(true);
    expect(result.rekap.some((row) => row.jenis === "Gamis Ungu")).toBe(true);
    expect(result.rekap.some((row) => row.jenis === "Putih Merah")).toBe(false);
  });
});
