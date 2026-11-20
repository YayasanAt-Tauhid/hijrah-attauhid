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

export interface KelasSiswaRingkas {
  aktif: boolean | null;
  kelas: { nama: string } | null;
}

/** Nama kelas yang sedang aktif; kelas historis diabaikan. */
export function kelasAktifNama(kelasSiswa: KelasSiswaRingkas[] | null | undefined): string | null {
  const aktif = (kelasSiswa ?? []).find((ks) => ks.aktif && ks.kelas?.nama);
  return aktif?.kelas?.nama ?? null;
}

export interface LabelSiswaInternalSpmbInput {
  kelasNama?: string | null;
  /** Kode lembaga asal (tempat siswa sekarang bersekolah), mis. SD. */
  asalKode?: string | null;
  /** Kode lembaga tujuan SPMB, mis. SMP. */
  tujuanKode?: string | null;
}

/**
 * Label hasil pencarian halaman Pembayaran SPMB untuk siswa internal (naik
 * jenjang). Contoh: "Siswa internal · Kelas 6C · SD → SMP". Berguna supaya kasir
 * dapat membedakan siswa internal dari calon baru dan dari nama kembar.
 */
export function labelSiswaInternalSpmb(input: LabelSiswaInternalSpmbInput): string {
  const bagian = ["Siswa internal"];
  if (input.kelasNama) bagian.push(`Kelas ${input.kelasNama}`);
  if (input.asalKode) bagian.push(input.asalKode);
  const label = bagian.join(" · ");
  return input.tujuanKode ? `${label} → ${input.tujuanKode}` : label;
}
