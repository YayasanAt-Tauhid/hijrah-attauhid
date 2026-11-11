// Label tahun buku untuk judul laporan keuangan.
// Tahun buku yang masih berjalan diberi tanggal batas, supaya angka sementara
// tidak terbaca sebagai angka setahun penuh.

export interface TahunBukuRingkas {
  nama: string;
  tanggal_mulai?: string | null;
  tanggal_selesai?: string | null;
  ditutup?: boolean | null;
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** Tanggal lokal perangkat dalam bentuk YYYY-MM-DD (bukan UTC). */
export function tanggalLokalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${h}`;
}

function tanggalPanjang(iso: string): string {
  const [y, m, h] = iso.split("-").map(Number);
  return `${h} ${BULAN[m - 1]} ${y}`;
}

/**
 * "Tahun 2026" untuk tahun buku yang sudah lewat, sudah ditutup, atau belum mulai;
 * "Tahun 2026 (berjalan, s.d. 11 November 2026)" untuk tahun buku yang sedang berjalan.
 */
export function labelTahunBuku(
  ta: TahunBukuRingkas | undefined | null,
  hariIni: string = tanggalLokalISO(),
  cadangan = "",
): string {
  if (!ta) return cadangan;
  const { nama, tanggal_mulai, tanggal_selesai, ditutup } = ta;
  if (ditutup || !tanggal_mulai || !tanggal_selesai) return nama;
  if (hariIni < tanggal_mulai || hariIni > tanggal_selesai) return nama;
  return `${nama} (berjalan, s.d. ${tanggalPanjang(hariIni)})`;
}
