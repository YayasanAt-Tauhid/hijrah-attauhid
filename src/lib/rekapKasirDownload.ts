import { createClientOnlyFn } from "@tanstack/react-start";
import type { RekapKasirItem } from "./rekapKasirSummary";

export interface RekapKasirDownloadData {
  petugas_nama: string | null;
  bendahara_nama?: string | null;
  tanggal_dari: string;
  tanggal_sampai: string;
  items: RekapKasirItem[];
  /** Lembaga yang difilter ("KODE — Nama"); kosong = Semua Lembaga. */
  lembaga_label?: string | null;
  /** Jenis pembayaran yang difilter; kosong = Semua Jenis. */
  jenis_label?: string | null;
}

/**
 * Bangun dan unduh laporan Excel rekap kasir di browser.
 *
 * Dibungkus createClientOnlyFn supaya kompiler TanStack Start membuang isinya
 * (termasuk import dinamis exceljs, ±190 KB gzip) dari bundle Worker server;
 * exceljs hanya diunduh browser saat tombol ditekan.
 */
export const unduhRekapKasirExcel = createClientOnlyFn(async (data: RekapKasirDownloadData) => {
  // Logo kop opsional: bila gagal dimuat, laporan tetap dibuat tanpa logo.
  const [{ buildRekapKasirWorkbook, rekapKasirFilename }, logo] = await Promise.all([
    import("@/lib/rekapKasirExcel"),
    fetch("/branding/yayasan-at-tauhid-kop.png")
      .then((res) => (res.ok ? res.arrayBuffer() : undefined))
      .catch(() => undefined),
  ]);
  const workbook = buildRekapKasirWorkbook({
    petugasNama: data.petugas_nama,
    bendaharaNama: data.bendahara_nama ?? null,
    dari: data.tanggal_dari,
    sampai: data.tanggal_sampai,
    dicetakPada: new Date(),
    items: data.items,
    lembagaLabel: data.lembaga_label ?? null,
    jenisLabel: data.jenis_label ?? null,
    logo,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = rekapKasirFilename(data.tanggal_dari, data.tanggal_sampai, data.lembaga_label, data.jenis_label);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
