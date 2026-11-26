import type { jsPDF } from "jspdf";
import {
  kumpulkanNamaVendor, namaBerkas, type BerkasEkspor, type KonteksEkspor, type NamaVendor,
} from "@/lib/seragamVendorEkspor";
import { labelJenisKelamin, rekapVendor, type PesananRow, type RekapBaris } from "@/lib/seragamVendorPesanan";

/**
 * PDF pesanan seragam untuk vendor: satu berkas, tiap lembaga mulai di halaman baru dengan rekap (stel, jenis
 * kelamin, ukuran, jumlah, harga) dan daftar nama. Isinya sama dengan berkas Excel vendor; hanya penyajiannya
 * yang berbeda, dan pengumpulan datanya memakai fungsi yang sama.
 */

const JUDUL = "Pesanan Seragam SPMB";

export type PdfVendorLembaga = {
  lembaga: string;
  rekap: RekapBaris[];
  totalJumlah: number;
  totalBayar: number;
  nama: NamaVendor[];
};

export type PdfVendorModel = {
  /** Nama berkas tanpa ekstensi, sama dengan berkas Excel vendor. */
  filename: string;
  konteks: KonteksEkspor;
  lembaga: PdfVendorLembaga[];
  totalJumlah: number;
  totalBayar: number;
  belumIkut: BerkasEkspor["belumIkut"];
};

export function susunPdfVendor(layak: readonly PesananRow[], konteks: KonteksEkspor): PdfVendorModel {
  const rekap = rekapVendor(layak);
  const { nama, stelBelumIkut, siswaBelumLengkap } = kumpulkanNamaVendor(layak);
  const daftarLembaga = [...new Set([...rekap.baris.map((b) => b.lembaga), ...nama.map((n) => n.lembaga)])]
    .sort((a, b) => a.localeCompare(b, "id"));
  return {
    filename: namaBerkas("vendor", konteks),
    konteks,
    belumIkut: { stel: stelBelumIkut, siswaBelumLengkap },
    totalJumlah: rekap.totalJumlah,
    totalBayar: rekap.totalBayar,
    lembaga: daftarLembaga.map((lembaga) => {
      const baris = rekap.baris.filter((b) => b.lembaga === lembaga);
      return {
        lembaga,
        rekap: baris,
        totalJumlah: baris.reduce((jumlah, b) => jumlah + b.jumlah, 0),
        totalBayar: baris.reduce((total, b) => total + b.subtotal, 0),
        nama: nama.filter((n) => n.lembaga === lembaga),
      };
    }),
  };
}

// ---------- penyajian PDF ----------

const HALAMAN_LEBAR = 210;
const HALAMAN_TINGGI = 297;
const MARGIN = 15;
const LEBAR_KONTEN = HALAMAN_LEBAR - 2 * MARGIN;
const BATAS_BAWAH = HALAMAN_TINGGI - 18;
const PAD_X = 1.5;
const PAD_Y = 1.4;
const TINGGI_GARIS = 4;
const TINGGI_KEPALA = 6.5;

const angka = (n: number) => n.toLocaleString("id-ID");

/**
 * Font bawaan PDF hanya memuat huruf Latin-1. Karakter di luar itu dibersihkan (tanda diakritik dibuang, tanda kutip
 * dan strip tipografis disederhanakan, sisanya "?") agar nama tidak tercetak sebagai karakter rusak.
 */
export function amanPdf(teks: string): string {
  return Array.from(teks.normalize("NFC")).map((c) => {
    const kode = c.codePointAt(0) ?? 0;
    if ((kode >= 0x20 && kode <= 0x7e) || (kode >= 0xa0 && kode <= 0xff)) return c;
    if (c === "\u2018" || c === "\u2019") return "'";
    if (c === "\u201c" || c === "\u201d") return '"';
    if (c === "\u2013" || c === "\u2014") return "-";
    const dasar = c.normalize("NFD").replace(/\p{M}/gu, "");
    return /^[\u0020-\u007e\u00a0-\u00ff]+$/.test(dasar) ? dasar : "?";
  }).join("");
}

type Kolom = { label: string; lebar: number; kanan?: boolean };
type BarisTabel = { sel: string[]; tebal?: boolean };

const KOLOM_REKAP: Kolom[] = [
  { label: "Stel", lebar: 44 },
  { label: "Jenis Kelamin", lebar: 24 },
  { label: "Ukuran", lebar: 28 },
  { label: "Jumlah", lebar: 16, kanan: true },
  { label: "Harga Satuan (Rp)", lebar: 34, kanan: true },
  { label: "Subtotal (Rp)", lebar: 34, kanan: true },
];
const KOLOM_NAMA: Kolom[] = [
  { label: "No.", lebar: 10 },
  { label: "Nama", lebar: 62 },
  { label: "Jenis Kelamin", lebar: 24 },
  { label: "Stel", lebar: 50 },
  { label: "Ukuran", lebar: 34 },
];
/** Dipakai hanya untuk lembaga yang punya catatan ukuran kustom. */
const KOLOM_NAMA_CATATAN: Kolom[] = [
  { label: "No.", lebar: 8 },
  { label: "Nama", lebar: 44 },
  { label: "Jenis Kelamin", lebar: 24 },
  { label: "Stel", lebar: 36 },
  { label: "Ukuran", lebar: 26 },
  { label: "Catatan", lebar: 42 },
];

/** Gambar satu tabel (dengan judul seksi); pindah halaman bila perlu dan mengulang kepala tabel. Mengembalikan y akhir. */
function gambarTabel(
  doc: jsPDF,
  opsi: { judul: string; kolom: Kolom[]; baris: BarisTabel[]; y: number; halamanLanjutan: (label: string) => number },
): number {
  const { judul, kolom, baris } = opsi;
  let y = opsi.y;

  const ukurBaris = (b: BarisTabel) => {
    doc.setFont("helvetica", b.tebal ? "bold" : "normal");
    doc.setFontSize(9);
    const garis = b.sel.map((teks, i) => doc.splitTextToSize(amanPdf(teks), kolom[i].lebar - 2 * PAD_X) as string[]);
    const jumlahGaris = Math.max(1, ...garis.map((g) => g.length));
    return { garis, tinggi: jumlahGaris * TINGGI_GARIS + 2 * PAD_Y };
  };

  const kepala = () => {
    doc.setFillColor(238, 238, 238);
    doc.rect(MARGIN, y, LEBAR_KONTEN, TINGGI_KEPALA, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    let x = MARGIN;
    for (const k of kolom) {
      if (k.kanan) doc.text(k.label, x + k.lebar - PAD_X, y + 4.4, { align: "right" });
      else doc.text(k.label, x + PAD_X, y + 4.4);
      x += k.lebar;
    }
    doc.setDrawColor(120);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y + TINGGI_KEPALA, MARGIN + LEBAR_KONTEN, y + TINGGI_KEPALA);
    y += TINGGI_KEPALA;
  };

  const judulSeksi = (teks: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(teks, MARGIN, y + 4);
    y += 7;
  };

  const ukuran = baris.map(ukurBaris);
  const perluUntukAwal = 7 + TINGGI_KEPALA + (ukuran[0]?.tinggi ?? 0);
  if (y + perluUntukAwal > BATAS_BAWAH) y = opsi.halamanLanjutan(judul);
  judulSeksi(judul);
  kepala();

  baris.forEach((b, i) => {
    const { garis, tinggi } = ukuran[i];
    if (y + tinggi > BATAS_BAWAH) {
      y = opsi.halamanLanjutan(judul);
      kepala();
    }
    doc.setFont("helvetica", b.tebal ? "bold" : "normal");
    doc.setFontSize(9);
    let x = MARGIN;
    garis.forEach((barisTeks, kolomKe) => {
      const k = kolom[kolomKe];
      barisTeks.forEach((teks, n) => {
        const dasar = y + PAD_Y + 2.9 + n * TINGGI_GARIS;
        if (k.kanan) doc.text(teks, x + k.lebar - PAD_X, dasar, { align: "right" });
        else doc.text(teks, x + PAD_X, dasar);
      });
      x += k.lebar;
    });
    doc.setDrawColor(210);
    doc.setLineWidth(0.15);
    doc.line(MARGIN, y + tinggi, MARGIN + LEBAR_KONTEN, y + tinggi);
    y += tinggi;
  });
  return y + 6;
}

function gambarBlokJudul(doc: jsPDF, konteks: KonteksEkspor, lembaga: string | null): number {
  let y = MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(JUDUL, MARGIN, y + 4);
  y += 11;
  const baris: Array<[string, string]> = [
    ["Tahun ajaran", konteks.tahunAjaran],
    ["Lembaga", lembaga ?? konteks.lembaga],
    ["Gelombang", konteks.gelombang],
    ["Tanggal cetak", konteks.tanggalCetak],
  ];
  doc.setFontSize(9);
  for (const [kunci, nilai] of baris) {
    doc.setFont("helvetica", "normal");
    doc.text(kunci, MARGIN, y);
    doc.setFont("helvetica", kunci === "Lembaga" ? "bold" : "normal");
    doc.text(`: ${amanPdf(nilai)}`, MARGIN + 28, y);
    y += 4.6;
  }
  return y + 4;
}

export async function buatPdfVendor(model: PdfVendorModel, opsi: { kompres?: boolean } = {}): Promise<jsPDF> {
  const { jsPDF: JsPdf } = await import("jspdf");
  const doc = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4", compress: opsi.kompres ?? true });
  doc.setProperties({ title: `${JUDUL} ${model.konteks.tahunAjaran}` });

  if (model.lembaga.length === 0) {
    const y = gambarBlokJudul(doc, model.konteks, null);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Tidak ada pesanan yang lengkap untuk dikirim ke vendor.", MARGIN, y + 4);
  }

  model.lembaga.forEach((l, indeks) => {
    if (indeks > 0) doc.addPage();
    let y = gambarBlokJudul(doc, model.konteks, l.lembaga);
    const halamanLanjutan = (label: string) => {
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(amanPdf(`${l.lembaga}: ${label} (lanjutan)`), MARGIN, MARGIN + 4);
      return MARGIN + 10;
    };

    y = gambarTabel(doc, {
      judul: "Rekap",
      kolom: KOLOM_REKAP,
      y,
      halamanLanjutan,
      baris: [
        ...l.rekap.map((b): BarisTabel => ({
          sel: [b.namaStel, labelJenisKelamin(b.jenisKelaminKode), b.ukuran, String(b.jumlah), angka(b.hargaSatuan), angka(b.subtotal)],
        })),
        { sel: ["TOTAL", "", "", String(l.totalJumlah), "", angka(l.totalBayar)], tebal: true },
      ],
    });
    const adaCatatan = l.nama.some((n) => n.catatan);
    gambarTabel(doc, {
      judul: "Daftar Nama",
      kolom: adaCatatan ? KOLOM_NAMA_CATATAN : KOLOM_NAMA,
      y,
      halamanLanjutan,
      baris: l.nama.map((n, i): BarisTabel => ({
        sel: [String(i + 1), n.nama, n.jenisKelamin, n.stel, n.ukuran, ...(adaCatatan ? [n.catatan] : [])],
      })),
    });
  });

  const jumlahHalaman = doc.getNumberOfPages();
  for (let i = 1; i <= jumlahHalaman; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(amanPdf(`${JUDUL} ${model.konteks.tahunAjaran}`), MARGIN, HALAMAN_TINGGI - 10);
    doc.text(`Halaman ${i} dari ${jumlahHalaman}`, HALAMAN_LEBAR - MARGIN, HALAMAN_TINGGI - 10, { align: "right" });
  }
  doc.setTextColor(0);
  return doc;
}

export async function unduhBerkasPdf(model: PdfVendorModel): Promise<void> {
  const doc = await buatPdfVendor(model);
  doc.save(`${model.filename}.pdf`);
}
