import type { SpmbWithdrawalResult } from "@/server/spmbWithdrawal";

export interface SpmbWithdrawalNotices {
  success: { title: string; description: string };
  followUp: { title: string; description: string } | null;
  warnings: string[];
}

/** Admin/admin TU boleh memproses pendaftar calon/diterima yang belum diaktivasi. */
export function canWithdrawSpmbRegistration(input: {
  role?: string | null;
  status?: string | null;
  activated?: boolean;
}): boolean {
  if (input.role !== "admin" && input.role !== "admin_tu") return false;
  if (input.activated) return false;
  return input.status === "calon" || input.status === "diterima";
}

const rupiah = (value: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(value);

export function buildSpmbWithdrawalNotices(
  nama: string,
  result: Pick<
    SpmbWithdrawalResult,
    "tagihan_dibatalkan" | "total_dibayar" | "rincian_dibayar" | "perlu_tindak_lanjut_keuangan" | "siswa_internal" | "peringatan"
  >,
): SpmbWithdrawalNotices {
  const parts: string[] = [];
  if (result.siswa_internal) {
    parts.push("Data murid di lembaga asal tidak diubah.");
  } else if (result.tagihan_dibatalkan > 0) {
    parts.push(`${result.tagihan_dibatalkan} tagihan belum dibayar dibatalkan.`);
  } else {
    parts.push("Tidak ada tagihan belum dibayar yang perlu dibatalkan.");
  }
  parts.push("Tautan pembayaran tidak aktif lagi dan NIS yang sudah terbit tidak dipakai ulang.");

  let followUp: SpmbWithdrawalNotices["followUp"] = null;
  if (result.perlu_tindak_lanjut_keuangan) {
    if (result.total_dibayar > 0) {
      const detail = result.rincian_dibayar.map((item) => `${item.jenis} ${rupiah(item.jumlah)}`).join(", ");
      followUp = {
        title: "Perlu tindak lanjut keuangan",
        description: `Pembayaran yang sudah masuk ${rupiah(result.total_dibayar)} (${detail}) tidak dikembalikan otomatis. Pengembalian dana, bila ada, dicatat manual oleh keuangan.`,
      };
    } else {
      followUp = {
        title: "Perlu tindak lanjut keuangan",
        description: "Pendaftar internal: tinjau tagihan lembaga tujuan secara manual, karena tagihan tidak dibatalkan otomatis.",
      };
    }
    if (result.siswa_internal && result.total_dibayar > 0) {
      followUp.description += " Tinjau juga tagihan lembaga tujuan secara manual.";
    }
  }

  return {
    success: { title: `${nama} ditandai mengundurkan diri`, description: parts.join(" ") },
    followUp,
    warnings: result.peringatan,
  };
}
