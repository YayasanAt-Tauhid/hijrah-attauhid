/**
 * Milestone SPMB boleh dilengkapi setelah aktivasi akademik jika riwayatnya
 * masih kosong. Perubahan keputusan menjadi "tidak lulus" setelah aktivasi
 * sengaja tidak disediakan, supaya murid aktif tidak salah dinyatakan gagal.
 * Server RPC tetap memvalidasi urutan dan hak akses.
 */
export type SpmbMilestoneAction = "tes" | "lulus" | "tidak_lulus" | "daftar_ulang";

export type SpmbMilestoneRecord = {
  spmb_tanggal_tes?: unknown;
  spmb_status_kelulusan?: unknown;
  spmb_tanggal_daftar_ulang?: unknown;
};

export const SPMB_MILESTONE_ACTION_LABELS: Record<SpmbMilestoneAction, string> = {
  tes: "Catat sudah tes",
  lulus: "Catat lulus tes",
  tidak_lulus: "Catat tidak lulus tes",
  daftar_ulang: "Catat daftar ulang",
};

export const SPMB_MILESTONE_SUCCESS_LABELS: Record<SpmbMilestoneAction, string> = {
  tes: "Sudah Tes",
  lulus: "Lulus",
  tidak_lulus: "Tidak Lulus",
  daftar_ulang: "Daftar Ulang",
};

export function getAvailableSpmbMilestones(
  detail: SpmbMilestoneRecord | null | undefined,
  activated: boolean,
): SpmbMilestoneAction[] {
  if (!detail) return [];
  if (!detail.spmb_tanggal_tes) return ["tes"];
  if (!detail.spmb_status_kelulusan) return activated
    ? ["lulus"]
    : ["lulus", "tidak_lulus"];
  if (detail.spmb_status_kelulusan === "lulus" && !detail.spmb_tanggal_daftar_ulang) {
    return ["daftar_ulang"];
  }
  return [];
}
