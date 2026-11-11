import * as XLSX from "xlsx";

export { parseRekapKasirRange, REKAP_KASIR_MAX_HARI } from "./rekapKasirRange";

/**
 * Laporan Excel "Rekap Kasir Saya": satu file dengan sheet Rekapitulasi
 * (per lembaga/jenis, per metode bayar, per tanggal, tanda tangan) dan sheet
 * Rincian (satu baris per transaksi). Murni (tanpa I/O) agar mudah dites;
 * halaman cukup memanggil XLSX.writeFile dengan workbook hasil fungsi ini.
 */

export interface RekapKasirExcelItem {
  id: string;
  jumlah: number;
  tanggal_bayar: string | null;
  bulan: number | null;
  keterangan: string | null;
  siswa_nama: string;
  siswa_nis: string | null;
  siswa_nisn: string | null;
  siswa_status: string | null;
  kelas_nama: string | null;
  jenis_nama: string;
  departemen_nama: string;
  departemen_kode: string | null;
  jurnal_nomor: string | null;
  receipt_number: string | null;
  payment_method: string | null;
  periode_label: string | null;
}

export interface RekapKasirExcelInput {
  petugasNama: string | null;
  dari: string;
  sampai: string;
  dicetakPada: Date;
  items: RekapKasirExcelItem[];
}

const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT_FORMAT = "#,##0";
const METODE_TIDAK_TERCATAT = "Tidak tercatat";
const METODE_ORDER = ["Tunai", "Transfer", "Online (Midtrans)"];

/** Satukan ejaan metode bayar yang tersimpan di kwitansi. */
export function normalizePaymentMethod(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return METODE_TIDAK_TERCATAT;
  const lower = text.toLowerCase();
  if (lower.includes("tunai") || lower === "cash") return "Tunai";
  if (lower.includes("transfer") || lower.includes("bank")) return "Transfer";
  if (lower.includes("midtrans") || lower.includes("qris") || lower.includes("online")) return "Online (Midtrans)";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function rekapKasirFilename(dari: string, sampai: string): string {
  return dari === sampai ? `rekap-kasir-${dari}.xlsx` : `rekap-kasir-${dari}_sd_${sampai}.xlsx`;
}

function tanggalPendek(iso: string | null): string {
  const match = iso ? ISO_DATE.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

function tanggalPanjang(iso: string): string {
  const match = ISO_DATE.exec(iso);
  return match ? `${Number(match[3])} ${NAMA_BULAN[Number(match[2]) - 1]} ${match[1]}` : iso;
}

function waktuUnduh(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Hindari formula injection saat file dibuka di Excel/LibreOffice. */
function safeText(value: string | null | undefined, fallback = "-"): string {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function periodeItem(item: RekapKasirExcelItem): string {
  if (item.periode_label?.trim()) return item.periode_label.trim();
  if (item.bulan && item.bulan >= 1 && item.bulan <= 12) {
    const tahun = item.tanggal_bayar ? ISO_DATE.exec(item.tanggal_bayar)?.[1] : undefined;
    return tahun ? `${NAMA_BULAN[item.bulan - 1]} ${tahun}` : NAMA_BULAN[item.bulan - 1];
  }
  return "-";
}

function kelasItem(item: RekapKasirExcelItem): string {
  if (item.siswa_status === "calon") return "Calon Murid";
  return safeText(item.kelas_nama);
}

function sortItems(items: RekapKasirExcelItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const tanggal = (a.item.tanggal_bayar ?? "").localeCompare(b.item.tanggal_bayar ?? "");
      if (tanggal !== 0) return tanggal;
      const ra = a.item.receipt_number ?? "￿";
      const rb = b.item.receipt_number ?? "￿";
      if (ra !== rb) return ra.localeCompare(rb);
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function methodOrder(methods: Iterable<string>): string[] {
  return [...new Set(methods)].sort((a, b) => {
    const rank = (m: string) => (m === METODE_TIDAK_TERCATAT ? 1000 : METODE_ORDER.indexOf(m) === -1 ? 500 : METODE_ORDER.indexOf(m));
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

type Cell = string | number;

/** Kumpulan baris + daftar sel nominal yang perlu format ribuan. */
class SheetBuilder {
  rows: Cell[][] = [];
  amountCells: { r: number; c: number }[] = [];
  merges: XLSX.Range[] = [];

  push(row: Cell[], amountColumns: number[] = []) {
    const r = this.rows.length;
    this.rows.push(row);
    for (const c of amountColumns) this.amountCells.push({ r, c });
  }

  title(text: string, width: number) {
    const r = this.rows.length;
    this.rows.push([text]);
    this.merges.push({ s: { r, c: 0 }, e: { r, c: width - 1 } });
  }

  blank() {
    this.rows.push([]);
  }

  toSheet(widths: number[]): XLSX.WorkSheet {
    const sheet = XLSX.utils.aoa_to_sheet(this.rows);
    for (const { r, c } of this.amountCells) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT;
    }
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!merges"] = this.merges;
    return sheet;
  }
}

const YAYASAN = "YAYASAN AT-TAUHID AL ISLAMY BANGKA BELITUNG";

function headerBlock(builder: SheetBuilder, judul: string, input: RekapKasirExcelInput, width: number) {
  const periode = input.dari === input.sampai
    ? tanggalPanjang(input.dari)
    : `${tanggalPanjang(input.dari)} s.d. ${tanggalPanjang(input.sampai)}`;
  builder.title(YAYASAN, width);
  builder.title(judul, width);
  builder.blank();
  // Label dan nilai dalam satu sel gabungan: kolom A juga dipakai kolom "No" yang sempit.
  builder.title(`Petugas : ${safeText(input.petugasNama)}`, width);
  builder.title(`Periode : ${periode}`, width);
  builder.title(`Diunduh : ${waktuUnduh(input.dicetakPada)}`, width);
  builder.blank();
}

function buildRekapitulasi(input: RekapKasirExcelInput, items: RekapKasirExcelItem[]): XLSX.WorkSheet {
  const b = new SheetBuilder();
  headerBlock(b, "LAPORAN REKAPITULASI PENERIMAAN KASIR", input, 7);

  // 1. Per lembaga dan jenis pembayaran
  b.push(["A. Rekap per Lembaga dan Jenis Pembayaran"]);
  b.push(["No", "Lembaga", "Jenis Pembayaran", "Jumlah Transaksi", "Total (Rp)"]);
  const perLembaga = new Map<string, Map<string, { count: number; total: number }>>();
  for (const item of items) {
    const lembaga = safeText(item.departemen_nama);
    const jenis = safeText(item.jenis_nama);
    const byJenis = perLembaga.get(lembaga) ?? new Map();
    const agg = byJenis.get(jenis) ?? { count: 0, total: 0 };
    agg.count += 1;
    agg.total += item.jumlah;
    byJenis.set(jenis, agg);
    perLembaga.set(lembaga, byJenis);
  }
  let no = 1;
  for (const lembaga of [...perLembaga.keys()].sort((x, y) => x.localeCompare(y))) {
    const byJenis = perLembaga.get(lembaga)!;
    let subCount = 0;
    let subTotal = 0;
    for (const jenis of [...byJenis.keys()].sort((x, y) => x.localeCompare(y))) {
      const agg = byJenis.get(jenis)!;
      b.push([no++, lembaga, jenis, agg.count, agg.total], [4]);
      subCount += agg.count;
      subTotal += agg.total;
    }
    b.push(["", `Subtotal ${lembaga}`, "", subCount, subTotal], [4]);
  }
  if (items.length === 0) b.push(["", "Tidak ada transaksi pada periode ini"]);
  b.blank();

  // 2. Per metode bayar (untuk mencocokkan uang tunai di laci vs transfer)
  const metodeAgg = new Map<string, { count: number; total: number }>();
  for (const item of items) {
    const metode = normalizePaymentMethod(item.payment_method);
    const agg = metodeAgg.get(metode) ?? { count: 0, total: 0 };
    agg.count += 1;
    agg.total += item.jumlah;
    metodeAgg.set(metode, agg);
  }
  const methods = methodOrder(metodeAgg.keys());
  b.push(["B. Rekap per Metode Bayar"]);
  b.push(["No", "Metode Bayar", "Jumlah Transaksi", "Total (Rp)"]);
  methods.forEach((metode, index) => {
    const agg = metodeAgg.get(metode)!;
    b.push([index + 1, metode, agg.count, agg.total], [3]);
  });
  if (methods.length === 0) b.push(["", "-", 0, 0], [3]);
  b.blank();

  // 3. Per tanggal (rentang lebih dari satu hari = setoran harian)
  b.push(["C. Rekap per Tanggal"]);
  b.push(["No", "Tanggal", "Jumlah Transaksi", ...methods, "Total (Rp)"]);
  const perTanggal = new Map<string, RekapKasirExcelItem[]>();
  for (const item of items) {
    const key = item.tanggal_bayar ?? "";
    perTanggal.set(key, [...(perTanggal.get(key) ?? []), item]);
  }
  const amountCols = methods.map((_, i) => 3 + i).concat(3 + methods.length);
  [...perTanggal.keys()].sort().forEach((tanggal, index) => {
    const dayItems = perTanggal.get(tanggal)!;
    const byMethod = methods.map((metode) =>
      dayItems.filter((item) => normalizePaymentMethod(item.payment_method) === metode)
        .reduce((sum, item) => sum + item.jumlah, 0));
    const total = dayItems.reduce((sum, item) => sum + item.jumlah, 0);
    b.push([index + 1, tanggalPendek(tanggal || null), dayItems.length, ...byMethod, total], amountCols);
  });
  b.blank();

  const grandTotal = items.reduce((sum, item) => sum + item.jumlah, 0);
  b.push(["", "TOTAL PENERIMAAN", items.length, grandTotal], [3]);
  b.blank();
  b.blank();

  // 4. Tanda tangan
  b.push(["", "Kasir,", "", "", "Bendahara,"]);
  b.blank();
  b.blank();
  b.blank();
  const kosong = "( ............................ )";
  b.push(["", input.petugasNama?.trim() ? `( ${safeText(input.petugasNama)} )` : kosong, "", "", kosong]);

  return b.toSheet([5, 24, 28, 15, 15, 15, 15]);
}

function buildRincian(input: RekapKasirExcelInput, items: RekapKasirExcelItem[]): XLSX.WorkSheet {
  const b = new SheetBuilder();
  headerBlock(b, "RINCIAN PENERIMAAN KASIR", input, 13);
  b.push([
    "No", "Tanggal", "No. Kwitansi", "Nama", "NIS / NISN", "Kelas", "Lembaga",
    "Jenis Pembayaran", "Periode", "Metode", "Jumlah (Rp)", "No. Jurnal", "Keterangan",
  ]);
  items.forEach((item, index) => {
    b.push([
      index + 1,
      tanggalPendek(item.tanggal_bayar),
      safeText(item.receipt_number),
      safeText(item.siswa_nama),
      [item.siswa_nis, item.siswa_nisn].map((v) => v?.trim()).filter(Boolean).join(" / ") || "-",
      kelasItem(item),
      safeText(item.departemen_nama),
      safeText(item.jenis_nama),
      periodeItem(item),
      normalizePaymentMethod(item.payment_method),
      item.jumlah,
      safeText(item.jurnal_nomor),
      safeText(item.keterangan),
    ], [10]);
  });
  const total = items.reduce((sum, item) => sum + item.jumlah, 0);
  b.push(["", "", "", "", "", "", "", "", "", "TOTAL", total], [10]);
  return b.toSheet([5, 11, 18, 26, 27, 11, 9, 26, 15, 12, 13, 17, 24]);
}

export function buildRekapKasirWorkbook(input: RekapKasirExcelInput): XLSX.WorkBook {
  const items = sortItems(input.items);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildRekapitulasi(input, items), "Rekapitulasi");
  XLSX.utils.book_append_sheet(workbook, buildRincian(input, items), "Rincian");
  return workbook;
}
