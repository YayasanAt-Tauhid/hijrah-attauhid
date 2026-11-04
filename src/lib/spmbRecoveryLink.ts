import { toast } from "sonner";
import { spmbAdminGetRecoveryLink } from "@/server/pmb";

/**
 * Salin tautan pemulihan pembayaran SPMB untuk orang tua yang kehilangan sesi
 * browser. Tautan adalah kunci akses ke satu pendaftaran: hanya diminta saat
 * staf mengklik, tidak disimpan di state, dan tidak ditulis ke pesan sukses.
 * Dipakai bersama oleh daftar SPMB dan halaman detail pendaftaran.
 */
export async function copySpmbRecoveryLink(detailId: string): Promise<void> {
  try {
    const { url } = await spmbAdminGetRecoveryLink({ data: { detail_id: detailId } });
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Tautan pemulihan disalin", {
        description: "Kirim hanya ke orang tua calon murid yang bersangkutan, lewat pesan pribadi.",
      });
    } catch {
      toast.info("Salin tautan ini secara manual", { description: url, duration: 20000 });
    }
  } catch (error: unknown) {
    toast.error("Gagal membuat tautan pemulihan", {
      description: error instanceof Error ? error.message : "Terjadi kesalahan teknis",
    });
  }
}
