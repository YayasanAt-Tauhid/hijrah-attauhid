/**
 * Filter jenis pembayaran untuk halaman "Rekap Kasir Saya", berpasangan dengan
 * filter lembaga (rekapKasirLembaga.ts). Daftar jenis dihitung dari baris yang
 * sudah difilter lembaga, sehingga hanya jenis di lembaga terpilih yang muncul.
 * Tanpa dependensi.
 */
import type { LembagaRow } from "./rekapKasirLembaga";

export const SEMUA_JENIS = "__semua_jenis__";

export interface JenisRow extends LembagaRow {
  jenis_nama: string;
}

export interface JenisOption {
  key: string;
  label: string;
  count: number;
}

/** Jenis unik yang muncul di data, terurut menurut nama. */
export function listJenis(rows: JenisRow[]): JenisOption[] {
  const map = new Map<string, JenisOption>();
  for (const row of rows) {
    const existing = map.get(row.jenis_nama);
    if (existing) existing.count += 1;
    else map.set(row.jenis_nama, { key: row.jenis_nama, label: row.jenis_nama, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "id"));
}

export function filterByJenis<T extends JenisRow>(rows: T[], key: string): T[] {
  if (key === SEMUA_JENIS) return rows;
  return rows.filter((row) => row.jenis_nama === key);
}

/** Pilihan yang tidak ada lagi di data (mis. lembaga atau tanggal diganti) kembali ke Semua Jenis. */
export function resolveJenisFilter(rows: JenisRow[], key: string): string {
  if (key === SEMUA_JENIS) return SEMUA_JENIS;
  return rows.some((row) => row.jenis_nama === key) ? key : SEMUA_JENIS;
}

/** Nama jenis terpilih untuk kop laporan; null bila Semua Jenis. */
export function labelJenisFilter(rows: JenisRow[], key: string): string | null {
  if (key === SEMUA_JENIS) return null;
  return rows.some((row) => row.jenis_nama === key) ? key : null;
}
