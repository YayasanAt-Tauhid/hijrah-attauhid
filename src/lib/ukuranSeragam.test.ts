import { describe, expect, it } from "vitest";
import { emptyUniformSizes, readUniformSizes, defaultUniformSizes, uniformDepartment, validateUniformSizes, UNIFORM_SLOT_COUNT } from "./ukuranSeragam";

describe("lima stel seragam", () => {
  it.each([
    ["SD", "L", ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]],
    ["SD", "P", ["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]],
    ["SMP", "L", ["Olah raga", "Putih Biru", "Coklat", "Gamis Biru"]],
    ["SMP", "P", ["Olah raga", "Putih Biru", "Coklat", "Gamis Ungu"]],
    ["SMA", "L", ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"]],
    ["SMA", "P", ["Olah raga", "Putih Abu-Abu", "Coklat", "Lainnya"]],
  ])("memakai empat nama bawaan dan stel kelima kosong untuk %s %s", (dept, gender, names) => {
    expect(defaultUniformSizes(null, String(dept), String(gender)).map((item) => item.jenis)).toEqual([...names, ""]);
  });
  it("mempertahankan nama editan, ukuran tersimpan, dan data versi lama", () => {
    const sizes = [{ jenis: "Gamis Pesanan", ukuran: "XL" }, { jenis: "PRAMUKA", ukuran: "M" }, { jenis: "Coklat", ukuran: "L" }, { jenis: "Gamis Biru", ukuran: "" }];
    const lima = [...sizes, { jenis: "", ukuran: "" }];
    expect(defaultUniformSizes(sizes, "SD", "L")).toEqual(lima);
    expect(readUniformSizes(JSON.parse(JSON.stringify(sizes)))).toEqual(lima);
    expect(validateUniformSizes(lima)).toBeNull();
    expect(readUniformSizes(null)).toEqual(emptyUniformSizes());
  });
  it("menyediakan lima slot: data lama empat stel dilengkapi slot kosong, data lebih dari lima dipotong", () => {
    expect(UNIFORM_SLOT_COUNT).toBe(5);
    expect(emptyUniformSizes()).toHaveLength(5);
    expect(readUniformSizes([{ jenis: "Pramuka", ukuran: "M" }, { jenis: "A", ukuran: "S" }, { jenis: "B", ukuran: "S" }, { jenis: "C", ukuran: "S" }, { jenis: "Batik", ukuran: "L" }, { jenis: "Lebih", ukuran: "S" }])[4]).toEqual({ jenis: "Batik", ukuran: "L" });
    expect(readUniformSizes([{ jenis: "A", ukuran: "S" }])).toHaveLength(5);
    expect(readUniformSizes(new Array(7).fill({ jenis: "A", ukuran: "S" }))).toHaveLength(5);
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
