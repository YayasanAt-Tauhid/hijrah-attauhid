import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildRekapKasirWorkbook,
  normalizePaymentMethod,
  parseRekapKasirRange,
  rekapKasirFilename,
  type RekapKasirExcelItem,
} from "./rekapKasirExcel";

const item = (overrides: Partial<RekapKasirExcelItem>): RekapKasirExcelItem => ({
  id: "p",
  jumlah: 450000,
  tanggal_bayar: "2026-11-11",
  bulan: null,
  keterangan: null,
  siswa_nama: "Nailah Rasiyah Fauzi",
  siswa_nis: "2570012126075",
  siswa_nisn: "0125455470",
  siswa_status: "aktif",
  kelas_nama: "8C",
  jenis_nama: "SPP SMP",
  departemen_nama: "SMP",
  departemen_kode: "SMP",
  jurnal_nomor: "JU-2026-11-0001",
  receipt_number: "KWT-2026-11-0439",
  payment_method: "Tunai",
  periode_label: null,
  ...overrides,
});

const items: RekapKasirExcelItem[] = [
  item({ id: "a", bulan: 10, periode_label: "Oktober 2026" }),
  item({ id: "b", bulan: 11, periode_label: "November 2026" }),
  item({ id: "c", jenis_nama: "UANG SERAGAM OLAHRAGA SMP", jumlah: 330000 }),
  item({
    id: "d", tanggal_bayar: "2026-11-12", siswa_nama: "Ahmad", departemen_nama: "SD", departemen_kode: "SD",
    jenis_nama: "SPP SD", jumlah: 350000, payment_method: "bank_transfer", receipt_number: "KWT-2026-11-0440",
    keterangan: "=HYPERLINK(\"x\")",
  }),
  item({ id: "e", tanggal_bayar: "2026-11-12", siswa_nama: "Calon", siswa_status: "calon", kelas_nama: null,
    departemen_nama: "SD", departemen_kode: "SD", jenis_nama: "Formulir SPMB", jumlah: 200000,
    payment_method: null, receipt_number: null, jurnal_nomor: null, bulan: 3 }),
];

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true, defval: "" });
  // sheet_to_json mengisi sel kosong sampai lebar sheet; buang ekor kosong agar mudah dibandingkan.
  return rows.map((row) => {
    const copy = [...row];
    while (copy.length && copy[copy.length - 1] === "") copy.pop();
    return copy;
  });
}

function findRow(rows: unknown[][], first: string) {
  return rows.find((row) => row.some((cell) => cell === first));
}

const build = () =>
  buildRekapKasirWorkbook({
    petugasNama: "Fitri Yanto, S.Si",
    dari: "2026-11-11",
    sampai: "2026-11-12",
    dicetakPada: new Date("2026-11-12T10:15:00+07:00"),
    items,
  });

describe("parseRekapKasirRange", () => {
  it("keeps single-date requests working", () => {
    expect(parseRekapKasirRange({ tanggal: "2026-11-11" })).toEqual({ dari: "2026-11-11", sampai: "2026-11-11" });
  });

  it("accepts a range up to 31 days inclusive", () => {
    expect(parseRekapKasirRange({ tanggal_dari: "2026-11-01", tanggal_sampai: "2026-12-01" }))
      .toEqual({ dari: "2026-11-01", sampai: "2026-12-01" });
  });

  it("rejects invalid, reversed or too-long ranges", () => {
    expect(() => parseRekapKasirRange({ tanggal_dari: "2026-11-1", tanggal_sampai: "2026-11-02" })).toThrow(/tidak valid/);
    expect(() => parseRekapKasirRange({ tanggal_dari: "2026-02-30", tanggal_sampai: "2026-03-02" })).toThrow(/tidak valid/);
    expect(() => parseRekapKasirRange({ tanggal_dari: "2026-11-12", tanggal_sampai: "2026-11-11" })).toThrow(/sebelum/);
    expect(() => parseRekapKasirRange({ tanggal_dari: "2026-11-01", tanggal_sampai: "2026-12-02" })).toThrow(/31 hari/);
  });
});

describe("normalizePaymentMethod", () => {
  it("groups stored payment method spellings", () => {
    expect(normalizePaymentMethod("Tunai")).toBe("Tunai");
    expect(normalizePaymentMethod("tunai")).toBe("Tunai");
    expect(normalizePaymentMethod("bank_transfer")).toBe("Transfer");
    expect(normalizePaymentMethod("transfer")).toBe("Transfer");
    expect(normalizePaymentMethod("midtrans")).toBe("Online (Midtrans)");
    expect(normalizePaymentMethod(null)).toBe("Tidak tercatat");
    expect(normalizePaymentMethod("  ")).toBe("Tidak tercatat");
  });
});

describe("buildRekapKasirWorkbook", () => {
  it("creates Rekapitulasi and Rincian sheets", () => {
    expect(build().SheetNames).toEqual(["Rekapitulasi", "Rincian"]);
  });

  it("lists every transaction in Rincian with numeric amounts and a total row", () => {
    const wb = build();
    const rows = sheetRows(wb, "Rincian");
    const headerIndex = rows.findIndex((row) => row[0] === "No");
    expect(rows[headerIndex]).toEqual([
      "No", "Tanggal", "No. Kwitansi", "Nama", "NIS / NISN", "Kelas", "Lembaga",
      "Jenis Pembayaran", "Periode", "Metode", "Jumlah (Rp)", "No. Jurnal", "Keterangan",
    ]);
    const body = rows.slice(headerIndex + 1, headerIndex + 1 + items.length);
    expect(body.map((row) => row[10])).toEqual([450000, 450000, 330000, 350000, 200000]);
    expect(body[0]).toEqual(expect.arrayContaining(["11/11/2026", "KWT-2026-11-0439", "Oktober 2026", "Tunai"]));
    // Periode jatuh ke nama bulan bila kwitansi tidak menyimpan label periode.
    expect(body[4][8]).toBe("Maret 2026");
    expect(body[4][5]).toBe("Calon Murid");
    expect(body[4][2]).toBe("-");
    expect(body[3][9]).toBe("Transfer");
    // Anti formula-injection di teks bebas.
    expect(body[3][12]).toBe("'=HYPERLINK(\"x\")");
    const total = findRow(rows, "TOTAL");
    expect(total?.[10]).toBe(1780000);

    const sheet = wb.Sheets.Rincian;
    const amountCell = sheet[XLSX.utils.encode_cell({ r: headerIndex + 1, c: 10 })];
    expect(amountCell.t).toBe("n");
    expect(amountCell.z).toBe("#,##0");
  });

  it("summarises by lembaga and jenis, by payment method and by date", () => {
    const rows = sheetRows(build(), "Rekapitulasi");
    const flat = rows.map((row) => row.join("|"));
    expect(flat).toContain("Petugas : Fitri Yanto, S.Si");
    expect(flat).toContain("Periode : 11 November 2026 s.d. 12 November 2026");

    // Per lembaga dan jenis (urut lembaga, lalu jenis)
    expect(findRow(rows, "SPP SMP")).toEqual(expect.arrayContaining(["SMP", "SPP SMP", 2, 900000]));
    expect(findRow(rows, "UANG SERAGAM OLAHRAGA SMP")).toEqual(expect.arrayContaining([1, 330000]));
    expect(findRow(rows, "Subtotal SMP")).toEqual(expect.arrayContaining([3, 1230000]));
    expect(findRow(rows, "Subtotal SD")).toEqual(expect.arrayContaining([2, 550000]));

    // Per metode bayar
    expect(findRow(rows, "Tunai")).toEqual(expect.arrayContaining([3, 1230000]));
    expect(findRow(rows, "Transfer")).toEqual(expect.arrayContaining([1, 350000]));
    expect(findRow(rows, "Tidak tercatat")).toEqual(expect.arrayContaining([1, 200000]));

    // Per tanggal, dengan kolom per metode
    const dateHeader = rows.find((row) => row[1] === "Tanggal" && row.includes("Tunai"));
    expect(dateHeader).toEqual(["No", "Tanggal", "Jumlah Transaksi", "Tunai", "Transfer", "Tidak tercatat", "Total (Rp)"]);
    expect(findRow(rows, "11/11/2026")).toEqual([1, "11/11/2026", 3, 1230000, 0, 0, 1230000]);
    expect(findRow(rows, "12/11/2026")).toEqual([2, "12/11/2026", 2, 0, 350000, 200000, 550000]);

    expect(findRow(rows, "TOTAL PENERIMAAN")).toEqual(expect.arrayContaining([5, 1780000]));
  });

  it("ends the summary with Kasir and Bendahara signature blocks", () => {
    const rows = sheetRows(build(), "Rekapitulasi");
    const label = rows.findIndex((row) => row.includes("Kasir,") && row.includes("Bendahara,"));
    expect(label).toBeGreaterThan(0);
    const names = rows.slice(label + 1).find((row) => row.some((cell) => String(cell).includes("Fitri Yanto")));
    expect(names).toEqual(expect.arrayContaining(["( Fitri Yanto, S.Si )", "( ............................ )"]));
  });

  it("still produces a valid report for an empty period", () => {
    const wb = buildRekapKasirWorkbook({
      petugasNama: null, dari: "2026-11-11", sampai: "2026-11-11", dicetakPada: new Date(), items: [],
    });
    const rows = sheetRows(wb, "Rekapitulasi");
    expect(findRow(rows, "TOTAL PENERIMAAN")).toEqual(expect.arrayContaining([0, 0]));
  });
});

describe("rekapKasirFilename", () => {
  it("names the file by period", () => {
    expect(rekapKasirFilename("2026-11-11", "2026-11-11")).toBe("rekap-kasir-2026-11-11.xlsx");
    expect(rekapKasirFilename("2026-11-01", "2026-11-30")).toBe("rekap-kasir-2026-11-01_sd_2026-11-30.xlsx");
  });
});

describe("halaman Rekap Kasir Saya", () => {
  // Kontrak sumber: halaman memakai rentang tanggal dan tombol unduh laporan
  // yang membangun workbook lewat helper ini (dimuat dinamis agar xlsx tidak
  // ikut di bundle awal halaman).
  it("offers a date range and an Excel report download", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/RekapKasirSaya.tsx"), "utf8");
    expect(page).toContain("tanggal_dari: tanggalDari");
    expect(page).toContain("tanggal_sampai: tanggalSampai");
    expect(page).toContain("Unduh Laporan Excel");
    expect(page).toContain('import("@/lib/rekapKasirExcel")');
    expect(page).not.toMatch(/^import .*from "xlsx";$/m);
  });
});
