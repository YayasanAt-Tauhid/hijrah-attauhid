import { UNIFORM_SIZES } from "@/lib/ukuranSeragam";
import type { UangPangkalInfo } from "@/lib/seragamUangPangkal";

export type JenisKelaminHarga = "L" | "P" | "semua";

export type HargaSeragamVendor = {
  id: string;
  tahun_ajaran_id: string;
  departemen_id: string;
  jenis_kelamin: JenisKelaminHarga;
  nama_stel: string;
  /** Kosong = semua ukuran. */
  ukuran: string[];
  /** Rupiah, bilangan bulat. */
  harga: number;
  catatan?: string | null;
  aktif: boolean;
};

export type HargaInput = Omit<HargaSeragamVendor, "id" | "aktif"> & { aktif?: boolean };

/** Bagian baris yang menentukan tabrakan; dipakai baris tersimpan maupun isian form. */
export type HargaKunci = Pick<HargaSeragamVendor, "tahun_ajaran_id" | "departemen_id" | "jenis_kelamin" | "nama_stel" | "ukuran"> & {
  aktif?: boolean;
};

const UKURAN_ALIAS: Record<string, string> = { X3L: "3XL", X4L: "4XL", X5L: "5XL" };

const UKURAN_DASAR_KUSTOM = UNIFORM_SIZES.filter((u) => u !== "ALL SIZE");
const POLA_KUSTOM = /^KUSTOM\s*\(\s*([^()]*?)\s*\)$/;

/**
 * Ukuran kustom ditulis "KUSTOM (XL)": dijahit khusus, tetapi dihargai seperti ukuran dasar di dalam kurung.
 * Mengembalikan ukuran dasarnya, atau null bila bukan notasi kustom yang sah (dasar harus ukuran baku selain ALL SIZE).
 */
export function ukuranDasarKustom(value: string): string | null {
  const cocok = POLA_KUSTOM.exec(value.trim().replace(/\s+/g, " ").toUpperCase());
  if (!cocok) return null;
  const dasar = UKURAN_ALIAS[cocok[1]] ?? cocok[1];
  return UKURAN_DASAR_KUSTOM.includes(dasar) ? dasar : null;
}

export function normalizeUkuran(value: string): string {
  const v = value.trim().replace(/\s+/g, " ").toUpperCase();
  const dasar = ukuranDasarKustom(v);
  if (dasar) return `KUSTOM (${dasar})`;
  return UKURAN_ALIAS[v] ?? v;
}

const urutanUkuran = (u: string) => {
  const index = UNIFORM_SIZES.indexOf(u);
  return index === -1 ? UNIFORM_SIZES.length : index;
};
export const compareUkuran = (a: string, b: string) => urutanUkuran(a) - urutanUkuran(b) || a.localeCompare(b);

export function normalizeUkuranList(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeUkuran).filter(Boolean))].sort(compareUkuran);
}

export function normalizeNamaStel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** TK memesan 5 stel, lembaga lain 4 stel (form siswa tetap menyimpan 5 slot). */
export function jumlahStelPesanan(kodeLembaga: string): number {
  return kodeLembaga === "TK" ? 5 : 4;
}

/** Sama dengan Monitoring Pembayaran SPMB: minimum = ceil(total / 4). */
export function layakDipesan(info: UangPangkalInfo | null | undefined): boolean {
  if (!info) return false;
  if (info.status === "belum_ada_tagihan" || info.status === "perlu_verifikasi") return false;
  if (!(info.total > 0)) return false;
  return info.paid >= Math.ceil(info.total / 4);
}

export type CariHargaInput = {
  tahunAjaranId: string;
  lembagaId: string;
  jenisKelamin: string;
  nama: string;
  ukuran: string;
};

/** Baris dengan jenis kelamin spesifik dan ukuran spesifik menang atas yang umum. */
export function cariHarga(harga: readonly HargaSeragamVendor[], q: CariHargaInput): HargaSeragamVendor | null {
  const nama = normalizeNamaStel(q.nama);
  const ukuran = normalizeUkuran(q.ukuran);
  // Ukuran kustom dicari harganya lewat ukuran dasar; tampilan dan rekap tetap memakai ukuran kustomnya.
  const ukuranPatokan = ukuranDasarKustom(ukuran) ?? ukuran;
  let best: HargaSeragamVendor | null = null;
  let bestScore = -1;
  for (const h of harga) {
    if (!h.aktif || h.tahun_ajaran_id !== q.tahunAjaranId || h.departemen_id !== q.lembagaId) continue;
    if (normalizeNamaStel(h.nama_stel) !== nama) continue;
    if (h.jenis_kelamin !== "semua" && h.jenis_kelamin !== q.jenisKelamin) continue;
    const ukuranHarga = normalizeUkuranList(h.ukuran);
    if (ukuranHarga.length > 0 && !ukuranHarga.includes(ukuranPatokan)) continue;
    const score = (h.jenis_kelamin !== "semua" ? 1 : 0) + (ukuranHarga.length > 0 ? 1 : 0);
    if (score > bestScore || (score === bestScore && best !== null && h.id < best.id)) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

const jenisKelaminBeririsan = (a: JenisKelaminHarga, b: JenisKelaminHarga) => a === "semua" || b === "semua" || a === b;
function ukuranBeririsan(a: readonly string[], b: readonly string[]) {
  const x = normalizeUkuranList(a);
  const y = normalizeUkuranList(b);
  return x.length === 0 || y.length === 0 || x.some((u) => y.includes(u));
}

/** Cermin pemicu basis data: dua baris aktif pada stel yang sama tidak boleh beririsan. */
export function hargaBertabrakan(a: HargaKunci, b: HargaKunci): boolean {
  if (!(a.aktif ?? true) || !(b.aktif ?? true)) return false;
  return a.tahun_ajaran_id === b.tahun_ajaran_id
    && a.departemen_id === b.departemen_id
    && normalizeNamaStel(a.nama_stel) === normalizeNamaStel(b.nama_stel)
    && jenisKelaminBeririsan(a.jenis_kelamin, b.jenis_kelamin)
    && ukuranBeririsan(a.ukuran, b.ukuran);
}

export function cariBentrok(calon: HargaKunci & { id?: string }, daftar: readonly HargaSeragamVendor[]): HargaSeragamVendor | null {
  return daftar.find((h) => h.id !== calon.id && hargaBertabrakan(calon, h)) ?? null;
}

export function validasiHarga(input: Pick<HargaInput, "nama_stel" | "harga" | "jenis_kelamin">): string | null {
  if (!input.nama_stel.trim()) return "Isi nama stel.";
  if (input.nama_stel.trim().length > 80) return "Nama stel maksimal 80 karakter.";
  if (!["L", "P", "semua"].includes(input.jenis_kelamin)) return "Pilih jenis kelamin: L, P, atau semua.";
  if (!Number.isInteger(input.harga) || input.harga < 0) return "Harga harus bilangan bulat rupiah, minimal 0.";
  return null;
}

/** Bahan salinan harga antar tahun; kosong bila tahun tujuan sudah punya baris untuk lembaga itu. */
export function salinanHarga(
  sumber: readonly HargaSeragamVendor[],
  target: { tahunAjaranId: string; departemenId: string; existing: readonly HargaSeragamVendor[] },
): HargaInput[] {
  const sudahAda = target.existing.some(
    (h) => h.tahun_ajaran_id === target.tahunAjaranId && h.departemen_id === target.departemenId,
  );
  if (sudahAda) return [];
  return sumber
    .filter((h) => h.aktif && h.departemen_id === target.departemenId)
    .map((h) => ({
      tahun_ajaran_id: target.tahunAjaranId,
      departemen_id: h.departemen_id,
      jenis_kelamin: h.jenis_kelamin,
      nama_stel: h.nama_stel,
      ukuran: [...h.ukuran],
      harga: h.harga,
      catatan: h.catatan ?? null,
      aktif: true,
    }));
}

export function pesanGalatHarga(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Terjadi kesalahan.";
  if (error.code === "23P01") return "Harga bertabrakan dengan baris aktif lain (stel, jenis kelamin, dan ukuran beririsan).";
  if (error.code === "42501") return "Anda tidak berhak mengubah harga seragam.";
  if (error.code === "23514") return "Isian harga tidak valid.";
  return error.message || "Terjadi kesalahan.";
}
