import { describe, expect, it } from "vitest";
import { sppCategory, sppReceiptGroups } from "./sppCategory";

describe("laporan kategori SPP", () => {
  it("mempertahankan kategori transaksi dan tidak menebak histori SMP/SMA/MTA", () => {
    expect(sppCategory("asrama", "SPP SMP", "SMP")).toBe("asrama");
    expect(sppCategory(null, "SPP SMA", "SMA")).toBe("belum_terverifikasi");
    expect(sppCategory(null, "SPP MTA", "MTA")).toBe("belum_terverifikasi");
    expect(sppCategory("toString", "SPP SMP", "SMP")).toBe("belum_terverifikasi");
    expect(sppCategory(null, "SPP SD", "SD")).toBe("umum");
    expect(sppCategory(null, "UANG PANGKAL SMP", "SMP")).toBeNull();
  });

  it("memisahkan lembaga dan kategori tanpa kehilangan nilai cicilan atau uang muka", () => {
    const rows = [
      { jumlah: 100000, spp_kategori: "asrama", jenis_pembayaran: { nama: "SPP SMP" }, departemen: { kode: "SMP" } },
      { jumlah: 200000, spp_kategori: "asrama", jenis_pembayaran: { nama: "SPP SMP" }, departemen: { kode: "SMP" } },
      { jumlah: 400000, spp_kategori: "non_asrama", jenis_pembayaran: { nama: "SPP SMP" }, departemen: { kode: "SMP" } },
      { jumlah: "500000", spp_kategori: "asrama", jenis_pembayaran: { nama: "SPP SMA" }, departemen: { kode: "SMA" } },
      { jumlah: 600000, jenis_pembayaran: { nama: "SALDO SPP HISTORIS MTA" }, departemen: { kode: "MTA" } },
      { jumlah: 700000, jenis_pembayaran: { nama: "UANG PANGKAL SMP" }, departemen: { kode: "SMP" } },
    ];
    const grouped = sppReceiptGroups(rows);
    expect(grouped.reduce((sum, group) => sum + group.jumlah, 0)).toBe(1800000);
    expect(grouped.find(group => group.lembaga === "SMP" && group.kategori === "asrama")).toMatchObject({ jumlah: 300000, transaksi: 2 });
    expect(grouped.find(group => group.lembaga === "MTA")).toMatchObject({ kategori: "belum_terverifikasi", jumlah: 600000 });
  });
});
