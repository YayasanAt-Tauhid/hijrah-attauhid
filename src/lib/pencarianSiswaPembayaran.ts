export interface LayakTampilInput {
  status: string | null;
  /** Lulus seleksi SPMB dan terhubung ke gelombang (hanya relevan untuk calon/diterima). */
  lulusSpmb: boolean;
  /** Punya tagihan yang masih bisa dibayar (belum_bayar/sebagian/terjadwal). */
  punyaTagihanTerbuka: boolean;
  includeNonaktifWithOpenBills: boolean;
  includeCalonLulus: boolean;
}

const STATUS_CALON = ["calon", "diterima"];

/**
 * Aturan tampil hasil pencarian siswa di loket Input Pembayaran:
 * - aktif: selalu tampil;
 * - calon/diterima: tampil hanya bila lulus SPMB. Tagihan terbuka tidak
 *   disyaratkan, supaya siswa yang sudah melunasi semuanya tetap bisa dicari
 *   (untuk cek riwayat dan kuitansi);
 * - keluar/alumni/pindah: tampil hanya bila masih punya tagihan terbuka.
 */
export function layakTampilDiPencarianPembayaran(input: LayakTampilInput): boolean {
  const calon = STATUS_CALON.includes(String(input.status));
  if (calon && input.includeCalonLulus && !input.lulusSpmb) return false;
  if (calon) return true;
  if (
    (input.includeNonaktifWithOpenBills || input.includeCalonLulus) &&
    input.status !== "aktif" &&
    !input.punyaTagihanTerbuka
  ) {
    return false;
  }
  return true;
}
