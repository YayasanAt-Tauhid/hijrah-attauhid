// Logika murni halaman Buku Besar (/keuangan/buku-besar): periode, saldo berjalan,
// pengelompokan per akun, dan builder baris export. Tanpa DOM supaya bisa dites.
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { safeText, type JurnalCell } from "@/lib/jurnalExport";

// Saldo awal di database dihitung per TAHUN KALENDER (saldo_awal_isak35 per tahun +
// mutasi sejak 1 Januari), jadi pilihan bulan harus berurutan Januari–Desember.
export const BULAN_KALENDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Hanya tahun 4 digit yang wajar. Nilai antara saat mengetik ("2", "20", "202") ditolak
// supaya tidak memicu query / format tanggal dengan nilai tidak valid.
export function parseTahunInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 2000 && n <= 2100 ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function akhirBulan(tahun: number, bulan: number): string {
  const lastDay = new Date(tahun, bulan, 0).getDate();
  return `${tahun}-${pad(bulan)}-${pad(lastDay)}`;
}

// Bukan union terdiskriminasi: tsconfig repo memakai strictNullChecks=false sehingga
// penyempitan lewat `valid` tidak bekerja. valid=true → tglAwal/tglAkhir terisi;
// valid=false → alasan terisi.
export interface PeriodeBukuBesar {
  valid: boolean;
  tglAwal?: string;
  tglAkhir?: string;
  alasan?: "tahun" | "urutan";
}

export function periodeBukuBesar(tahun: number | null, bulanDari: number, bulanSampai: number): PeriodeBukuBesar {
  if (tahun == null) return { valid: false, alasan: "tahun" };
  if (bulanDari > bulanSampai) return { valid: false, alasan: "urutan" };
  return { valid: true, tglAwal: `${tahun}-${pad(bulanDari)}-01`, tglAkhir: akhirBulan(tahun, bulanSampai) };
}

export function labelPeriode(tglAwal: string, tglAkhir: string): string {
  const f = (s: string) => format(parseISO(s), "d MMMM yyyy", { locale: idLocale });
  return `${f(tglAwal)} s/d ${f(tglAkhir)}`;
}

export interface MutasiBB {
  tanggal: string;
  nomor: string;
  lembaga: string;
  keterangan: string;
  debit: number;
  kredit: number;
  tipe: string;
}
export type MutasiBBSaldo = MutasiBB & { saldo: number };

export interface AkunBB {
  id: string;
  kode: string;
  nama: string;
  saldo_normal?: string | null;
  jenis?: string | null;
  aktif?: boolean | null;
}

export function hitungSaldoBerjalan<T extends { debit: number; kredit: number }>(
  saldoAwal: number,
  mutasi: T[],
  saldoNormal?: string | null,
): (T & { saldo: number })[] {
  const debitNormal = saldoNormal !== "K";
  let saldo = saldoAwal;
  return mutasi.map((d) => {
    saldo += debitNormal ? d.debit - d.kredit : d.kredit - d.debit;
    return { ...d, saldo };
  });
}

export interface GroupAkunBB {
  akun: AkunBB;
  saldoAwal: number;
  rows: MutasiBBSaldo[];
  totalDebit: number;
  totalKredit: number;
  saldoAkhir: number;
}

// Kelompokkan mutasi semua akun per akun (urutan mengikuti daftar akun). Akun tanpa
// saldo awal dan tanpa mutasi tidak ditampilkan.
export function kelompokkanPerAkun(
  akunList: AkunBB[],
  saldoAwalMap: Record<string, number>,
  mutasi: (MutasiBB & { akun_id: string })[],
): GroupAkunBB[] {
  const byAkun = new Map<string, MutasiBB[]>();
  for (const { akun_id, ...row } of mutasi) {
    const list = byAkun.get(akun_id);
    if (list) list.push(row);
    else byAkun.set(akun_id, [row]);
  }
  const groups: GroupAkunBB[] = [];
  for (const akun of akunList) {
    const saldoAwal = Number(saldoAwalMap[akun.id]) || 0;
    const raw = byAkun.get(akun.id) || [];
    if (raw.length === 0 && saldoAwal === 0) continue;
    const rows = hitungSaldoBerjalan(saldoAwal, raw, akun.saldo_normal);
    groups.push({
      akun,
      saldoAwal,
      rows,
      totalDebit: raw.reduce((s, r) => s + r.debit, 0),
      totalKredit: raw.reduce((s, r) => s + r.kredit, 0),
      saldoAkhir: rows.length ? rows[rows.length - 1].saldo : saldoAwal,
    });
  }
  return groups;
}

// ─── Ringkasan per akun (tampilan layar "Semua akun") ───
// Total debit/kredit/jumlah baris dihitung di database (buku_besar_ringkasan_semua);
// mutasi rinci satu akun baru dimuat saat barisnya dibuka.
export interface RingkasanRowBB {
  akun_id: string;
  total_debit: number;
  total_kredit: number;
  jumlah: number;
}

export interface RingkasanAkunBB {
  akun: AkunBB;
  saldoAwal: number;
  totalDebit: number;
  totalKredit: number;
  jumlah: number;
  saldoAkhir: number;
}

// Urutan mengikuti daftar akun. Akun tanpa saldo awal dan tanpa mutasi tidak ditampilkan
// (aturan sama dengan kelompokkanPerAkun, sehingga angkanya identik dengan export rinci).
export function hitungRingkasanPerAkun(
  akunList: AkunBB[],
  saldoAwalMap: Record<string, number>,
  ringkasan: RingkasanRowBB[],
): RingkasanAkunBB[] {
  const byAkun = new Map<string, RingkasanRowBB>();
  for (const r of ringkasan) byAkun.set(r.akun_id, r);
  const out: RingkasanAkunBB[] = [];
  for (const akun of akunList) {
    const saldoAwal = Number(saldoAwalMap[akun.id]) || 0;
    const r = byAkun.get(akun.id);
    const totalDebit = Number(r?.total_debit) || 0;
    const totalKredit = Number(r?.total_kredit) || 0;
    const jumlah = Number(r?.jumlah) || 0;
    if (jumlah === 0 && saldoAwal === 0) continue;
    const debitNormal = akun.saldo_normal !== "K";
    out.push({
      akun,
      saldoAwal,
      totalDebit,
      totalKredit,
      jumlah,
      saldoAkhir: saldoAwal + (debitNormal ? totalDebit - totalKredit : totalKredit - totalDebit),
    });
  }
  return out;
}

export function filterRingkasan(
  items: RingkasanAkunBB[],
  opts: { cari: string; hanyaBermutasi: boolean },
): RingkasanAkunBB[] {
  const q = opts.cari.trim().toLowerCase();
  return items.filter((r) => {
    if (opts.hanyaBermutasi && r.jumlah === 0) return false;
    if (!q) return true;
    return `${r.akun.kode} ${r.akun.nama}`.toLowerCase().includes(q);
  });
}

export function totalRingkasan(items: RingkasanAkunBB[]): { totalDebit: number; totalKredit: number; jumlah: number } {
  return items.reduce(
    (t, r) => ({ totalDebit: t.totalDebit + r.totalDebit, totalKredit: t.totalKredit + r.totalKredit, jumlah: t.jumlah + r.jumlah }),
    { totalDebit: 0, totalKredit: 0, jumlah: 0 },
  );
}

const TIPE_LABEL: Record<string, string> = {
  normal: "Normal", pembalik: "Pembalik", pengganti: "Pengganti", penutup: "Penutup",
};
const labelTipe = (t?: string | null) => TIPE_LABEL[t || "normal"] || safeText(t);

interface InfoExport {
  unitLabel: string;
  periodeLabel: string;
}

export function buildBukuBesarSingleAoa(
  p: InfoExport & { akun: AkunBB; saldoAwal: number; rows: MutasiBBSaldo[] },
): JurnalCell[][] {
  const totalDebit = p.rows.reduce((s, r) => s + r.debit, 0);
  const totalKredit = p.rows.reduce((s, r) => s + r.kredit, 0);
  const saldoAkhir = p.rows.length ? p.rows[p.rows.length - 1].saldo : p.saldoAwal;
  return [
    ["Buku Besar"],
    ["Akun", safeText(`${p.akun.kode} - ${p.akun.nama}`)],
    ["Saldo Normal", p.akun.saldo_normal === "K" ? "Kredit" : "Debit"],
    ["Unit", safeText(p.unitLabel)],
    ["Periode", safeText(p.periodeLabel)],
    [],
    ["Tanggal", "No. Jurnal", "Tipe", "Lembaga", "Keterangan", "Debit", "Kredit", "Saldo"],
    ["", "", "", "", "Saldo Awal", "", "", p.saldoAwal],
    ...p.rows.map((r): JurnalCell[] => [
      (r.tanggal || "").slice(0, 10), safeText(r.nomor), labelTipe(r.tipe), safeText(r.lembaga),
      safeText(r.keterangan), r.debit, r.kredit, r.saldo,
    ]),
    ["", "", "", "", "Total", totalDebit, totalKredit, saldoAkhir],
  ];
}

// Sheet ringkasan: satu baris per akun + total (angka sama dengan layar).
export function buildBukuBesarRingkasanAoa(p: InfoExport & { items: RingkasanAkunBB[] }): JurnalCell[][] {
  const t = totalRingkasan(p.items);
  return [
    ["Ringkasan Buku Besar - Semua Akun Rekening"],
    ["Unit", safeText(p.unitLabel)],
    ["Periode", safeText(p.periodeLabel)],
    [],
    ["Kode Akun", "Nama Akun", "Saldo Awal", "Debit", "Kredit", "Saldo Akhir", "Jumlah Transaksi"],
    ...p.items.map((r): JurnalCell[] => [
      safeText(r.akun.kode), safeText(r.akun.nama), r.saldoAwal, r.totalDebit, r.totalKredit, r.saldoAkhir, r.jumlah,
    ]),
    ["Total", "", "", t.totalDebit, t.totalKredit, "", t.jumlah],
  ];
}

// Semua akun: 1 sheet datar (mudah difilter di Excel). Tiap akun: baris Saldo Awal,
// baris mutasi, lalu baris Total.
export function buildBukuBesarSemuaAoa(p: InfoExport & { groups: GroupAkunBB[] }): JurnalCell[][] {
  const out: JurnalCell[][] = [
    ["Buku Besar - Semua Akun Rekening"],
    ["Unit", safeText(p.unitLabel)],
    ["Periode", safeText(p.periodeLabel)],
    [],
    ["Kode Akun", "Nama Akun", "Tanggal", "No. Jurnal", "Tipe", "Lembaga", "Keterangan", "Debit", "Kredit", "Saldo"],
  ];
  for (const g of p.groups) {
    const kode = safeText(g.akun.kode);
    const nama = safeText(g.akun.nama);
    out.push([kode, nama, "", "", "", "", "Saldo Awal", "", "", g.saldoAwal]);
    for (const r of g.rows) {
      out.push([
        kode, nama, (r.tanggal || "").slice(0, 10), safeText(r.nomor), labelTipe(r.tipe),
        safeText(r.lembaga), safeText(r.keterangan), r.debit, r.kredit, r.saldo,
      ]);
    }
    out.push([kode, nama, "", "", "", "", "Total", g.totalDebit, g.totalKredit, g.saldoAkhir]);
  }
  return out;
}

export function bukuBesarFilename(opts: { kode?: string | null; tglAwal: string; tglAkhir: string }): string {
  const slug = String(opts.kode || "semua-akun").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `buku-besar-${slug || "akun"}-${opts.tglAwal}-sd-${opts.tglAkhir}`;
}
