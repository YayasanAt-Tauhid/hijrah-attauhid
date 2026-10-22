export type AlumniAsrama = "none" | "asrama" | "non_asrama";
export type FaseMta = "smp" | "sma";

export interface UangPangkalPreview {
  siswa_id: string;
  siswa_detail_id: string;
  nama: string;
  tahun_akademik_id: string;
  tahun_nama: string;
  departemen_kode: string;
  program: string;
  status_asrama: string | null;
  sumber_sk: string;
  bruto_acuan: number;
  keringanan_alumni: number;
  neto_setelah_disetujui: number;
  preview_hash: string;
  tagihan: null | { id: string; status: string; nominal_bruto: number; nominal: number; nominal_diskon: number; total_bayar: number };
  verifikasi: null | { id: string; diverifikasi_at: string; nominal_bruto: number; siswa_diskon_id: string | null; alumni_asrama: AlumniAsrama; fase_mta: FaseMta | null; keringanan_diajukan: number };
}

export interface UangPangkalResult {
  success: boolean;
  skipped: boolean;
  tagihan_id: string;
  siswa_diskon_id: string | null;
  status_keringanan?: string | null;
}
