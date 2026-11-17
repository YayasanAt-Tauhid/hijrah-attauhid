// Export Jurnal Umum (halaman /keuangan/jurnal).
// Builder murni (tanpa DOM) supaya bisa dites; fungsi unduh ada di bagian bawah.
import * as XLSX from "xlsx";
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";

export type JurnalCell = string | number;

export interface JurnalExportDetail {
  urutan?: number | null;
  keterangan?: string | null;
  debit?: number | string | null;
  kredit?: number | string | null;
  akun_rekening?: { kode?: string | null; nama?: string | null } | null;
}

export interface JurnalExportHeader {
  id?: string;
  nomor?: string | null;
  tanggal?: string | null;
  status?: string | null;
  tipe?: string | null;
  keterangan?: string | null;
  referensi?: string | null;
  departemen?: { kode?: string | null; nama?: string | null } | null;
  penginput?: { nama?: string | null } | null;
  total_debit?: number | string | null;
  total_kredit?: number | string | null;
}

export type JurnalExportFull = JurnalExportHeader & { details?: JurnalExportDetail[] | null };

// Jurnal online payment (webhook Midtrans) tidak punya penginput manusia —
// dikenali dari referensi berupa order_id dengan prefix "HAT-".
export const isJurnalOtomatis = (referensi?: string | null) => !!referensi?.startsWith("HAT-");

export function labelStatusJurnal(status?: string | null): string {
  return status === "posted" ? "Posted" : "Draft";
}

// Sama dengan badge kolom "Tipe" di tabel: normal yang sudah dikoreksi → "Dikoreksi".
export function labelTipeJurnal(tipe?: string | null, dikoreksi = false): string {
  if (tipe === "pembalik") return "Pembalik";
  if (tipe === "pengganti") return "Pengganti";
  return dikoreksi ? "Dikoreksi" : "Normal";
}

export function labelPenginput(j: Pick<JurnalExportHeader, "penginput" | "referensi">): string {
  if (j.penginput?.nama) return j.penginput.nama;
  if (isJurnalOtomatis(j.referensi)) return "Otomatis (Online Payment)";
  return "-";
}

// Hindari formula injection saat file dibuka di Excel/LibreOffice (pola sama dengan ExportButton).
function safeText(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

const num = (v: unknown) => Number(v) || 0;

const sortDetails = (details: JurnalExportDetail[]) =>
  [...details].sort((a, b) => (Number(a.urutan) || 0) - (Number(b.urutan) || 0));

export const JURNAL_BULK_HEADERS = [
  "Nomor", "Tanggal", "Status", "Tipe", "Lembaga", "Diinput Oleh", "Keterangan Jurnal",
  "Kode Akun", "Nama Akun", "Keterangan Baris", "Debit", "Kredit",
] as const;

// Export massal: 1 baris = 1 baris akun jurnal. Jurnal tanpa detail tetap muncul 1 baris.
export function buildJurnalBulkRows(
  jurnalList: JurnalExportHeader[],
  detailsByJurnalId: Record<string, JurnalExportDetail[] | undefined>,
  dikoreksiIds: Set<string> | undefined,
): JurnalCell[][] {
  const rows: JurnalCell[][] = [];
  for (const j of jurnalList) {
    const head: JurnalCell[] = [
      safeText(j.nomor),
      (j.tanggal || "").slice(0, 10),
      labelStatusJurnal(j.status),
      labelTipeJurnal(j.tipe, !!j.id && !!dikoreksiIds?.has(j.id)),
      safeText(j.departemen?.kode || "-"),
      safeText(labelPenginput(j)),
      safeText(j.keterangan),
    ];
    const details = sortDetails((j.id && detailsByJurnalId[j.id]) || []);
    if (details.length === 0) {
      rows.push([...head, "", "", "", 0, 0]);
      continue;
    }
    for (const d of details) {
      rows.push([
        ...head,
        safeText(d.akun_rekening?.kode),
        safeText(d.akun_rekening?.nama),
        safeText(d.keterangan),
        num(d.debit),
        num(d.kredit),
      ]);
    }
  }
  return rows;
}

// Export 1 jurnal: blok header, tabel akun, baris total (array-of-arrays untuk sheet).
export function buildJurnalSingleAoa(j: JurnalExportFull, dikoreksi = false): JurnalCell[][] {
  const details = sortDetails(j.details || []);
  const sumDebit = details.reduce((s, d) => s + num(d.debit), 0);
  const sumKredit = details.reduce((s, d) => s + num(d.kredit), 0);
  const totalDebit = num(j.total_debit) || sumDebit;
  const totalKredit = num(j.total_kredit) || sumKredit;
  const tanggal = j.tanggal ? format(parseISO(j.tanggal), "d MMMM yyyy", { locale: idLocale }) : "";

  return [
    ["Detail Jurnal Umum"],
    ["Nomor", safeText(j.nomor)],
    ["Tanggal", tanggal],
    ["Status", labelStatusJurnal(j.status)],
    ["Tipe", labelTipeJurnal(j.tipe, dikoreksi)],
    ["Lembaga", safeText(j.departemen?.kode || "-")],
    ["Diinput Oleh", safeText(labelPenginput(j))],
    ["Keterangan", safeText(j.keterangan)],
    [],
    ["Kode Akun", "Nama Akun", "Keterangan", "Debit", "Kredit"],
    ...details.map((d): JurnalCell[] => [
      safeText(d.akun_rekening?.kode),
      safeText(d.akun_rekening?.nama),
      safeText(d.keterangan),
      num(d.debit),
      num(d.kredit),
    ]),
    ["", "", "Total", totalDebit, totalKredit],
  ];
}

export function jurnalSingleFilename(nomor?: string | null): string {
  const slug = String(nomor || "tanpa-nomor").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `jurnal-${slug || "tanpa-nomor"}`;
}

// ─── Unduh file (butuh DOM) ───

function widths(aoa: JurnalCell[][]) {
  const cols = Math.max(0, ...aoa.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => ({
    wch: Math.min(Math.max(...aoa.map((r) => String(r[c] ?? "").length), 10) + 2, 50),
  }));
}

export function downloadAoaXlsx(aoa: JurnalCell[][], filename: string, sheetName: string) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Data");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

const csvCell = (v: JurnalCell) => {
  const t = String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function downloadAoaCsv(aoa: JurnalCell[][], filename: string) {
  const csv = aoa.map((r) => r.map(csvCell).join(",")).join("\r\n");
  // BOM supaya Excel membaca UTF-8 dengan benar.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
