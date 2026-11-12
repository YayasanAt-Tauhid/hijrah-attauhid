import ExcelJS from "exceljs";
import {
  identitasLabel,
  kelasLabel,
  normalizePaymentMethod,
  periodeLabel,
  periodeRekap,
  summarizeRekapKasir,
  tanggalPendek,
  waktuCetak,
  type RekapKasirItem,
  type RekapKasirSummary,
} from "./rekapKasirSummary";

export { parseRekapKasirRange, REKAP_KASIR_MAX_HARI } from "./rekapKasirRange";
export { normalizePaymentMethod } from "./rekapKasirSummary";

/**
 * Laporan Excel "Rekap Kasir Saya": satu file dengan sheet Rekapitulasi
 * (per lembaga/jenis, per metode bayar, per tanggal, tanda tangan) dan sheet
 * Rincian (satu baris per transaksi), berkop logo yayasan dan berwarna.
 *
 * Memakai exceljs karena SheetJS edisi komunitas tidak bisa menulis format sel
 * maupun gambar. Fungsi ini murni (tanpa I/O): halaman memanggil
 * `workbook.xlsx.writeBuffer()` lalu mengunduh hasilnya.
 */

export type RekapKasirExcelItem = RekapKasirItem;

export interface RekapKasirExcelInput {
  petugasNama: string | null;
  dari: string;
  sampai: string;
  dicetakPada: Date;
  items: RekapKasirExcelItem[];
  /** Nama Bendahara dari Profil Yayasan; kosong = titik-titik. */
  bendaharaNama?: string | null;
  /** PNG logo kop yayasan; laporan tetap dibuat tanpa logo bila kosong. */
  logo?: Uint8Array | ArrayBuffer;
  /** Lembaga yang difilter ("KODE — Nama"); kosong = Semua Lembaga. */
  lembagaLabel?: string | null;
  /** Jenis pembayaran yang difilter; kosong = Semua Jenis. */
  jenisLabel?: string | null;
}

/** Warna ARGB, selaras dengan hijau utama aplikasi (hsl 149 66% 25%). */
export const REKAP_KASIR_WARNA = {
  utama: "FF166A3B",
  teksHeader: "FFFFFFFF",
  subtotal: "FFE3F1E8",
  selang: "FFF4F9F6",
  total: "FFCFE8D8",
  garis: "FFB7CFC0",
  teksRedup: "FF4B5563",
} as const;

const AMOUNT_FORMAT = "#,##0";
const YAYASAN = "YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG";
const TTD_KOSONG = "( ............................ )";

export function rekapKasirFilename(
  dari: string,
  sampai: string,
  lembagaLabel?: string | null,
  jenisLabel?: string | null,
): string {
  const periode = dari === sampai ? dari : `${dari}_sd_${sampai}`;
  const slug = (label?: string | null) =>
    (label ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const filter = [slug(lembagaLabel), slug(jenisLabel)].filter(Boolean).map((s) => `_${s}`).join("");
  return `rekap-kasir-${periode}${filter}.xlsx`;
}

/** Hindari formula injection saat file dibuka di Excel/LibreOffice. */
function safeText(value: string | null | undefined, fallback = "-"): string {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function toBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ─── Gaya ────────────────────────────────────────────────────────────────

type CellValue = string | number;

const thin = (argb: string = REKAP_KASIR_WARNA.garis): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });
const kotak = (): Partial<ExcelJS.Borders> => ({ top: thin(), left: thin(), bottom: thin(), right: thin() });
const isi = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

interface RowStyle {
  /** Kolom (1-based) berisi nominal: format ribuan, rata kanan. */
  amountCols?: number[];
  /** Kolom (1-based) berisi hitungan: rata tengah. */
  countCols?: number[];
  fill?: string;
  bold?: boolean;
  topBorder?: "thin" | "double";
}

/** Tulis satu baris tabel ber-garis mulai kolom 1. */
function tableRow(ws: ExcelJS.Worksheet, r: number, values: CellValue[], width: number, style: RowStyle = {}) {
  const row = ws.getRow(r);
  for (let c = 1; c <= width; c++) {
    const cell = row.getCell(c);
    const value = values[c - 1];
    if (value !== undefined && value !== "") cell.value = value;
    cell.font = { size: 10, bold: style.bold || undefined };
    cell.border = kotak();
    if (style.topBorder === "double") cell.border = { ...kotak(), top: { style: "double", color: { argb: REKAP_KASIR_WARNA.utama } } };
    if (style.fill) cell.fill = isi(style.fill);
    cell.alignment = { vertical: "middle" };
    if (style.amountCols?.includes(c)) {
      cell.numFmt = AMOUNT_FORMAT;
      cell.alignment = { vertical: "middle", horizontal: "right" };
    } else if (style.countCols?.includes(c)) {
      cell.alignment = { vertical: "middle", horizontal: "center" };
    }
  }
}

function headerRow(ws: ExcelJS.Worksheet, r: number, labels: string[]) {
  const row = ws.getRow(r);
  labels.forEach((label, index) => {
    const cell = row.getCell(index + 1);
    cell.value = label;
    cell.font = { size: 10, bold: true, color: { argb: REKAP_KASIR_WARNA.teksHeader } };
    cell.fill = isi(REKAP_KASIR_WARNA.utama);
    cell.border = kotak();
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 20;
}

function sectionTitle(ws: ExcelJS.Worksheet, r: number, text: string) {
  const cell = ws.getRow(r).getCell(1);
  cell.value = text;
  cell.font = { size: 11, bold: true, color: { argb: REKAP_KASIR_WARNA.utama } };
}

/** Kop: logo di kolom A, teks di B..lastCol, garis hijau di bawah. Mengembalikan baris berikutnya. */
function letterhead(
  ws: ExcelJS.Worksheet,
  logoId: number | null,
  judul: string,
  input: RekapKasirExcelInput,
  lastCol: number,
): number {
  const periode = periodeRekap(input.dari, input.sampai);
  const lines: Array<{ text: string; font: Partial<ExcelJS.Font> }> = [
    { text: YAYASAN, font: { size: 14, bold: true, color: { argb: REKAP_KASIR_WARNA.utama } } },
    { text: judul, font: { size: 12, bold: true } },
    // Label dan nilai dalam satu sel: kolom A dipakai logo dan kolom "No".
    { text: `Petugas : ${safeText(input.petugasNama)}`, font: { size: 10 } },
    {
      text:
        `Periode : ${periode}` +
        (input.lembagaLabel ? ` · Lembaga : ${safeText(input.lembagaLabel)}` : "") +
        (input.jenisLabel ? ` · Jenis : ${safeText(input.jenisLabel)}` : ""),
      font: { size: 10 },
    },
    { text: `Diunduh : ${waktuCetak(input.dicetakPada)}`, font: { size: 9, italic: true, color: { argb: REKAP_KASIR_WARNA.teksRedup } } },
  ];
  lines.forEach((line, index) => {
    const r = index + 1;
    ws.mergeCells(r, 2, r, lastCol);
    const cell = ws.getRow(r).getCell(2);
    cell.value = line.text;
    cell.font = line.font;
    cell.alignment = { vertical: "middle" };
    ws.getRow(r).height = index === 0 ? 20 : 15;
  });
  for (let c = 1; c <= lastCol; c++) {
    ws.getRow(lines.length).getCell(c).border = { bottom: { style: "medium", color: { argb: REKAP_KASIR_WARNA.utama } } };
  }
  if (logoId !== null) {
    ws.addImage(logoId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 46, height: 59 }, editAs: "oneCell" });
  }
  return lines.length + 2;
}

function pageSetup(ws: ExcelJS.Worksheet) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
}

// ─── Sheet ───────────────────────────────────────────────────────────────

function buildRekapitulasi(workbook: ExcelJS.Workbook, logoId: number | null, input: RekapKasirExcelInput, summary: RekapKasirSummary) {
  const { methods } = summary;
  const dateCols = 3 + methods.length + 1;
  const lastCol = Math.max(7, dateCols);

  const ws = workbook.addWorksheet("Rekapitulasi");
  ws.columns = [7, 24, 30, 16, 16, 16, 16, ...Array(Math.max(0, lastCol - 7)).fill(16)].map((width) => ({ width }));
  pageSetup(ws);
  let r = letterhead(ws, logoId, "LAPORAN REKAPITULASI PENERIMAAN KASIR", input, lastCol);

  // A. Per lembaga dan jenis pembayaran
  sectionTitle(ws, r++, "A. Rekap per Lembaga dan Jenis Pembayaran");
  headerRow(ws, r++, ["No", "Lembaga", "Jenis Pembayaran", "Jumlah Transaksi", "Total (Rp)"]);
  let no = 1;
  for (const lembaga of summary.lembaga) {
    lembaga.jenis.forEach((jenis, index) => {
      tableRow(ws, r++, [no++, safeText(lembaga.nama), safeText(jenis.nama), jenis.count, jenis.total], 5, {
        countCols: [1, 4], amountCols: [5], fill: index % 2 ? REKAP_KASIR_WARNA.selang : undefined,
      });
    });
    tableRow(ws, r++, ["", `Subtotal ${safeText(lembaga.nama)}`, "", lembaga.count, lembaga.total], 5, {
      countCols: [4], amountCols: [5], fill: REKAP_KASIR_WARNA.subtotal, bold: true,
    });
  }
  if (summary.count === 0) {
    tableRow(ws, r++, ["", "Tidak ada transaksi pada periode ini"], 5);
  }
  r++;

  // B. Per metode bayar (mencocokkan uang tunai di laci vs transfer)
  sectionTitle(ws, r++, "B. Rekap per Metode Bayar");
  headerRow(ws, r++, ["No", "Metode Bayar", "Jumlah Transaksi", "Total (Rp)"]);
  summary.perMetode.forEach((agg, index) => {
    tableRow(ws, r++, [index + 1, agg.metode, agg.count, agg.total], 4, {
      countCols: [1, 3], amountCols: [4], fill: index % 2 ? REKAP_KASIR_WARNA.selang : undefined,
    });
  });
  if (methods.length === 0) tableRow(ws, r++, ["", "-", 0, 0], 4, { countCols: [3], amountCols: [4] });
  r++;

  // C. Per tanggal (setoran harian)
  sectionTitle(ws, r++, "C. Rekap per Tanggal");
  headerRow(ws, r++, ["No", "Tanggal", "Jumlah Transaksi", ...methods, "Total (Rp)"]);
  const amountCols = methods.map((_, i) => 4 + i).concat(4 + methods.length);
  summary.perTanggal.forEach((day, index) => {
    tableRow(ws, r++, [index + 1, tanggalPendek(day.tanggal || null), day.count, ...day.perMetode, day.total], dateCols, {
      countCols: [1, 2, 3], amountCols, fill: index % 2 ? REKAP_KASIR_WARNA.selang : undefined,
    });
  });
  r++;

  // Total penerimaan
  tableRow(ws, r, ["", "TOTAL PENERIMAAN", summary.count, summary.total], 4, {
    countCols: [3], amountCols: [4], fill: REKAP_KASIR_WARNA.total, bold: true, topBorder: "double",
  });
  ws.getRow(r).getCell(2).font = { size: 11, bold: true, color: { argb: REKAP_KASIR_WARNA.utama } };
  ws.getRow(r).height = 20;
  r += 3;

  // Tanda tangan: Kasir, Staf Keuangan (penerima setoran), Mengetahui Bendahara
  const blocks: Array<{ from: number; to: number; label: string; nama: string }> = [
    { from: 2, to: 2, label: "Kasir,", nama: input.petugasNama?.trim() ? `( ${safeText(input.petugasNama)} )` : TTD_KOSONG },
    { from: 3, to: 4, label: "Staf Keuangan,", nama: TTD_KOSONG },
    {
      from: 5, to: 7, label: "Mengetahui, Bendahara,",
      nama: input.bendaharaNama?.trim() ? `( ${safeText(input.bendaharaNama)} )` : TTD_KOSONG,
    },
  ];
  const namaRow = r + 4;
  for (const block of blocks) {
    for (const [row, text, bold] of [[r, block.label, false], [namaRow, block.nama, true]] as const) {
      if (block.to > block.from) ws.mergeCells(row, block.from, row, block.to);
      const cell = ws.getRow(row).getCell(block.from);
      cell.value = text;
      cell.font = { size: 10, bold: bold || undefined };
      cell.alignment = { horizontal: "center" };
    }
  }
  return ws;
}

function buildRincian(workbook: ExcelJS.Workbook, logoId: number | null, input: RekapKasirExcelInput, summary: RekapKasirSummary) {
  const { items } = summary;
  const ws = workbook.addWorksheet("Rincian");
  const widths = [7, 11, 18, 26, 27, 11, 9, 26, 15, 12, 14, 17, 24];
  ws.columns = widths.map((width) => ({ width }));
  pageSetup(ws);
  let r = letterhead(ws, logoId, "RINCIAN PENERIMAAN KASIR", input, widths.length);

  const header = r++;
  headerRow(ws, header, [
    "No", "Tanggal", "No. Kwitansi", "Nama", "NIS / NISN", "Kelas", "Lembaga",
    "Jenis Pembayaran", "Periode", "Metode", "Jumlah (Rp)", "No. Jurnal", "Keterangan",
  ]);
  items.forEach((item, index) => {
    tableRow(ws, r++, [
      index + 1,
      tanggalPendek(item.tanggal_bayar),
      safeText(item.receipt_number),
      safeText(item.siswa_nama),
      identitasLabel(item),
      safeText(kelasLabel(item)),
      safeText(item.departemen_nama),
      safeText(item.jenis_nama),
      safeText(periodeLabel(item)),
      normalizePaymentMethod(item.payment_method),
      item.jumlah,
      safeText(item.jurnal_nomor),
      safeText(item.keterangan),
    ], widths.length, {
      countCols: [1, 2, 6, 7, 10], amountCols: [11], fill: index % 2 ? REKAP_KASIR_WARNA.selang : undefined,
    });
  });
  const values: CellValue[] = Array(widths.length).fill("");
  values[9] = "TOTAL";
  values[10] = summary.total;
  tableRow(ws, r, values, widths.length, {
    amountCols: [11], countCols: [10], fill: REKAP_KASIR_WARNA.total, bold: true, topBorder: "double",
  });

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: header }];
  ws.autoFilter = `A${header}:M${header + items.length}`;
  ws.pageSetup.printTitlesRow = `${header}:${header}`;
  return ws;
}

export function buildRekapKasirWorkbook(input: RekapKasirExcelInput): ExcelJS.Workbook {
  const summary = summarizeRekapKasir(input.items);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hijrah At-Tauhid";
  workbook.created = input.dicetakPada;
  const logoId = input.logo && (input.logo.byteLength ?? 0) > 0
    ? workbook.addImage({ base64: toBase64(input.logo), extension: "png" })
    : null;
  buildRekapitulasi(workbook, logoId, input, summary);
  buildRincian(workbook, logoId, input, summary);
  return workbook;
}
