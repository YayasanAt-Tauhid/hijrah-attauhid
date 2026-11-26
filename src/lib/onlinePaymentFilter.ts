// Filter tanggal untuk halaman Keuangan > Online Payment.
// Batas hari dihitung dalam WIB (+07:00) supaya transaksi pukul 00.00-07.00 WIB tidak
// masuk ke hari yang salah (tanpa zona waktu, database menafsirkannya di zona waktunya sendiri).

export type KolomTanggalFilter = "created_at" | "paid_at";

export const KOLOM_TANGGAL_LABEL: Record<KolomTanggalFilter, string> = {
  created_at: "Tanggal dibuat",
  paid_at: "Tanggal dibayar",
};

const FORMAT_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

// Tanggal kalender valid (menolak mis. 2026-13-40 atau 2026-02-30).
function tanggalValid(nilai: string): boolean {
  const m = FORMAT_TANGGAL.exec(nilai);
  if (!m) return false;
  const [tahun, bulan, hari] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  return d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 && d.getUTCDate() === hari;
}

export function rentangTanggalWib(dari: string, sampai: string): { gte?: string; lte?: string } {
  const hasil: { gte?: string; lte?: string } = {};
  if (tanggalValid(dari)) hasil.gte = `${dari}T00:00:00+07:00`;
  if (tanggalValid(sampai)) hasil.lte = `${sampai}T23:59:59.999+07:00`;
  return hasil;
}

export interface FilterTanggal {
  kolom: KolomTanggalFilter;
  gte?: string;
  lte?: string;
  // true: hanya transaksi yang kolomnya terisi (paid_at kosong = belum lunas, tidak ikut).
  hanyaTerisi: boolean;
}

export function susunFilterTanggal(kolom: KolomTanggalFilter, dari: string, sampai: string): FilterTanggal {
  return { kolom, ...rentangTanggalWib(dari, sampai), hanyaTerisi: kolom === "paid_at" };
}
