import * as XLSX from "xlsx";
import { safeSpreadsheetValue } from "@/lib/safeSpreadsheetValue";
import { compareUkuran } from "@/lib/seragamVendor";
import {
  labelJenisKelamin, PESANAN_EXPORT_COLUMNS, pesananExportRows, REKAP_EXPORT_COLUMNS, rekapExportRows, rekapVendor,
  type PesananResult, type PesananRow,
} from "@/lib/seragamVendorPesanan";

/** Pembentuk berkas ekspor halaman Biaya Seragam SPMB: satu untuk vendor, satu untuk internal yayasan. */

export type KonteksEkspor = { tahunAjaran: string; lembaga: string; gelombang: string; tanggalCetak: string };
export type Sel = string | number;
export type SheetEkspor = { name: string; rows: Sel[][] };
export type BerkasEkspor = {
  /** Nama berkas tanpa ekstensi. */
  filename: string;
  sheets: SheetEkspor[];
  /** Yang tidak ikut ke berkas vendor karena datanya belum lengkap; selalu nol untuk berkas internal. */
  belumIkut: { stel: number; siswaTanpaStel: number };
};

const JUDUL = "Pesanan Seragam SPMB";

const slug = (teks: string) => teks.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function namaBerkas(jenis: "vendor" | "internal", k: KonteksEkspor): string {
  return ["pesanan-seragam", jenis, slug(k.tahunAjaran), slug(k.lembaga)].filter(Boolean).join("-");
}

function blokJudul(judul: string, k: KonteksEkspor): unknown[][] {
  return [
    [judul],
    ["Tahun ajaran", k.tahunAjaran],
    ["Lembaga", k.lembaga],
    ["Gelombang", k.gelombang],
    ["Tanggal cetak", k.tanggalCetak],
    [],
  ];
}

/** Semua sel melewati pembersih rumus di satu tempat ini, termasuk judul. */
function buatSheet(name: string, rows: unknown[][]): SheetEkspor {
  return {
    name,
    rows: rows.map((row) => row.map((sel) => {
      const aman = safeSpreadsheetValue(sel);
      return typeof aman === "boolean" ? String(aman) : aman;
    })),
  };
}

export function susunBerkasVendor(layak: readonly PesananRow[], konteks: KonteksEkspor): BerkasEkspor {
  const rekap = rekapVendor(layak);
  const nama: Array<{ lembaga: string; nama: string; jenisKelamin: string; stel: string; ukuran: string }> = [];
  let stelBelumIkut = 0;
  let siswaTanpaStel = 0;
  for (const siswa of layak) {
    if (siswa.stel.length === 0) siswaTanpaStel += 1;
    for (const item of siswa.stel) {
      if (item.status !== "ok") {
        stelBelumIkut += 1;
        continue;
      }
      nama.push({
        lembaga: siswa.lembaga, nama: siswa.nama, jenisKelamin: labelJenisKelamin(siswa.jenisKelaminKode),
        stel: item.namaVendor ?? item.nama, ukuran: item.ukuran,
      });
    }
  }
  nama.sort((a, b) =>
    a.lembaga.localeCompare(b.lembaga, "id") || a.stel.localeCompare(b.stel, "id")
    || compareUkuran(a.ukuran, b.ukuran) || a.nama.localeCompare(b.nama, "id"));

  const blok = blokJudul(JUDUL, konteks);
  return {
    filename: namaBerkas("vendor", konteks),
    belumIkut: { stel: stelBelumIkut, siswaTanpaStel },
    sheets: [
      buatSheet("Rekap", [
        ...blok,
        REKAP_EXPORT_COLUMNS.map((c) => c.label),
        ...rekap.baris.map((b) => [b.lembaga, b.namaStel, b.ukuran, b.jumlah, b.hargaSatuan, b.subtotal]),
        ["TOTAL", "", "", rekap.totalJumlah, "", rekap.totalBayar],
      ]),
      buatSheet("Daftar Nama", [
        ...blok,
        ["Lembaga", "Nama", "Jenis Kelamin", "Stel", "Ukuran"],
        ...nama.map((n) => [n.lembaga, n.nama, n.jenisKelamin, n.stel, n.ukuran]),
      ]),
    ],
  };
}

export function susunBerkasInternal(pesanan: PesananResult, konteks: KonteksEkspor): BerkasEkspor {
  const rekap = rekapVendor(pesanan.layak);
  const blok = blokJudul(`${JUDUL} (Internal Yayasan)`, konteks);
  const tabel = (kolom: ReadonlyArray<{ key: string; label: string }>, data: ReadonlyArray<Record<string, string | number>>) => [
    kolom.map((c) => c.label),
    ...data.map((row) => kolom.map((c) => row[c.key] ?? "")),
  ];
  return {
    filename: namaBerkas("internal", konteks),
    belumIkut: { stel: 0, siswaTanpaStel: 0 },
    sheets: [
      buatSheet("Ringkasan", [
        ...blok,
        ["Layak dipesan", pesanan.layak.length],
        ["Belum memenuhi 25%", pesanan.belumMemenuhi],
        ["Perlu dilengkapi", pesanan.denganMasalah],
        ["Total pembayaran vendor (Rp)", rekap.totalBayar],
      ]),
      buatSheet("Daftar Pesanan", [...blok, ...tabel(PESANAN_EXPORT_COLUMNS, pesananExportRows(pesanan.layak))]),
      buatSheet("Rekap Vendor", [...blok, ...tabel(REKAP_EXPORT_COLUMNS, rekapExportRows(rekap))]),
    ],
  };
}

/** Peringatan untuk pengguna bila berkas vendor tidak memuat semua siswa/stel; null bila lengkap. */
export function pesanBelumIkut(belumIkut: BerkasEkspor["belumIkut"]): string | null {
  const bagian: string[] = [];
  if (belumIkut.stel > 0) bagian.push(`${belumIkut.stel} entri stel (harga atau ukuran belum ada)`);
  if (belumIkut.siswaTanpaStel > 0) bagian.push(`${belumIkut.siswaTanpaStel} siswa tanpa stel`);
  if (bagian.length === 0) return null;
  return `Belum ikut di berkas vendor: ${bagian.join(" dan ")}. Lengkapi dulu sebelum diserahkan ke vendor.`;
}

export function buatWorkbook(berkas: BerkasEkspor): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const sheet of berkas.sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const lebar: number[] = [];
    for (const row of sheet.rows) {
      if (row.length <= 1) continue; // baris judul tidak ikut menentukan lebar kolom
      row.forEach((sel, i) => { lebar[i] = Math.max(lebar[i] ?? 0, String(sel).length); });
    }
    worksheet["!cols"] = lebar.map((w) => ({ wch: Math.min(Math.max(w + 2, 10), 40) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return workbook;
}

export function unduhBerkasXlsx(berkas: BerkasEkspor): void {
  XLSX.writeFile(buatWorkbook(berkas), `${berkas.filename}.xlsx`);
}
