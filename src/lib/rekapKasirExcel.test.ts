import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildRekapKasirWorkbook,
  normalizePaymentMethod,
  parseRekapKasirRange,
  rekapKasirFilename,
  REKAP_KASIR_WARNA,
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

const LOGO = readFileSync(resolve(process.cwd(), "public/branding/yayasan-at-tauhid-kop.png"));

/** Tulis ke buffer lalu baca balik, agar yang dites adalah isi file sesungguhnya. */
async function buildAndReload(overrides: Partial<Parameters<typeof buildRekapKasirWorkbook>[0]> = {}) {
  const workbook = buildRekapKasirWorkbook({
    petugasNama: "Fitri Yanto, S.Si",
    dari: "2026-11-11",
    sampai: "2026-11-12",
    dicetakPada: new Date("2026-11-12T10:15:00+07:00"),
    items,
    logo: new Uint8Array(LOGO),
    ...overrides,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  return back;
}

/** Nilai sel per baris (indeks 0 = baris 1); sel bawahan dari merge dianggap kosong. */
function sheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: unknown[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      const slave = cell.isMerged && cell.master.address !== cell.address;
      values.push(slave || cell.value === null || cell.value === undefined ? "" : cell.value);
    }
    while (values.length && values[values.length - 1] === "") values.pop();
    out.push(values);
  }
  return out;
}

const findRowIndex = (rows: unknown[][], value: string) => rows.findIndex((row) => row.includes(value));
const findRow = (rows: unknown[][], value: string) => rows[findRowIndex(rows, value)];
const compact = (row: unknown[] | undefined) => (row ?? []).filter((value) => value !== "");

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

describe("buildRekapKasirWorkbook — isi", () => {
  it("creates Rekapitulasi and Rincian sheets", async () => {
    const wb = await buildAndReload();
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Rekapitulasi", "Rincian"]);
  });

  it("lists every transaction in Rincian with numeric amounts and a total row", async () => {
    const ws = (await buildAndReload()).getWorksheet("Rincian")!;
    const rows = sheetRows(ws);
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
    expect(findRow(rows, "TOTAL")?.[10]).toBe(1780000);
  });

  it("summarises by lembaga and jenis, by payment method and by date", async () => {
    const rows = sheetRows((await buildAndReload()).getWorksheet("Rekapitulasi")!);
    const flat = rows.map((row) => compact(row).join("|"));
    expect(flat).toContain("YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG");
    expect(flat).toContain("Petugas : Fitri Yanto, S.Si");
    expect(flat).toContain("Periode : 11 November 2026 s.d. 12 November 2026");

    expect(compact(findRow(rows, "SPP SMP"))).toEqual([3, "SMP", "SPP SMP", 2, 900000]);
    expect(compact(findRow(rows, "UANG SERAGAM OLAHRAGA SMP"))).toEqual([4, "SMP", "UANG SERAGAM OLAHRAGA SMP", 1, 330000]);
    expect(compact(findRow(rows, "Subtotal SMP"))).toEqual(["Subtotal SMP", 3, 1230000]);
    expect(compact(findRow(rows, "Subtotal SD"))).toEqual(["Subtotal SD", 2, 550000]);

    expect(compact(findRow(rows, "Tunai"))).toEqual([1, "Tunai", 3, 1230000]);
    expect(compact(findRow(rows, "Transfer"))).toEqual([2, "Transfer", 1, 350000]);
    expect(compact(findRow(rows, "Tidak tercatat"))).toEqual([3, "Tidak tercatat", 1, 200000]);

    const dateHeader = rows.find((row) => row[1] === "Tanggal" && row.includes("Tunai"));
    expect(dateHeader).toEqual(["No", "Tanggal", "Jumlah Transaksi", "Tunai", "Transfer", "Tidak tercatat", "Total (Rp)"]);
    expect(findRow(rows, "11/11/2026")).toEqual([1, "11/11/2026", 3, 1230000, 0, 0, 1230000]);
    expect(findRow(rows, "12/11/2026")).toEqual([2, "12/11/2026", 2, 0, 350000, 200000, 550000]);

    expect(compact(findRow(rows, "TOTAL PENERIMAAN"))).toEqual(["TOTAL PENERIMAAN", 5, 1780000]);
  });

  it("ends the summary with Kasir, Staf Keuangan and Mengetahui Bendahara signatures", async () => {
    const rows = sheetRows((await buildAndReload()).getWorksheet("Rekapitulasi")!);
    const label = rows.findIndex((row) => row.includes("Kasir,"));
    expect(compact(rows[label])).toEqual(["Kasir,", "Staf Keuangan,", "Mengetahui, Bendahara,"]);
    const names = rows.slice(label + 1).find((row) => row.some((cell) => String(cell).includes("Fitri Yanto")));
    expect(compact(names)).toEqual([
      "( Fitri Yanto, S.Si )", "( ............................ )", "( ............................ )",
    ]);
  });

  it("fills the Bendahara signature from Profil Yayasan when available", async () => {
    const rows = sheetRows((await buildAndReload({ bendaharaNama: "Hj. Siti Aminah" })).getWorksheet("Rekapitulasi")!);
    const label = rows.findIndex((row) => row.includes("Kasir,"));
    const names = rows.slice(label + 1).find((row) => row.some((cell) => String(cell).includes("Fitri Yanto")));
    expect(compact(names)).toEqual([
      "( Fitri Yanto, S.Si )", "( ............................ )", "( Hj. Siti Aminah )",
    ]);
  });

  it("still produces a valid report for an empty period and without a logo", async () => {
    const wb = await buildAndReload({ items: [], petugasNama: null, logo: undefined, sampai: "2026-11-11" });
    const ws = wb.getWorksheet("Rekapitulasi")!;
    expect(compact(findRow(sheetRows(ws), "TOTAL PENERIMAAN"))).toEqual(["TOTAL PENERIMAAN", 0, 0]);
    expect(ws.getImages()).toHaveLength(0);
  });
});

describe("buildRekapKasirWorkbook — tampilan", () => {
  it("puts the foundation logo in the letterhead of both sheets", async () => {
    const wb = await buildAndReload();
    for (const ws of wb.worksheets) {
      const images = ws.getImages();
      expect(images).toHaveLength(1);
      expect(Math.floor(images[0].range.tl.col)).toBe(0);
      expect(Math.floor(images[0].range.tl.row)).toBe(0);
    }
  });

  it("colours table headers, subtotal and total rows", async () => {
    const wb = await buildAndReload();
    const recap = wb.getWorksheet("Rekapitulasi")!;
    const rows = sheetRows(recap);

    const yayasan = recap.getRow(findRowIndex(rows, "YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG") + 1).getCell(2);
    expect(yayasan.font?.bold).toBe(true);
    expect(yayasan.font?.color?.argb).toBe(REKAP_KASIR_WARNA.utama);

    const header = recap.getRow(rows.findIndex((row) => row[1] === "Lembaga") + 1).getCell(2);
    expect((header.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(REKAP_KASIR_WARNA.utama);
    expect(header.font?.color?.argb).toBe("FFFFFFFF");
    expect(header.font?.bold).toBe(true);
    expect(header.border?.bottom?.style).toBe("thin");

    const subtotal = recap.getRow(findRowIndex(rows, "Subtotal SMP") + 1).getCell(2);
    expect((subtotal.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(REKAP_KASIR_WARNA.subtotal);
    expect(subtotal.font?.bold).toBe(true);

    const totalRow = recap.getRow(findRowIndex(rows, "TOTAL PENERIMAAN") + 1);
    expect(totalRow.getCell(2).font?.bold).toBe(true);
    expect(totalRow.getCell(4).border?.top?.style).toBe("double");
    expect(totalRow.getCell(4).numFmt).toBe("#,##0");
  });

  it("formats amounts with thousands separators and right alignment", async () => {
    const ws = (await buildAndReload()).getWorksheet("Rincian")!;
    const rows = sheetRows(ws);
    const firstData = ws.getRow(rows.findIndex((row) => row[0] === "No") + 2).getCell(11);
    expect(firstData.value).toBe(450000);
    expect(firstData.numFmt).toBe("#,##0");
    expect(firstData.alignment?.horizontal).toBe("right");
  });

  it("freezes and filters the Rincian header, and prints A4 landscape fit to width", async () => {
    const wb = await buildAndReload();
    const ws = wb.getWorksheet("Rincian")!;
    const headerRow = sheetRows(ws).findIndex((row) => row[0] === "No") + 1;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: headerRow });
    expect(ws.autoFilter).toBe(`A${headerRow}:M${headerRow + items.length}`);
    for (const sheet of wb.worksheets) {
      expect(sheet.pageSetup.orientation).toBe("landscape");
      expect(sheet.pageSetup.paperSize).toBe(9);
      expect(sheet.pageSetup.fitToWidth).toBe(1);
    }
  });
});

describe("rekapKasirFilename", () => {
  it("names the file by period", () => {
    expect(rekapKasirFilename("2026-11-11", "2026-11-11")).toBe("rekap-kasir-2026-11-11.xlsx");
    expect(rekapKasirFilename("2026-11-01", "2026-11-30")).toBe("rekap-kasir-2026-11-01_sd_2026-11-30.xlsx");
  });
});

describe("halaman Rekap Kasir Saya", () => {
  // Kontrak sumber: halaman memakai rentang tanggal dan tombol unduh. Unduhan
  // dibungkus createClientOnlyFn dan memuat exceljs secara dinamis, agar
  // exceljs tidak masuk bundle awal halaman maupun bundle Worker server.
  it("offers a date range and a styled Excel report download", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/keuangan/RekapKasirSaya.tsx"), "utf8");
    const download = readFileSync(resolve(process.cwd(), "src/lib/rekapKasirDownload.ts"), "utf8");
    expect(page).toContain("tanggal_dari: tanggalDari");
    expect(page).toContain("tanggal_sampai: tanggalSampai");
    expect(page).toContain("Unduh Laporan Excel");
    // Unduhan dan cetak harus memakai baris terfilter lembaga, bukan semua baris.
    expect(page).toContain("await unduhRekapKasirExcel({ ...data, items: itemsTerfilter, lembaga_label: lembagaLabel })");
    expect(page).toContain("items={itemsTerfilter}");
    expect(page).toContain("lembagaLabel={lembagaLabel}");
    expect(page).not.toMatch(/^import .*from "(xlsx|exceljs|@\/lib\/rekapKasirExcel)";$/m);
    expect(download).toContain("createClientOnlyFn(");
    expect(download).toContain('import("@/lib/rekapKasirExcel")');
    expect(download).toContain("/branding/yayasan-at-tauhid-kop.png");
    expect(download).toContain("xlsx.writeBuffer()");
    expect(download).not.toMatch(/^import (?!type ).*rekapKasirExcel/m);
  });
});

describe("filter lembaga pada laporan Excel", () => {
  it("nama file memuat lembaga terpilih", () => {
    expect(rekapKasirFilename("2026-11-11", "2026-11-11", "SMP — SMP")).toBe("rekap-kasir-2026-11-11_smp-smp.xlsx");
    expect(rekapKasirFilename("2026-11-01", "2026-11-30", "SD — Sekolah Dasar")).toBe("rekap-kasir-2026-11-01_sd_2026-11-30_sd-sekolah-dasar.xlsx");
  });

  it("nama file tidak berubah tanpa filter lembaga", () => {
    expect(rekapKasirFilename("2026-11-11", "2026-11-11", null)).toBe("rekap-kasir-2026-11-11.xlsx");
  });

  it("header laporan menyebut lembaga bila difilter", async () => {
    const wb = await buildAndReload({ lembagaLabel: "SD — Sekolah Dasar" });
    const teks = sheetRows(wb.worksheets[0]).flat().map((v) => String(v ?? ""));
    expect(teks.some((t) => t.includes("Lembaga : SD — Sekolah Dasar"))).toBe(true);
  });

  it("header laporan tanpa filter tidak menyebut lembaga", async () => {
    const wb = await buildAndReload();
    const teks = sheetRows(wb.worksheets[0]).flat().map((v) => String(v ?? ""));
    expect(teks.some((t) => t.includes("Lembaga :"))).toBe(false);
  });
});
