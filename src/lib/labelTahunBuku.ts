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

export interface TahunBukuPilihan extends TahunBukuRingkas {
  aktif?: boolean | null;
}

/**
 * Tahun buku yang dibuka laporan sebagai bawaan.
 * Jangan memakai "tanggal_selesai terbaru": tahun buku masa depan (mis. 2027/2028 untuk rencana
 * tagihan) belum punya jurnal sehingga laporan tampil nol. Urutan pilihan: tahun buku aktif;
 * bila tidak ada, semua tahun buku. Dari kandidat itu: yang mencakup hari ini, lalu yang terakhir
 * sudah dimulai, lalu yang paling awal.
 */
export function pilihTahunBukuBawaan<T extends TahunBukuPilihan>(
  daftar: readonly T[],
  hariIni: string = tanggalLokalISO(),
): T | undefined {
  const lengkap = daftar.filter((t) => t.tanggal_mulai && t.tanggal_selesai);
  const aktif = lengkap.filter((t) => t.aktif);
  const kandidat = aktif.length > 0 ? aktif : lengkap;
  if (kandidat.length === 0) return undefined;
  const mulai = (t: T) => t.tanggal_mulai as string;
  const selesai = (t: T) => t.tanggal_selesai as string;
  const berjalan = kandidat.find((t) => mulai(t) <= hariIni && hariIni <= selesai(t));
  if (berjalan) return berjalan;
  const sudahMulai = kandidat
    .filter((t) => mulai(t) <= hariIni)
    .sort((a, b) => mulai(b).localeCompare(mulai(a)));
  if (sudahMulai.length > 0) return sudahMulai[0];
  return [...kandidat].sort((a, b) => mulai(a).localeCompare(mulai(b)))[0];
}
