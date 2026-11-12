/**
 * Filter lembaga untuk halaman "Rekap Kasir Saya". Dipakai bersama oleh tabel,
 * kartu statistik, laporan cetak/PDF, dan laporan Excel supaya semuanya
 * memakai himpunan baris yang sama. Tanpa dependensi.
 */

export const SEMUA_LEMBAGA = "__semua__";

export interface LembagaRow {
  id: string;
  jumlah: number;
  siswa_status: string | null;
  departemen_nama: string;
  departemen_kode: string | null;
}

export interface LembagaOption {
  key: string;
  label: string;
  count: number;
}

export interface StatistikRekap {
  jumlah_transaksi: number;
  total_penerimaan: number;
  transaksi_spmb: number;
  transaksi_siswa: number;
}

/** Kunci lembaga: kode bila ada, selain itu nama. */
export function kunciLembaga(row: Pick<LembagaRow, "departemen_nama" | "departemen_kode">): string {
  return row.departemen_kode?.trim() || row.departemen_nama;
}

/** Label sama dengan kolom Lembaga di tabel: "KODE — Nama". */
export function labelLembaga(row: Pick<LembagaRow, "departemen_nama" | "departemen_kode">): string {
  const kode = row.departemen_kode?.trim();
  return kode ? `${kode} — ${row.departemen_nama}` : row.departemen_nama;
}

/** Lembaga unik yang muncul di data, terurut menurut label. */
export function listLembaga(rows: LembagaRow[]): LembagaOption[] {
  const map = new Map<string, LembagaOption>();
  for (const row of rows) {
    const key = kunciLembaga(row);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { key, label: labelLembaga(row), count: 1 });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "id"));
}

export function filterByLembaga<T extends LembagaRow>(rows: T[], key: string): T[] {
  if (key === SEMUA_LEMBAGA) return rows;
  return rows.filter((row) => kunciLembaga(row) === key);
}

/** Pilihan yang tidak ada lagi di data (mis. tanggal diganti) kembali ke Semua Lembaga. */
export function resolveLembagaFilter(rows: LembagaRow[], key: string): string {
  if (key === SEMUA_LEMBAGA) return SEMUA_LEMBAGA;
  return rows.some((row) => kunciLembaga(row) === key) ? key : SEMUA_LEMBAGA;
}

/** Label lembaga terpilih untuk kop laporan; null bila Semua Lembaga. */
export function labelLembagaFilter(rows: LembagaRow[], key: string): string | null {
  if (key === SEMUA_LEMBAGA) return null;
  const row = rows.find((r) => kunciLembaga(r) === key);
  return row ? labelLembaga(row) : null;
}

export function hitungStatistikRekap(rows: LembagaRow[]): StatistikRekap {
  const spmb = rows.filter((row) => row.siswa_status === "calon").length;
  return {
    jumlah_transaksi: rows.length,
    total_penerimaan: rows.reduce((sum, row) => sum + row.jumlah, 0),
    transaksi_spmb: spmb,
    transaksi_siswa: rows.length - spmb,
  };
}
