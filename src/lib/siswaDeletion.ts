/**
 * Hapus siswa dengan penjaga riwayat.
 *
 * Penghapusan permanen hanya untuk data salah input (siswa tanpa riwayat apa pun).
 * Siswa yang sudah punya tagihan, pembayaran, kelas, tabungan, dst. tidak dihapus;
 * statusnya diubah (keluar, alumni, pindah, mengundurkan diri) agar riwayat tetap utuh.
 */

export interface RiwayatSiswaItem {
  tabel: string;
  jumlah: number;
}

export type HapusSiswaResult =
  | { ok: true }
  | { ok: false; alasan: "punya_riwayat"; riwayat: RiwayatSiswaItem[] };

/** Dilempar saat siswa tidak boleh dihapus karena punya riwayat data. */
export class SiswaPunyaRiwayatError extends Error {
  readonly riwayat: RiwayatSiswaItem[];

  constructor(riwayat: RiwayatSiswaItem[]) {
    super(`Siswa punya riwayat data: ${ringkasRiwayat(riwayat)}`);
    this.name = "SiswaPunyaRiwayatError";
    this.riwayat = riwayat;
  }
}

const LABEL_TABEL: Record<string, string> = {
  tagihan: "Tagihan",
  pembayaran: "Pembayaran",
  transaksi_midtrans_item: "Transaksi pembayaran online",
  tabungan_siswa: "Tabungan",
  kelas_siswa: "Riwayat kelas",
};

/** Nama tabel -> istilah yang dipahami petugas; tabel tak dikenal dibuat terbaca. */
export function labelRiwayat(tabel: string): string {
  const nama = tabel.includes(".") ? tabel.slice(tabel.lastIndexOf(".") + 1) : tabel;
  const dikenal = LABEL_TABEL[nama];
  if (dikenal) return dikenal;
  const teks = nama.replace(/_/g, " ").trim();
  return teks ? teks.charAt(0).toUpperCase() + teks.slice(1) : tabel;
}

const MAKS_JENIS_DITAMPILKAN = 3;

/** Contoh: "Tagihan (3), Pembayaran (2), dan 2 jenis lainnya". */
export function ringkasRiwayat(riwayat: RiwayatSiswaItem[]): string {
  const tampil = riwayat.slice(0, MAKS_JENIS_DITAMPILKAN).map((r) => `${labelRiwayat(r.tabel)} (${r.jumlah})`);
  const sisa = riwayat.length - MAKS_JENIS_DITAMPILKAN;
  if (sisa > 0) tampil.push(`dan ${sisa} jenis lainnya`);
  return tampil.join(", ");
}

function bacaRiwayat(raw: unknown): RiwayatSiswaItem[] | null {
  if (!Array.isArray(raw)) return null;
  const hasil: RiwayatSiswaItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { tabel, jumlah } = item as { tabel?: unknown; jumlah?: unknown };
    const n = typeof jumlah === "number" ? jumlah : typeof jumlah === "string" ? Number(jumlah) : NaN;
    if (typeof tabel !== "string" || !tabel.trim() || !Number.isFinite(n) || n <= 0) continue;
    hasil.push({ tabel: tabel.trim(), jumlah: n });
  }
  return hasil.sort((a, b) => b.jumlah - a.jumlah || a.tabel.localeCompare(b.tabel));
}

/** Memvalidasi respons RPC `hapus_siswa`; penolakan selain riwayat menjadi galat yang terbaca. */
export function normalisasiHasilHapusSiswa(raw: unknown): HapusSiswaResult {
  if (raw && typeof raw === "object") {
    const hasil = raw as { ok?: unknown; alasan?: unknown; riwayat?: unknown };
    if (hasil.ok === true) return { ok: true };
    if (hasil.ok === false) {
      if (hasil.alasan === "tidak_ditemukan") throw new Error("Siswa tidak ditemukan");
      if (hasil.alasan === "tidak_berwenang") throw new Error("Anda tidak berwenang menghapus siswa ini");
      if (hasil.alasan === "punya_riwayat") {
        const riwayat = bacaRiwayat(hasil.riwayat);
        if (riwayat) return { ok: false, alasan: "punya_riwayat", riwayat };
      }
    }
  }
  throw new Error("Respons hapus siswa tidak dikenali");
}

/** Pelanggaran foreign key Postgres (23503), mis. data baru muncul saat penghapusan berjalan. */
export function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code === "23503") return true;
  return typeof message === "string" && message.includes("violates foreign key constraint");
}
