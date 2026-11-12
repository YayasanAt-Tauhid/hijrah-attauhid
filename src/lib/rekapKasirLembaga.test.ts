import { describe, expect, it } from "vitest";
import {
  SEMUA_LEMBAGA,
  filterByLembaga,
  hitungStatistikRekap,
  labelLembagaFilter,
  listLembaga,
  resolveLembagaFilter,
} from "./rekapKasirLembaga";

type Row = Parameters<typeof hitungStatistikRekap>[0][number];

const row = (overrides: Partial<Row>): Row => ({
  id: "p",
  jumlah: 100000,
  siswa_status: "aktif",
  departemen_nama: "SMP",
  departemen_kode: "SMP",
  ...overrides,
});

const rows: Row[] = [
  row({ id: "1", jumlah: 450000 }),
  row({ id: "2", jumlah: 330000 }),
  row({ id: "3", jumlah: 350000, departemen_nama: "Sekolah Dasar", departemen_kode: "SD" }),
  row({ id: "4", jumlah: 200000, departemen_nama: "Sekolah Dasar", departemen_kode: "SD", siswa_status: "calon" }),
  row({ id: "5", jumlah: 50000, departemen_nama: "Pesantren", departemen_kode: null }),
];

describe("listLembaga", () => {
  it("mengumpulkan lembaga unik, terurut, dengan jumlah transaksi", () => {
    expect(listLembaga(rows)).toEqual([
      { key: "Pesantren", label: "Pesantren", count: 1 },
      { key: "SD", label: "SD — Sekolah Dasar", count: 2 },
      { key: "SMP", label: "SMP — SMP", count: 2 },
    ]);
  });

  it("kosong bila tidak ada transaksi", () => {
    expect(listLembaga([])).toEqual([]);
  });
});

describe("filterByLembaga", () => {
  it("Semua Lembaga mengembalikan semua baris", () => {
    expect(filterByLembaga(rows, SEMUA_LEMBAGA)).toHaveLength(5);
  });

  it("menyaring per lembaga berdasarkan kode", () => {
    expect(filterByLembaga(rows, "SD").map((r) => r.id)).toEqual(["3", "4"]);
  });

  it("memakai nama bila lembaga tidak punya kode", () => {
    expect(filterByLembaga(rows, "Pesantren").map((r) => r.id)).toEqual(["5"]);
  });

  it("lembaga yang tidak ada menghasilkan daftar kosong", () => {
    expect(filterByLembaga(rows, "SMA")).toEqual([]);
  });
});

describe("hitungStatistikRekap", () => {
  it("menghitung total, jumlah, siswa, dan SPMB dari baris yang diberikan", () => {
    expect(hitungStatistikRekap(filterByLembaga(rows, "SD"))).toEqual({
      jumlah_transaksi: 2,
      total_penerimaan: 550000,
      transaksi_spmb: 1,
      transaksi_siswa: 1,
    });
  });

  it("nol bila kosong", () => {
    expect(hitungStatistikRekap([])).toEqual({
      jumlah_transaksi: 0,
      total_penerimaan: 0,
      transaksi_spmb: 0,
      transaksi_siswa: 0,
    });
  });
});

describe("labelLembagaFilter", () => {
  it("null untuk Semua Lembaga", () => {
    expect(labelLembagaFilter(rows, SEMUA_LEMBAGA)).toBeNull();
  });

  it("label lengkap untuk lembaga terpilih", () => {
    expect(labelLembagaFilter(rows, "SD")).toBe("SD — Sekolah Dasar");
  });
});

describe("resolveLembagaFilter", () => {
  it("mempertahankan pilihan yang masih ada di data", () => {
    expect(resolveLembagaFilter(rows, "SD")).toBe("SD");
  });

  it("kembali ke Semua Lembaga bila pilihan tidak ada lagi (mis. tanggal diganti)", () => {
    expect(resolveLembagaFilter(rows, "SMA")).toBe(SEMUA_LEMBAGA);
  });

  it("tetap Semua Lembaga bila dipilih demikian", () => {
    expect(resolveLembagaFilter(rows, SEMUA_LEMBAGA)).toBe(SEMUA_LEMBAGA);
  });
});
