/**
 * Pengunduran diri pendaftar SPMB (calon/diterima).
 *
 * Server function memegang otorisasi lembaga dan menutup sesi pembayaran online
 * yang masih terbuka; seluruh perubahan data (status, tagihan, rencana tagihan,
 * kelas, catatan audit) dilakukan atomik oleh RPC `spmb_withdraw_registration`.
 * NIS yang sudah terbit tidak dilepas, sehingga tidak pernah dipakai ulang.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";
import { authMiddleware, requireAcademicDepartment, requireContext } from "./auth";
import { closeStoredSession } from "./midtransSessions";

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface Query<T> extends PromiseLike<QueryResult<T[]>> {
  select(columns: string): Query<T>;
  eq(column: string, value: string): Query<T>;
  maybeSingle(): Promise<QueryResult<T>>;
}
interface LooseAdmin {
  from(table: string): Query<Record<string, unknown>>;
  rpc(fn: string, args: Record<string, unknown>): Promise<QueryResult<unknown>>;
}

interface GatewayTransaction {
  id: string;
  status?: string | null;
  snap_token?: string | null;
  gateway_closed_at?: string | null;
}

export interface SpmbWithdrawalResult {
  success: true;
  tagihan_dibatalkan: number;
  total_dibayar: number;
  rincian_dibayar: Array<{ jenis: string; jumlah: number }>;
  perlu_tindak_lanjut_keuangan: boolean;
  /** Pendaftar internal: hanya pendaftarannya yang ditandai; data lembaga asal tidak disentuh. */
  siswa_internal: boolean;
  peringatan: string[];
}

const WITHDRAWABLE_STATUSES = ["calon", "diterima"];
const SESSION_CLOSE_REASON = "pendaftar_mengundurkan_diri";

function parseEffectiveDate(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !date || date.toISOString().slice(0, 10) !== text) {
    throw new Error("Tanggal efektif tidak valid");
  }
  return text;
}

export const spmbWithdrawRegistration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { detail_id: string; alasan: string; tanggal_efektif: string }) => d)
  .handler(async ({ data, context }): Promise<SpmbWithdrawalResult> => {
    const actor = requireContext(context);

    const detailId = typeof data.detail_id === "string" ? data.detail_id.trim() : "";
    if (!detailId) throw new Error("Data pendaftaran tidak valid");
    const alasan = typeof data.alasan === "string" ? data.alasan.trim() : "";
    if (alasan.length < 5) throw new Error("Alasan pengunduran diri wajib diisi minimal 5 karakter");
    if (alasan.length > 500) throw new Error("Alasan pengunduran diri maksimal 500 karakter");
    const tanggalEfektif = parseEffectiveDate(data.tanggal_efektif);

    const adminClient = createAdminClient();
    const admin = adminClient as unknown as LooseAdmin;

    const { data: detail, error: detailError } = await admin
      .from("siswa_detail")
      .select("id,siswa_id,spmb_departemen_tujuan_id,spmb_status_pendaftaran,spmb_tanggal_aktivasi")
      .eq("id", detailId)
      .maybeSingle();
    if (detailError) throw new Error(detailError.message);
    if (!detail?.id) throw new Error("Pendaftaran SPMB tidak ditemukan");
    const siswaId = String(detail.siswa_id);

    const { data: siswa, error: siswaError } = await admin
      .from("siswa")
      .select("departemen_id,status")
      .eq("id", siswaId)
      .maybeSingle();
    if (siswaError) throw new Error(siswaError.message);

    const departemenId = (detail.spmb_departemen_tujuan_id as string | null) || (siswa?.departemen_id as string | null) || null;
    await requireAcademicDepartment(adminClient, actor.userId, departemenId, ["admin", "admin_tu"]);

    const registrationStatus = (detail.spmb_status_pendaftaran as string | null) || (siswa?.status as string | null);
    if (detail.spmb_tanggal_aktivasi || registrationStatus === "aktif" || registrationStatus === "selesai") {
      throw new Error("Murid ini sudah aktif. Proses lewat Mutasi Siswa → Pindah Keluar, bukan pengunduran diri SPMB.");
    }
    if (!registrationStatus || !WITHDRAWABLE_STATUSES.includes(registrationStatus)) {
      throw new Error("Pengunduran diri hanya untuk pendaftar berstatus calon atau diterima");
    }

    // Pembayaran online yang sudah berhasil tetapi belum tercatat harus selesai
    // dulu: kalau tidak, uang masuk setelah pendaftar dinyatakan mundur.
    const { data: items, error: itemsError } = await admin
      .from("transaksi_midtrans_item")
      .select("pembayaran_id, transaksi:transaksi_id(*)")
      .eq("siswa_id", siswaId);
    if (itemsError) throw new Error(itemsError.message);

    const openSessions = new Map<string, GatewayTransaction>();
    for (const item of (items as unknown as Array<{ pembayaran_id: string | null; transaksi: GatewayTransaction | null }>) || []) {
      const tx = item.transaksi;
      if (!tx) continue;
      if (tx.status === "paid") {
        if (!item.pembayaran_id) {
          throw new Error("Pembayaran online berhasil dan sedang dicatat. Coba lagi beberapa menit lagi.");
        }
      } else if (!tx.gateway_closed_at && (tx.status === "pending" || tx.snap_token)) {
        openSessions.set(tx.id, tx);
      }
    }

    const peringatan: string[] = [];
    for (const tx of openSessions.values()) {
      try {
        await closeStoredSession(tx, SESSION_CLOSE_REASON);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "kesalahan tidak diketahui";
        peringatan.push(`Sesi pembayaran online belum bisa ditutup otomatis (${message}). Tautan akan tetap mati karena status pendaftaran berubah.`);
      }
    }

    const { data: result, error: rpcError } = await admin.rpc("spmb_withdraw_registration", {
      p_siswa_id: siswaId,
      p_alasan: alasan,
      p_tanggal_efektif: tanggalEfektif,
      p_actor_id: actor.userId,
    });
    if (rpcError) throw new Error(rpcError.message);

    const summary = (result || {}) as Partial<SpmbWithdrawalResult>;
    return {
      success: true,
      tagihan_dibatalkan: Number(summary.tagihan_dibatalkan) || 0,
      total_dibayar: Number(summary.total_dibayar) || 0,
      rincian_dibayar: Array.isArray(summary.rincian_dibayar) ? summary.rincian_dibayar : [],
      perlu_tindak_lanjut_keuangan: summary.perlu_tindak_lanjut_keuangan === true,
      siswa_internal: summary.siswa_internal === true,
      peringatan,
    };
  });
