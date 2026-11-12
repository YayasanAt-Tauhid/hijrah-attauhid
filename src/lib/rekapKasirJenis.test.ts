import { describe, expect, it } from "vitest";
import { filterByLembaga, hitungStatistikRekap } from "./rekapKasirLembaga";
import {
  SEMUA_JENIS,
  filterByJenis,
  labelJenisFilter,
  listJenis,
  resolveJenisFilter,
} from "./rekapKasirJenis";

type Row = Parameters<typeof listJenis>[0][number];

const row = (overrides: Partial<Row>): Row => ({
  id: "p",
  jumlah: 100000,
  siswa_status: "aktif",
  departemen_nama: "SMP",
  departemen_kode: "SMP",
  jenis_nama: "SPP SMP",
  ...overrides,
});

const rows: Row[] = [
  row({ id: "1", jumlah: 450000 }),
  row({ id: "2", jumlah: 330000, jenis_nama: "UANG SERAGAM OLAHRAGA SMP" }),
  row({ id: "3", jumlah: 350000, departemen_nama: "Sekolah Dasar", departemen_kode: "SD", jenis_nama: "SPP SD" }),
  row({ id: "4", jumlah: 200000, departemen_nama: "Sekolah Dasar", departemen_kode: "SD", jenis_nama: "Formulir SPMB", siswa_status: "calon" }),
  row({ id: "5", jumlah: 50000, departemen_nama: "Pesantren", departemen_kode: null, jenis_nama: "SPP Pesantren" }),
  row({ id: "6", jumlah: 450000 }),
];

describe("listJenis", () => {
  it("mengumpulkan jenis unik, terurut, dengan jumlah transaksi", () => {
    expect(listJenis(rows)).toEqual([
      { key: "Formulir SPMB", label: "Formulir SPMB", count: 1 },
      { key: "SPP Pesantren", label: "SPP Pesantren", count: 1 },
      { key: "SPP SD", label: "SPP SD", count: 1 },
      { key: "SPP SMP", label: "SPP SMP", count: 2 },
      { key: "UANG SERAGAM OLAHRAGA SMP", label: "UANG SERAGAM OLAHRAGA SMP", count: 1 },
    ]);
  });

  it("hanya memuat jenis di lembaga terpilih bila diberi baris yang sudah difilter lembaga", () => {
    expect(listJenis(filterByLembaga(rows, "SD")).map((o) => o.key)).toEqual(["Formulir SPMB", "SPP SD"]);
  });

  it("kosong bila tidak ada transaksi", () => {
    expect(listJenis([])).toEqual([]);
  });
});

describe("filterByJenis", () => {
  it("Semua Jenis mengembalikan semua baris", () => {
    expect(filterByJenis(rows, SEMUA_JENIS)).toHaveLength(6);
  });

  it("menyaring per jenis pembayaran", () => {
    expect(filterByJenis(rows, "SPP SMP").map((r) => r.id)).toEqual(["1", "6"]);
  });

  it("jenis yang tidak ada menghasilkan daftar kosong", () => {
    expect(filterByJenis(rows, "SPP SMA")).toEqual([]);
  });
});

describe("resolveJenisFilter", () => {
  it("mempertahankan pilihan yang masih ada di data", () => {
    expect(resolveJenisFilter(rows, "SPP SD")).toBe("SPP SD");
  });

  it("kembali ke Semua Jenis bila pilihan tidak ada di lembaga terpilih", () => {
    expect(resolveJenisFilter(filterByLembaga(rows, "SD"), "SPP SMP")).toBe(SEMUA_JENIS);
  });

  it("tetap Semua Jenis bila dipilih demikian", () => {
    expect(resolveJenisFilter(rows, SEMUA_JENIS)).toBe(SEMUA_JENIS);
  });
});

describe("labelJenisFilter", () => {
  it("null untuk Semua Jenis", () => {
    expect(labelJenisFilter(rows, SEMUA_JENIS)).toBeNull();
  });

  it("nama jenis untuk pilihan yang ada", () => {
    expect(labelJenisFilter(rows, "Formulir SPMB")).toBe("Formulir SPMB");
  });
});

describe("kombinasi filter lembaga dan jenis", () => {
  it("statistik dihitung dari baris yang lolos kedua filter", () => {
    const hasil = filterByJenis(filterByLembaga(rows, "SD"), "Formulir SPMB");
    expect(hitungStatistikRekap(hasil)).toEqual({
      jumlah_transaksi: 1,
      total_penerimaan: 200000,
      transaksi_spmb: 1,
      transaksi_siswa: 0,
    });
  });
});
