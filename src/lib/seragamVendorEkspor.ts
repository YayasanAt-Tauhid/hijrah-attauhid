import * as XLSX from "xlsx";
import { safeSpreadsheetValue } from "@/lib/safeSpreadsheetValue";
import { compareUkuran } from "@/lib/seragamVendor";
import {
  catatanMasalah, labelJenisKelamin, PESANAN_EXPORT_COLUMNS, pesananExportRows, REKAP_EXPORT_COLUMNS, rekapExportRows, rekapVendor,
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
  /**
   * Peringatan untuk berkas vendor: entri stel yang tidak ikut (harga/ukuran belum ada) dan siswa yang stelnya
   * kurang dari yang seharusnya. Selalu nol untuk berkas internal.
   */
  belumIkut: { stel: number; siswaBelumLengkap: number };
};

const JUDUL = "Pesanan Seragam SPMB";

const slug = (teks: string) => teks.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function namaBerkas(jenis: "vendor" | "internal" | "belum-lengkap", k: KonteksEkspor): string {
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

export type NamaVendor = { lembaga: string; nama: string; jenisKelamin: string; stel: string; ukuran: string };

/**
 * Daftar nama yang ikut ke vendor (hanya stel berstatus ok), terurut lembaga, stel, ukuran, lalu nama, beserta
 * hitungan yang tidak ikut. Dipakai bersama oleh berkas Excel dan PDF vendor supaya isinya selalu sama.
 */
export function kumpulkanNamaVendor(layak: readonly PesananRow[]): {
  nama: NamaVendor[]; stelBelumIkut: number; siswaBelumLengkap: number;
} {
  const nama: NamaVendor[] = [];
  let stelBelumIkut = 0;
  let siswaBelumLengkap = 0;
  for (const siswa of layak) {
    if (siswa.stel.length < siswa.stelWajib) siswaBelumLengkap += 1;
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
  return { nama, stelBelumIkut, siswaBelumLengkap };
}

export function susunBerkasVendor(layak: readonly PesananRow[], konteks: KonteksEkspor): BerkasEkspor {
  const rekap = rekapVendor(layak);
  const { nama, stelBelumIkut, siswaBelumLengkap } = kumpulkanNamaVendor(layak);

  const blok = blokJudul(JUDUL, konteks);
  return {
    filename: namaBerkas("vendor", konteks),
    belumIkut: { stel: stelBelumIkut, siswaBelumLengkap },
    sheets: [
      buatSheet("Rekap", [
        ...blok,
        REKAP_EXPORT_COLUMNS.map((c) => c.label),
        ...rekap.baris.map((b) => [b.lembaga, b.namaStel, labelJenisKelamin(b.jenisKelaminKode), b.ukuran, b.jumlah, b.hargaSatuan, b.subtotal]),
        ["TOTAL", "", "", "", rekap.totalJumlah, "", rekap.totalBayar],
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
    belumIkut: { stel: 0, siswaBelumLengkap: 0 },
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

/** Peringatan untuk pengguna bila berkas vendor belum memuat pesanan yang utuh; null bila lengkap. */
export function pesanBelumIkut(belumIkut: BerkasEkspor["belumIkut"]): string | null {
  const bagian: string[] = [];
  if (belumIkut.stel > 0) bagian.push(`${belumIkut.stel} entri stel tidak ikut (harga atau ukuran belum ada)`);
  if (belumIkut.siswaBelumLengkap > 0) bagian.push(`${belumIkut.siswaBelumLengkap} siswa stelnya belum lengkap`);
  if (bagian.length === 0) return null;
  return `Berkas vendor belum lengkap: ${bagian.join(" dan ")}. Lengkapi dulu sebelum diserahkan ke vendor.`;
}

/** Siswa yang sudah layak dipesan (bayar ≥ 25%) tetapi stelnya belum lengkap. */
export function siswaBelumLengkap(layak: readonly PesananRow[]): PesananRow[] {
  return layak.filter((r) => r.masalah);
}

/** Daftar tindak lanjut untuk internal yayasan: siapa yang stelnya perlu dilengkapi dan apa yang kurang. */
export function susunBerkasBelumLengkap(layak: readonly PesananRow[], konteks: KonteksEkspor): BerkasEkspor {
  const daftar = siswaBelumLengkap(layak).sort((a, b) =>
    a.lembaga.localeCompare(b.lembaga, "id") || a.nama.localeCompare(b.nama, "id") || a.siswaId.localeCompare(b.siswaId));
  const blok = blokJudul(`${JUDUL} (Internal Yayasan): Daftar Belum Lengkap`, konteks);
  return {
    filename: namaBerkas("belum-lengkap", konteks),
    belumIkut: { stel: 0, siswaBelumLengkap: 0 },
    sheets: [
      buatSheet("Belum Lengkap", [
        ...blok.slice(0, -1),
        ["Jumlah siswa", daftar.length],
        [],
        ["Lembaga", "Kelas", "Nama", "NIS", "Jenis Kelamin", "Uang Pangkal (Rp)", "Dibayar (Rp)", "Stel Terisi", "Keterangan"],
        ...daftar.map((r) => [
          r.lembaga, r.kelas === "-" ? "" : r.kelas, r.nama, r.nis, labelJenisKelamin(r.jenisKelaminKode), r.uangPangkalTotal, r.uangPangkalDibayar,
          `${r.stel.length} dari ${r.stelWajib}`, catatanMasalah(r),
        ]),
      ]),
    ],
  };
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
