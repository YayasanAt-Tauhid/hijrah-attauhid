// Logika murni halaman Proyeksi Tagihan SPP (/keuangan/proyeksi-tagihan).
// Sumber data: RPC public.ringkasan_tagihan_periode (satu baris per lembaga x bulan).

export interface BarisRingkasan {
  departemen_id: string;
  departemen_kode: string;
  tahun: number;
  bulan: number;
  jumlah_siswa: number;
  jumlah_tagihan: number;
  bruto: number;
  potongan: number;
  neto: number;
  terbayar: number;
  sisa: number;
}

export interface TotalTagihan {
  jumlahTagihan: number;
  bruto: number;
  potongan: number;
  neto: number;
  terbayar: number;
  sisa: number;
}

export interface MatriksLembaga extends TotalTagihan {
  departemen_id: string;
  kode: string;
  /** Neto per bulan, indeks 0 = Januari ... 11 = Desember (0 bila tidak ada tagihan). */
  perBulan: number[];
}

export interface Matriks {
  lembaga: MatriksLembaga[];
  netoPerBulan: number[];
  total: TotalTagihan;
}

// Rustbase mengembalikan kolom numeric sebagai string (mis. "264500000.00").
const angka = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function normalisasiBaris(r: Record<string, unknown>): BarisRingkasan {
  return {
    departemen_id: String(r.departemen_id ?? ""),
    departemen_kode: String(r.departemen_kode ?? ""),
    tahun: angka(r.tahun),
    bulan: angka(r.bulan),
    jumlah_siswa: angka(r.jumlah_siswa),
    jumlah_tagihan: angka(r.jumlah_tagihan),
    bruto: angka(r.bruto),
    potongan: angka(r.potongan),
    neto: angka(r.neto),
    terbayar: angka(r.terbayar),
    sisa: angka(r.sisa),
  };
}

const totalKosong = (): TotalTagihan => ({ jumlahTagihan: 0, bruto: 0, potongan: 0, neto: 0, terbayar: 0, sisa: 0 });

function tambah(total: TotalTagihan, b: BarisRingkasan) {
  total.jumlahTagihan += b.jumlah_tagihan;
  total.bruto += b.bruto;
  total.potongan += b.potongan;
  total.neto += b.neto;
  total.terbayar += b.terbayar;
  total.sisa += b.sisa;
}

export function susunMatriks(baris: BarisRingkasan[]): Matriks {
  const perLembaga = new Map<string, MatriksLembaga>();
  const netoPerBulan: number[] = Array(12).fill(0);
  const total = totalKosong();

  for (const b of baris) {
    if (b.bulan < 1 || b.bulan > 12) continue;
    let l = perLembaga.get(b.departemen_id);
    if (!l) {
      l = { departemen_id: b.departemen_id, kode: b.departemen_kode, perBulan: Array(12).fill(0), ...totalKosong() };
      perLembaga.set(b.departemen_id, l);
    }
    l.perBulan[b.bulan - 1] += b.neto;
    tambah(l, b);
    netoPerBulan[b.bulan - 1] += b.neto;
    tambah(total, b);
  }

  const lembaga = [...perLembaga.values()].sort((a, b) => a.kode.localeCompare(b.kode, "id-ID"));
  return { lembaga, netoPerBulan, total };
}

export function ringkasTahun(m: Matriks): {
  totalNeto: number;
  rataPerBulan: number;
  bulanTertinggi: { bulan: number; nilai: number } | null;
} {
  const bulanAda = m.netoPerBulan.filter((v) => v > 0).length;
  let tertinggi: { bulan: number; nilai: number } | null = null;
  m.netoPerBulan.forEach((nilai, i) => {
    if (nilai > 0 && (tertinggi === null || nilai > tertinggi.nilai)) tertinggi = { bulan: i + 1, nilai };
  });
  return {
    totalNeto: m.total.neto,
    rataPerBulan: bulanAda > 0 ? m.total.neto / bulanAda : 0,
    bulanTertinggi: tertinggi,
  };
}
