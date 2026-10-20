import type { DeletionResult } from "@/server/dataDeletion";

type ReasonHandler = (table: string) => Promise<string | null>;
let reasonHandler: ReasonHandler | undefined;
/** The app owns the dialog; unmount cancels it, preventing a stale mutation. */
export function registerDeletionReasonHandler(handler: ReasonHandler) {
  reasonHandler = handler;
  return () => { if (reasonHandler === handler) reasonHandler = undefined; };
}
export async function deleteWithApproval(table: string, id: string): Promise<DeletionResult> {
  if (!reasonHandler) throw new Error("Form penghapusan belum siap. Muat ulang halaman.");
  const reason = await reasonHandler(table);
  if (reason === null) throw new Error("Pengajuan penghapusan dibatalkan");
  const { deleteData } = await import("@/server/dataDeletion");
  return deleteData({ data: { table, id, reason } });
}
export function deletionMessage(result: DeletionResult | undefined, success: string) {
  if (result?.pending) return "Pengajuan tersimpan. Data menunggu persetujuan admin dan belum dihapus.";
  if (result?.result?.action === "deactivated") return "Data sudah digunakan; status dinonaktifkan agar histori tetap utuh.";
  return success;
}
export const deletionLabels: Record<string,string> = {
  siswa: "Data siswa / pendaftaran SPMB", kelas: "Kelas", tingkat: "Tingkat", angkatan: "Angkatan",
  jadwal: "Jadwal pelajaran", kalender_akademik: "Kalender akademik", mata_pelajaran: "Mata pelajaran",
  semester: "Semester", kompetensi_dasar: "Kompetensi dasar", pegawai: "Pegawai",
  tagihan: "Tagihan siswa", pembayaran: "Pembayaran", jurnal: "Jurnal", pengeluaran: "Pengeluaran",
  transaksi_kas_kecil: "Transaksi kas kecil", penyisihan_piutang: "Penyisihan piutang",
  skema_diskon: "Skema keringanan", siswa_diskon: "Keringanan siswa", jenis_pembayaran: "Jenis penerimaan",
  jenis_pengeluaran: "Jenis pengeluaran", tahun_ajaran: "Tahun ajaran", tahun_buku: "Tahun buku",
  akun_rekening: "Akun rekening", pengaturan_akun: "Pengaturan akun", program_dana: "Program dana",
};
