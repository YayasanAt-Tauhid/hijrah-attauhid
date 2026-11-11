/**
 * Perhitungan "Rekap Kasir Saya" yang dipakai bersama oleh laporan Excel dan
 * tampilan cetak/PDF, supaya angka keduanya selalu identik. Tanpa dependensi.
 */

export interface RekapKasirItem {
  id: string;
  jumlah: number;
  tanggal_bayar: string | null;
  bulan: number | null;
  keterangan: string | null;
  siswa_nama: string;
  siswa_nis: string | null;
  siswa_nisn: string | null;
  siswa_status: string | null;
  kelas_nama: string | null;
  jenis_nama: string;
  departemen_nama: string;
  departemen_kode: string | null;
  jurnal_nomor: string | null;
  receipt_number: string | null;
  payment_method: string | null;
  periode_label: string | null;
}

export interface RekapKasirAgg {
  count: number;
  total: number;
}

export interface RekapKasirSummary {
  /** Transaksi terurut: tanggal, lalu nomor kwitansi (tanpa kwitansi di akhir). */
  items: RekapKasirItem[];
  lembaga: Array<RekapKasirAgg & { nama: string; jenis: Array<RekapKasirAgg & { nama: string }> }>;
  methods: string[];
  perMetode: Array<RekapKasirAgg & { metode: string }>;
  /** perMetode mengikuti urutan `methods`. */
  perTanggal: Array<RekapKasirAgg & { tanggal: string; perMetode: number[] }>;
  count: number;
  total: number;
}

export const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const METODE_TIDAK_TERCATAT = "Tidak tercatat";
const METODE_ORDER = ["Tunai", "Transfer", "Online (Midtrans)"];

/** Satukan ejaan metode bayar yang tersimpan di kwitansi. */
export function normalizePaymentMethod(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return METODE_TIDAK_TERCATAT;
  const lower = text.toLowerCase();
  if (lower.includes("tunai") || lower === "cash") return "Tunai";
  if (lower.includes("transfer") || lower.includes("bank")) return "Transfer";
  if (lower.includes("midtrans") || lower.includes("qris") || lower.includes("online")) return "Online (Midtrans)";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function tanggalPendek(iso: string | null): string {
  const match = iso ? ISO_DATE.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

export function tanggalPanjang(iso: string): string {
  const match = ISO_DATE.exec(iso);
  return match ? `${Number(match[3])} ${NAMA_BULAN[Number(match[2]) - 1]} ${match[1]}` : iso;
}

export function periodeRekap(dari: string, sampai: string): string {
  return dari === sampai ? tanggalPanjang(dari) : `${tanggalPanjang(dari)} s.d. ${tanggalPanjang(sampai)}`;
}

export function waktuCetak(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Label periode tagihan; jatuh ke nama bulan + tahun transaksi bila kwitansi tidak menyimpannya. */
export function periodeLabel(item: RekapKasirItem): string {
  if (item.periode_label?.trim()) return item.periode_label.trim();
  if (item.bulan && item.bulan >= 1 && item.bulan <= 12) {
    const tahun = item.tanggal_bayar ? ISO_DATE.exec(item.tanggal_bayar)?.[1] : undefined;
    return tahun ? `${NAMA_BULAN[item.bulan - 1]} ${tahun}` : NAMA_BULAN[item.bulan - 1];
  }
  return "-";
}

export function kelasLabel(item: RekapKasirItem): string {
  if (item.siswa_status === "calon") return "Calon Murid";
  return item.kelas_nama?.trim() || "-";
}

export function identitasLabel(item: RekapKasirItem): string {
  return [item.siswa_nis, item.siswa_nisn].map((v) => v?.trim()).filter(Boolean).join(" / ") || "-";
}

function sortItems(items: RekapKasirItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const tanggal = (a.item.tanggal_bayar ?? "").localeCompare(b.item.tanggal_bayar ?? "");
      if (tanggal !== 0) return tanggal;
      const ra = a.item.receipt_number ?? "￿";
      const rb = b.item.receipt_number ?? "￿";
      if (ra !== rb) return ra.localeCompare(rb);
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function methodOrder(methods: Iterable<string>): string[] {
  const rank = (m: string) => (m === METODE_TIDAK_TERCATAT ? 1000 : METODE_ORDER.indexOf(m) === -1 ? 500 : METODE_ORDER.indexOf(m));
  return [...new Set(methods)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const byName = (a: string, b: string) => a.localeCompare(b);

export function summarizeRekapKasir(input: RekapKasirItem[]): RekapKasirSummary {
  const items = sortItems(input);
  const nameOf = (value: string | null | undefined) => value?.trim() || "-";

  const lembagaMap = new Map<string, Map<string, RekapKasirAgg>>();
  const metodeMap = new Map<string, RekapKasirAgg>();
  const tanggalMap = new Map<string, RekapKasirItem[]>();
  for (const item of items) {
    const lembaga = nameOf(item.departemen_nama);
    const jenis = nameOf(item.jenis_nama);
    const byJenis = lembagaMap.get(lembaga) ?? new Map<string, RekapKasirAgg>();
    const jenisAgg = byJenis.get(jenis) ?? { count: 0, total: 0 };
    jenisAgg.count += 1;
    jenisAgg.total += item.jumlah;
    byJenis.set(jenis, jenisAgg);
    lembagaMap.set(lembaga, byJenis);

    const metode = normalizePaymentMethod(item.payment_method);
    const metodeAgg = metodeMap.get(metode) ?? { count: 0, total: 0 };
    metodeAgg.count += 1;
    metodeAgg.total += item.jumlah;
    metodeMap.set(metode, metodeAgg);

    const tanggal = item.tanggal_bayar ?? "";
    tanggalMap.set(tanggal, [...(tanggalMap.get(tanggal) ?? []), item]);
  }

  const methods = methodOrder(metodeMap.keys());
  const lembaga = [...lembagaMap.keys()].sort(byName).map((nama) => {
    const jenis = [...lembagaMap.get(nama)!.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([jenisNama, agg]) => ({ nama: jenisNama, ...agg }));
    return {
      nama,
      count: jenis.reduce((sum, j) => sum + j.count, 0),
      total: jenis.reduce((sum, j) => sum + j.total, 0),
      jenis,
    };
  });
  const perTanggal = [...tanggalMap.keys()].sort().map((tanggal) => {
    const dayItems = tanggalMap.get(tanggal)!;
    return {
      tanggal,
      count: dayItems.length,
      perMetode: methods.map((metode) => dayItems
        .filter((item) => normalizePaymentMethod(item.payment_method) === metode)
        .reduce((sum, item) => sum + item.jumlah, 0)),
      total: dayItems.reduce((sum, item) => sum + item.jumlah, 0),
    };
  });

  return {
    items,
    lembaga,
    methods,
    perMetode: methods.map((metode) => ({ metode, ...metodeMap.get(metode)! })),
    perTanggal,
    count: items.length,
    total: items.reduce((sum, item) => sum + item.jumlah, 0),
  };
}
