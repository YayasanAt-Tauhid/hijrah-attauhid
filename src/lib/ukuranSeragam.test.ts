import { describe, expect, it } from "vitest";
import { emptyUniformSizes, readUniformSizes, uniformDepartment, uniformOptions, validateUniformSizes } from "./ukuranSeragam";

describe("katalog dan ukuran seragam", () => {
  it("mengikuti katalog berdasarkan lembaga dan putra/putri tanpa menebak TK/MTA putri", () => {
    expect(uniformOptions("TK", "L")).toEqual({});
    expect(uniformOptions("MTA", "P")).toEqual({});
    expect(uniformOptions("SMP", "L").PRAMUKA).toEqual(["S", "M", "L", "XL", "XXL", "3XL", "4XL"]);
    expect(uniformOptions("SD", "P")["SATUAN BAJU"]).not.toContain("4XL");
    expect(uniformOptions("SD", "P")["JILBAB + LOGO SEKOLAH"]).toEqual(["STANDART", "JUMBO"]);
    expect(uniformDepartment({ nama: "SMP At-Tauhid" })).toBe("SMP");
  });
  it("memuat ulang empat ukuran secara terpisah dan menerima stel belum diisi", () => {
    const sizes = [{ jenis: "PRAMUKA", ukuran: "S" }, { jenis: "PUTIH BIRU", ukuran: "M" }, { jenis: "PRAMUKA", ukuran: "L" }, { jenis: "PUTIH BIRU", ukuran: "XL" }];
    expect(readUniformSizes(JSON.parse(JSON.stringify(sizes)))).toEqual(sizes);
    expect(validateUniformSizes(sizes, uniformOptions("SMP", "L"))).toBeNull();
    expect(readUniformSizes(null)).toEqual(emptyUniformSizes());
    expect(validateUniformSizes(emptyUniformSizes(), {})).toBeNull();
  });
  it("menolak isian sebagian dan ukuran yang salah untuk jenisnya", () => {
    expect(validateUniformSizes([{ jenis: "PRAMUKA", ukuran: "" }], uniformOptions("SMP", "L"))).toContain("Lengkapi");
    expect(validateUniformSizes([{ jenis: "PRAMUKA", ukuran: "ALL SIZE" }], uniformOptions("SMP", "L"))).toContain("tidak sesuai");
    expect(validateUniformSizes([{ jenis: "PRAMUKA", ukuran: "S" }], {})).toContain("tidak sesuai");
  });
});
