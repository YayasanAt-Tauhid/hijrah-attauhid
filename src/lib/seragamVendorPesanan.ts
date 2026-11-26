import type { SeragamSiswaRow } from "@/lib/seragamSiswa";
import { uniformDepartment } from "@/lib/ukuranSeragam";
import {
  cariHarga, catatanUkuran, compareUkuran, jumlahStelPesanan, layakDipesan, normalizeNamaStel, normalizeUkuran,
  type HargaSeragamVendor,
} from "@/lib/seragamVendor";

export type PesananStelStatus = "ok" | "harga_belum_ada" | "ukuran_belum_diisi";

export type PesananStel = {
  slot: number;
  nama: string;
  ukuran: string;
  /** Nama stel menurut daftar harga vendor; null bila harga belum ada. */
  namaVendor: string | null;
  harga: number | null;
  status: PesananStelStatus;
  /** Catatan pada ukuran kustom (mis. "Lebar badan 3XL"); tidak ada bila kosong. */
  catatan?: string;
};

/** Teks stel untuk daftar pesanan: "Nama (ukuran)" atau "Nama (ukuran: catatan)". */
export function labelStelPesanan(s: PesananStel): string {
  return `${s.namaVendor ?? s.nama} (${s.ukuran || "-"}${s.catatan ? `: ${s.catatan}` : ""})`;
}

export type PesananRow = {
  siswaId: string;
  nama: string;
  nis: string;
  lembagaId: string;
  lembaga: string;
  kelas: string;
  jenisKelaminKode: string;
  stel: PesananStel[];
  /** Jumlah stel yang seharusnya dipesan: TK 5, lembaga lain 4. */
  stelWajib: number;
  uangPangkalTotal: number;
  uangPangkalDibayar: number;
  total: number;
  /** Belum lengkap: stel kurang dari yang seharusnya, atau ada stel tanpa ukuran/harga. */
  masalah: boolean;
};

export type PesananFilter = { tahunAjaranId: string; lembagaId?: string; gelombangId?: string };
export type PesananResult = { layak: PesananRow[]; belumMemenuhi: number; denganMasalah: number };

/**
 * Siswa SPMB (yang punya data uang pangkal) pada tahun ajaran terpilih. Yang uang pangkalnya terbayar ≥ 25% masuk
 * daftar pesanan; sisanya hanya dihitung. Harga tidak pernah ditebak: stel tanpa harga ditandai dan tidak dijumlahkan.
 */
export function susunPesanan(
  rows: readonly SeragamSiswaRow[],
  harga: readonly HargaSeragamVendor[],
  filter: PesananFilter,
): PesananResult {
  const layak: PesananRow[] = [];
  let belumMemenuhi = 0;
  for (const row of rows) {
    if (!row.uangPangkal) continue;
    if (row.tahunAjaranId !== filter.tahunAjaranId) continue;
    if (filter.lembagaId && row.lembagaId !== filter.lembagaId) continue;
    if (filter.gelombangId && row.gelombangId !== filter.gelombangId) continue;
    if (!layakDipesan(row.uangPangkal)) {
      belumMemenuhi += 1;
      continue;
    }
    const jumlah = jumlahStelPesanan(uniformDepartment({ kode: row.lembaga }));
    const stel: PesananStel[] = [];
    row.stel.slice(0, jumlah).forEach((item, index) => {
      const nama = item.jenis.trim();
      if (!nama) return;
      const slot = index + 1;
      const ukuran = normalizeUkuran(item.ukuran);
      if (!ukuran) {
        stel.push({ slot, nama, ukuran: "", namaVendor: null, harga: null, status: "ukuran_belum_diisi" });
        return;
      }
      const cocok = cariHarga(harga, {
        tahunAjaranId: filter.tahunAjaranId, lembagaId: row.lembagaId,
        jenisKelamin: row.jenisKelaminKode, nama, ukuran,
      });
      const butir: PesananStel = cocok
        ? { slot, nama, ukuran, namaVendor: cocok.nama_stel, harga: cocok.harga, status: "ok" }
        : { slot, nama, ukuran, namaVendor: null, harga: null, status: "harga_belum_ada" };
      const catatan = catatanUkuran(item.ukuran);
      stel.push(catatan ? { ...butir, catatan } : butir);
    });
    layak.push({
      siswaId: row.id, nama: row.nama, nis: row.nis, lembagaId: row.lembagaId, lembaga: row.lembaga, kelas: row.kelas,
      jenisKelaminKode: row.jenisKelaminKode, stel, stelWajib: jumlah,
      uangPangkalTotal: row.uangPangkal.total, uangPangkalDibayar: row.uangPangkal.paid,
      total: stel.reduce((sum, s) => sum + (s.harga ?? 0), 0),
      masalah: stel.length < jumlah || stel.some((s) => s.status !== "ok"),
    });
  }
  layak.sort((a, b) => a.lembaga.localeCompare(b.lembaga, "id") || a.nama.localeCompare(b.nama, "id") || a.siswaId.localeCompare(b.siswaId));
  return { layak, belumMemenuhi, denganMasalah: layak.filter((r) => r.masalah).length };
}

export type RekapBaris = {
  lembagaId: string; lembaga: string; namaStel: string; jenisKelaminKode: string; ukuran: string;
  hargaSatuan: number; jumlah: number; subtotal: number;
};
export type RekapTanpaHarga = {
  lembagaId: string; lembaga: string; namaStel: string; jenisKelaminKode: string; ukuran: string; jumlah: number;
};
export type RekapVendor = { baris: RekapBaris[]; tanpaHarga: RekapTanpaHarga[]; totalJumlah: number; totalBayar: number };

/** Ikhwan (L) lebih dulu, lalu Akhwat (P); nilai lain di belakang. */
const urutanJenisKelamin = (kode: string) => (kode === "L" ? 0 : kode === "P" ? 1 : 2);

type KunciUrutRekap = { lembaga: string; namaStel: string; jenisKelaminKode: string; ukuran: string };
const urutRekap = (a: KunciUrutRekap, b: KunciUrutRekap) =>
  a.lembaga.localeCompare(b.lembaga, "id") || a.namaStel.localeCompare(b.namaStel, "id")
  || urutanJenisKelamin(a.jenisKelaminKode) - urutanJenisKelamin(b.jenisKelaminKode) || compareUkuran(a.ukuran, b.ukuran);

export function rekapVendor(layak: readonly PesananRow[]): RekapVendor {
  const berharga = new Map<string, RekapBaris>();
  const tanpa = new Map<string, RekapTanpaHarga>();
  for (const siswa of layak) {
    for (const item of siswa.stel) {
      if (item.status === "ok" && item.harga !== null) {
        const namaStel = item.namaVendor ?? item.nama;
        const key = [siswa.lembagaId, normalizeNamaStel(namaStel), siswa.jenisKelaminKode, item.ukuran, item.harga].join("|");
        const ada = berharga.get(key);
        if (ada) {
          ada.jumlah += 1;
          ada.subtotal += item.harga;
        } else {
          berharga.set(key, {
            lembagaId: siswa.lembagaId, lembaga: siswa.lembaga, namaStel, jenisKelaminKode: siswa.jenisKelaminKode,
            ukuran: item.ukuran, hargaSatuan: item.harga, jumlah: 1, subtotal: item.harga,
          });
        }
      } else if (item.status === "harga_belum_ada") {
        const key = [siswa.lembagaId, normalizeNamaStel(item.nama), siswa.jenisKelaminKode, item.ukuran].join("|");
        const ada = tanpa.get(key);
        if (ada) ada.jumlah += 1;
        else {
          tanpa.set(key, {
            lembagaId: siswa.lembagaId, lembaga: siswa.lembaga, namaStel: item.nama,
            jenisKelaminKode: siswa.jenisKelaminKode, ukuran: item.ukuran, jumlah: 1,
          });
        }
      }
    }
  }
  const baris = [...berharga.values()].sort(urutRekap);
  return {
    baris,
    tanpaHarga: [...tanpa.values()].sort(urutRekap),
    totalJumlah: baris.reduce((sum, b) => sum + b.jumlah, 0),
    totalBayar: baris.reduce((sum, b) => sum + b.subtotal, 0),
  };
}

export function catatanMasalah(row: PesananRow): string {
  const bagian: string[] = [];
  if (row.stel.length === 0) bagian.push("Belum ada stel yang diisi");
  else if (row.stel.length < row.stelWajib) bagian.push(`Baru ${row.stel.length} dari ${row.stelWajib} stel diisi`);
  const tanpaHarga = row.stel.filter((s) => s.status === "harga_belum_ada").map((s) => `${s.nama} (${s.ukuran})`);
  if (tanpaHarga.length) bagian.push(`Harga belum ada: ${tanpaHarga.join(", ")}`);
  const tanpaUkuran = row.stel.filter((s) => s.status === "ukuran_belum_diisi").map((s) => s.nama);
  if (tanpaUkuran.length) bagian.push(`Ukuran belum diisi: ${tanpaUkuran.join(", ")}`);
  return bagian.join("; ");
}

export const PESANAN_EXPORT_COLUMNS = [
  { key: "nama", label: "Nama" },
  { key: "nis", label: "NIS" },
  { key: "lembaga", label: "Lembaga" },
  { key: "jenisKelamin", label: "Jenis Kelamin" },
  { key: "stel", label: "Stel dan Ukuran" },
  { key: "total", label: "Total (Rp)" },
  { key: "catatan", label: "Catatan" },
];

export function labelJenisKelamin(kode: string): string {
  return kode === "L" ? "Ikhwan" : kode === "P" ? "Akhwat" : "-";
}

export function pesananExportRows(rows: readonly PesananRow[]): Record<string, string | number>[] {
  return rows.map((row) => ({
    nama: row.nama,
    nis: row.nis,
    lembaga: row.lembaga,
    jenisKelamin: labelJenisKelamin(row.jenisKelaminKode),
    stel: row.stel.map(labelStelPesanan).join("; "),
    total: row.total,
    catatan: catatanMasalah(row),
  }));
}

export const REKAP_EXPORT_COLUMNS = [
  { key: "lembaga", label: "Lembaga" },
  { key: "stel", label: "Stel" },
  { key: "jenisKelamin", label: "Jenis Kelamin" },
  { key: "ukuran", label: "Ukuran" },
  { key: "jumlah", label: "Jumlah" },
  { key: "hargaSatuan", label: "Harga Satuan (Rp)" },
  { key: "subtotal", label: "Subtotal (Rp)" },
];

export function rekapExportRows(rekap: RekapVendor): Record<string, string | number>[] {
  return [
    ...rekap.baris.map((b) => ({
      lembaga: b.lembaga, stel: b.namaStel, jenisKelamin: labelJenisKelamin(b.jenisKelaminKode), ukuran: b.ukuran,
      jumlah: b.jumlah, hargaSatuan: b.hargaSatuan, subtotal: b.subtotal,
    })),
    ...rekap.tanpaHarga.map((b) => ({
      lembaga: b.lembaga, stel: b.namaStel, jenisKelamin: labelJenisKelamin(b.jenisKelaminKode), ukuran: b.ukuran,
      jumlah: b.jumlah, hargaSatuan: "Harga belum ada", subtotal: "",
    })),
    { lembaga: "TOTAL", stel: "", jenisKelamin: "", ukuran: "", jumlah: rekap.totalJumlah, hargaSatuan: "", subtotal: rekap.totalBayar },
  ];
}
