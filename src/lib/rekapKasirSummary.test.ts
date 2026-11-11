import { describe, expect, it } from "vitest";
import {
  kelasLabel,
  periodeLabel,
  summarizeRekapKasir,
  tanggalPanjang,
  tanggalPendek,
  type RekapKasirItem,
} from "./rekapKasirSummary";

const item = (overrides: Partial<RekapKasirItem>): RekapKasirItem => ({
  id: "p",
  jumlah: 450000,
  tanggal_bayar: "2026-11-11",
  bulan: null,
  keterangan: null,
  siswa_nama: "Nailah",
  siswa_nis: null,
  siswa_nisn: null,
  siswa_status: "aktif",
  kelas_nama: "8C",
  jenis_nama: "SPP SMP",
  departemen_nama: "SMP",
  departemen_kode: "SMP",
  jurnal_nomor: null,
  receipt_number: "KWT-1",
  payment_method: "Tunai",
  periode_label: null,
  ...overrides,
});

const items: RekapKasirItem[] = [
  item({ id: "late", tanggal_bayar: "2026-11-12", departemen_nama: "SD", jenis_nama: "SPP SD", jumlah: 350000, payment_method: "bank_transfer", receipt_number: "KWT-3" }),
  item({ id: "a", receipt_number: "KWT-2" }),
  item({ id: "b", receipt_number: "KWT-1", jenis_nama: "UANG SERAGAM OLAHRAGA SMP", jumlah: 330000 }),
  item({ id: "c", tanggal_bayar: "2026-11-12", departemen_nama: "SD", jenis_nama: "Formulir SPMB", jumlah: 200000, payment_method: null, receipt_number: null }),
];

describe("summarizeRekapKasir", () => {
  const summary = summarizeRekapKasir(items);

  it("sorts transactions by date then receipt number (no receipt last)", () => {
    expect(summary.items.map((i) => i.id)).toEqual(["b", "a", "late", "c"]);
  });

  it("groups by lembaga then jenis with subtotals", () => {
    expect(summary.lembaga).toEqual([
      { nama: "SD", count: 2, total: 550000, jenis: [
        { nama: "Formulir SPMB", count: 1, total: 200000 },
        { nama: "SPP SD", count: 1, total: 350000 },
      ] },
      { nama: "SMP", count: 2, total: 780000, jenis: [
        { nama: "SPP SMP", count: 1, total: 450000 },
        { nama: "UANG SERAGAM OLAHRAGA SMP", count: 1, total: 330000 },
      ] },
    ]);
  });

  it("groups by payment method with Tidak tercatat last", () => {
    expect(summary.methods).toEqual(["Tunai", "Transfer", "Tidak tercatat"]);
    expect(summary.perMetode).toEqual([
      { metode: "Tunai", count: 2, total: 780000 },
      { metode: "Transfer", count: 1, total: 350000 },
      { metode: "Tidak tercatat", count: 1, total: 200000 },
    ]);
  });

  it("groups by date with one column per method", () => {
    expect(summary.perTanggal).toEqual([
      { tanggal: "2026-11-11", count: 2, perMetode: [780000, 0, 0], total: 780000 },
      { tanggal: "2026-11-12", count: 2, perMetode: [0, 350000, 200000], total: 550000 },
    ]);
  });

  it("totals everything", () => {
    expect(summary.count).toBe(4);
    expect(summary.total).toBe(1330000);
  });

  it("handles an empty period", () => {
    expect(summarizeRekapKasir([])).toMatchObject({ count: 0, total: 0, lembaga: [], methods: [], perTanggal: [] });
  });
});

describe("label helpers", () => {
  it("formats dates and periods", () => {
    expect(tanggalPendek("2026-11-05")).toBe("05/11/2026");
    expect(tanggalPendek(null)).toBe("-");
    expect(tanggalPanjang("2026-11-05")).toBe("5 November 2026");
    expect(periodeLabel(item({ periode_label: " Oktober 2026 " }))).toBe("Oktober 2026");
    expect(periodeLabel(item({ bulan: 3 }))).toBe("Maret 2026");
    expect(periodeLabel(item({}))).toBe("-");
    expect(kelasLabel(item({ siswa_status: "calon" }))).toBe("Calon Murid");
    expect(kelasLabel(item({ kelas_nama: null }))).toBe("-");
  });
});
