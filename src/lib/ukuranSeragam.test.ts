import { describe, expect, it } from "vitest";
import { emptyUniformSizes, readUniformSizes, defaultUniformSizes, uniformDepartment, validateUniformSizes } from "./ukuranSeragam";

describe("empat jenis seragam", () => {
  it.each([
    ["SD", "L", ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]],
    ["SD", "P", ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]],
    ["SMP", "L", ["Olah raga", "Putih Biru", "Coklat", "Gamis Biru"]],
    ["SMP", "P", ["Olah raga", "Putih Biru", "Coklat", "Gamis Ungu"]],
    ["SMA", "L", ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"]],
    ["SMA", "P", ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"]],
  ])("memakai empat nama untuk %s %s", (dept, gender, names) => {
    expect(defaultUniformSizes(null, String(dept), String(gender)).map((item) => item.jenis)).toEqual(names);
  });
  it("mempertahankan nama editan, ukuran tersimpan, dan data versi lama", () => {
    const sizes = [{ jenis: "Gamis Pesanan", ukuran: "XL" }, { jenis: "PRAMUKA", ukuran: "M" }, { jenis: "Coklat", ukuran: "L" }, { jenis: "Gamis Biru", ukuran: "" }];
    expect(defaultUniformSizes(sizes, "SD", "L")).toEqual(sizes);
    expect(readUniformSizes(JSON.parse(JSON.stringify(sizes)))).toEqual(sizes);
    expect(validateUniformSizes(sizes)).toBeNull();
    expect(readUniformSizes(null)).toEqual(emptyUniformSizes());
  });
  it("menerima nama saja, menolak ukuran tanpa nama dan nama terlalu panjang", () => {
    expect(validateUniformSizes([{ jenis: "Seragam Khusus", ukuran: "" }])).toBeNull();
    expect(validateUniformSizes([{ jenis: "", ukuran: "S" }])).toContain("Isi nama");
    expect(validateUniformSizes([{ jenis: " ".repeat(2), ukuran: "S" }])).toContain("Isi nama");
    expect(validateUniformSizes([{ jenis: "x".repeat(81), ukuran: "" }])).toContain("80 karakter");
    expect(defaultUniformSizes(null, "TK", "L")).toEqual(emptyUniformSizes());
    expect(uniformDepartment({ nama: "SMP At-Tauhid" })).toBe("SMP");
  });
});
