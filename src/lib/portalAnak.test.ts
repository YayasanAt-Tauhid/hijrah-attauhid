import { describe, expect, it } from "vitest";
import { inisialNama, labelHubungan, labelKelas } from "./portalAnak";

describe("inisialNama", () => {
  it("memakai huruf pertama dua kata awal dalam huruf besar", () => {
    expect(inisialNama("ahmad fauzi")).toBe("AF");
    expect(inisialNama("Siti Aisyah Nurul Khoirunnisa")).toBe("SA");
  });

  it("tahan terhadap spasi berlebih dan nama satu kata", () => {
    expect(inisialNama("  Budi   Santoso ")).toBe("BS");
    expect(inisialNama("Budi")).toBe("B");
    expect(inisialNama("")).toBe("");
  });
});

describe("labelKelas", () => {
  it("menambahkan kata Kelas bila data hanya berisi nama kelas", () => {
    expect(labelKelas("4A")).toBe("Kelas 4A");
    expect(labelKelas("9C")).toBe("Kelas 9C");
  });

  it("tidak menggandakan kata Kelas bila sudah ada", () => {
    expect(labelKelas("Kelas 4A")).toBe("Kelas 4A");
    expect(labelKelas("kelas B")).toBe("kelas B");
  });

  it("kosong bila tidak ada data kelas", () => {
    expect(labelKelas("")).toBe("");
    expect(labelKelas("   ")).toBe("");
    expect(labelKelas(null)).toBe("");
    expect(labelKelas(undefined)).toBe("");
  });
});

describe("labelHubungan", () => {
  it("menulis hubungan dengan huruf awal besar dan menerjemahkan nilai generik ortu", () => {
    expect(labelHubungan("ayah")).toBe("Ayah");
    expect(labelHubungan("IBU")).toBe("Ibu");
    expect(labelHubungan("wali")).toBe("Wali");
    expect(labelHubungan("ortu")).toBe("Orang tua");
  });

  it("kosong bila tidak diisi", () => {
    expect(labelHubungan("")).toBe("");
    expect(labelHubungan(null)).toBe("");
    expect(labelHubungan(undefined)).toBe("");
  });
});
