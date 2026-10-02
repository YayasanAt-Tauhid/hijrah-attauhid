/**
 * @file keuangan.ts
 * Domain types untuk modul Keuangan Hijrah At-Tauhid.
 * Semua tipe di sini di-derive dari Database types (types.ts) — tidak ada duplikasi manual.
 */

import type { Database } from "@/integrations/supabase/types";

// ─── Row aliases ───────────────────────────────────────────────────────────────
export type Pembayaran = Database["public"]["Tables"]["pembayaran"]["Row"];
export type Tagihan    = Database["public"]["Tables"]["tagihan"]["Row"];
export type Jurnal     = Database["public"]["Tables"]["jurnal"]["Row"];
export type JurnalDetail = Database["public"]["Tables"]["jurnal_detail"]["Row"];
export type JenisPembayaran = Database["public"]["Tables"]["jenis_pembayaran"]["Row"];
export type Siswa      = Database["public"]["Tables"]["siswa"]["Row"];

// ─── Enriched / joined types ──────────────────────────────────────────────────

/** Siswa dengan kelas aktif, dipakai di form pencarian */
export interface SiswaWithKelas extends Pick<Siswa, "id" | "nis" | "nisn" | "nama" | "foto_url" | "status"> {
  kelas_siswa: Array<{
    kelas_id: string;
    kelas: {
      id: string;
      nama: string;
      departemen_id: string;
    } | null;
  }>;
}

/** Riwayat pembayaran per siswa (untuk tampilan tabel) */
export interface PembayaranWithJenis extends Omit<Pembayaran, "jenis_id"> {
  jenis_pembayaran: Pick<JenisPembayaran, "id" | "nama" | "tipe"> | null;
}

/** Tagihan dengan relasi lengkap */
export interface TagihanFull extends Tagihan {
  siswa: Pick<Siswa, "id" | "nama" | "nis"> | null;
  jenis: Pick<JenisPembayaran, "id" | "nama" | "tipe"> | null;
}

// ─── Request / Response types untuk Edge Function ────────────────────────────

/** Payload yang dikirim ke Edge Function `proses-pembayaran` */
export interface ProsesPembayaranRequest {
  siswa_id: string;
  jenis_id: string;
  /** 0 untuk tipe "sekali", 1-12 untuk tipe "bulanan" */
  bulan: number;
  jumlah: number;
  tanggal_bayar: string;        // format: "yyyy-MM-dd"
  keterangan?: string;
  departemen_id?: string;
  tahun_ajaran_id: string;
  /** true jika pembayaran untuk tahun ajaran yang belum aktif */
  is_bayar_dimuka: boolean;
  /** id tagihan existing jika ada piutang yang perlu dilunasi */
  tagihan_id?: string;
  /** ID kuitansi yang sama untuk beberapa item dalam satu sesi pembayaran. */
  receipt_id?: string;
}

/** Response dari Edge Function `proses-pembayaran` */
export interface ProsesPembayaranResponse {
  success: true;
  pembayaran_id: string;
  jurnal_id: string;
  nomor_jurnal: string;
  receipt_id: string;
  receipt_number: string;
}

// ─── Form state types ─────────────────────────────────────────────────────────

/** State form input pembayaran (menggantikan useState<any> yang tersebar) */
export interface FormPembayaran {
  jenisId: string;
  bulan: number;
  jumlah: string;
  tanggalBayar: string;
  keterangan: string;
}

export const FORM_PEMBAYARAN_DEFAULT: FormPembayaran = {
  jenisId: "",
  bulan: new Date().getMonth() + 1,
  jumlah: "",
  tanggalBayar: new Date().toISOString().split("T")[0],
  keterangan: "",
};

// ─── Status helpers ───────────────────────────────────────────────────────────

export type StatusTagihan = "belum_bayar" | "lunas";
export type TipePembayaran = "bulanan" | "sekali";

export function isTipeSekali(tipe: string): tipe is "sekali" {
  return tipe === "sekali";
}
