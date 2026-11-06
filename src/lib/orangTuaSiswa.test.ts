import { describe, expect, it } from "vitest";
import { formatOrangTua, pilihTeleponOrangTua, ringkasOrangTua } from "./orangTuaSiswa";

describe("pilihTeleponOrangTua", () => {
  it("memakai urutan HP ortu, HP ayah, HP ibu, lalu HP siswa", () => {
    expect(pilihTeleponOrangTua({ telepon_ortu: "081100000001", telepon_ayah: "081200000002", telepon_ibu: "081300000003" }, "081400000004")).toBe("081100000001");
    expect(pilihTeleponOrangTua({ telepon_ortu: "", telepon_ayah: "081234567890", telepon_ibu: "081300000003" }, "081400000004")).toBe("081234567890");
    expect(pilihTeleponOrangTua({ telepon_ortu: null, telepon_ayah: null, telepon_ibu: "081355566677" }, "081400000004")).toBe("081355566677");
    expect(pilihTeleponOrangTua({}, "081455566677")).toBe("081455566677");
  });

  it("mengabaikan isian kosong atau tidak bermakna dan merapikan spasi", () => {
    expect(pilihTeleponOrangTua({ telepon_ortu: " - ", telepon_ayah: "0", telepon_ibu: "  0812 3456 7890  " }, null)).toBe("0812 3456 7890");
    expect(pilihTeleponOrangTua({ telepon_ortu: "12", telepon_ayah: "abc" }, "")).toBeNull();
    expect(pilihTeleponOrangTua(null, undefined)).toBeNull();
  });
});

describe("ringkasOrangTua", () => {
  it("mengembalikan nama ayah, nama ibu, dan satu nomor HP tanpa membocorkan kolom lain", () => {
    const result = ringkasOrangTua(
      { nama_ayah: " Budi ", nama_ibu: "Siti", telepon_ayah: "081234567890", nik_ayah: "123", alamat_ortu: "x" } as never,
      null,
    );
    expect(result).toEqual({ ayah: "Budi", ibu: "Siti", telepon: "081234567890" });
  });

  it("menganggap nama kosong atau tanda strip sebagai belum diisi", () => {
    expect(ringkasOrangTua({ nama_ayah: "-", nama_ibu: "  " }, null)).toEqual({ ayah: null, ibu: null, telepon: null });
    expect(ringkasOrangTua(null, null)).toEqual({ ayah: null, ibu: null, telepon: null });
  });
});

describe("formatOrangTua", () => {
  it("menampilkan ayah, ibu, dan HP", () => {
    expect(formatOrangTua({ ayah: "Budi", ibu: "Siti", telepon: "081234567890" })).toBe("Ayah: Budi · Ibu: Siti · HP: 081234567890");
  });

  it("menandai HP yang belum diisi agar kasir tahu harus melengkapinya", () => {
    expect(formatOrangTua({ ayah: "Budi", ibu: null, telepon: null })).toBe("Ayah: Budi · HP belum diisi");
  });

  it("tetap informatif bila nama orang tua kosong", () => {
    expect(formatOrangTua({ ayah: null, ibu: null, telepon: "081234567890" })).toBe("Orang tua belum diisi · HP: 081234567890");
    expect(formatOrangTua({ ayah: null, ibu: null, telepon: null })).toBe("Orang tua belum diisi · HP belum diisi");
    expect(formatOrangTua(null)).toBe("Orang tua belum diisi · HP belum diisi");
  });
});
