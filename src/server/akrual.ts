/**
 * Server function: jalankanAkrualJatuhTempo
 *
 * Menjalankan akrual pada tanggal pengakuan: SPP akhir bulan layanan, jenis lain sesuai jadwal.
 *
 *   1. Tagihan berstatus 'terjadwal' (di-input di muka, belum pernah dijurnal)
 *      dibukukan sisa piutangnya: (D) Piutang Siswa (K) Pendapatan  — status
 *      berpindah ke 'belum_bayar'. Kalau setelah ini tetap tidak dibayar,
 *      tagihan tsb menjadi TUNGGAKAN; tunggakan tidak butuh jurnal tambahan
 *      karena akunnya sama, yang berubah hanya umur piutangnya.
 *
 *   2. Pembayaran yang masuk sebelum pengakuan (dicatat sebagai liabilitas
 *      Pendapatan Diterima di Muka) diakui jadi pendapatan:
 *      (D) Pendapatan Diterima di Muka  (K) Pendapatan.
 *
 * Seluruh pekerjaan dilakukan di satu RPC PostgreSQL (transaksi atomik + hanya
 * satu subrequest dari sisi Worker). RPC-nya idempoten, jadi aman dipanggil
 * berkali-kali — baris yang sudah diproses tidak akan diproses ulang.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

export interface JalankanAkrualInput {
  /**
   * Proses tagihan yang jatuh tempo sampai tanggal ini ("yyyy-MM-dd").
   * Default: hari ini. Tanggal jurnal tetap hari ini apa pun isinya, supaya
   * job yang telat jalan tidak menyisipkan jurnal bertanggal mundur ke periode
   * yang laporannya sudah terbit.
   */
  sampai_tanggal?: string;
  /** Batas jumlah baris per proses (default 5000 di sisi RPC). */
  limit?: number;
}

export interface JalankanAkrualResult {
  success: true;
  sampai_tanggal: string;
  /** Jumlah tagihan terjadwal yang berubah jadi piutang. */
  piutang_diposting: number;
  piutang_nominal: number;
  /** Jumlah baris pendapatan diterima di muka yang diakui jadi pendapatan. */
  pendapatan_diakui: number;
  pendapatan_nominal: number;
  errors?: string[];
}

export const jalankanAkrualJatuhTempo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: JalankanAkrualInput) => d ?? {})
  .handler(async ({ data, context }): Promise<JalankanAkrualResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [
      "admin",
      "keuangan",
    ]);

    const sampaiTanggal =
      data?.sampai_tanggal || new Date().toISOString().split("T")[0];

    const { data: result, error: rpcErr } = await admin.rpc(
      "jalankan_akrual_jatuh_tempo",
      {
        p_sampai_tanggal: sampaiTanggal,
        p_user_id: userId,
        p_limit: data?.limit ?? 5000,
      }
    );
    if (rpcErr)
      throw new Error("Gagal menjalankan proses akrual: " + rpcErr.message);

    const r = (result || {}) as {
      sampai_tanggal?: string;
      piutang_diposting?: number;
      piutang_nominal?: number;
      pendapatan_diakui?: number;
      pendapatan_nominal?: number;
      errors?: string[];
    };

    return {
      success: true,
      sampai_tanggal: r.sampai_tanggal ?? sampaiTanggal,
      piutang_diposting: Number(r.piutang_diposting ?? 0),
      piutang_nominal: Number(r.piutang_nominal ?? 0),
      pendapatan_diakui: Number(r.pendapatan_diakui ?? 0),
      pendapatan_nominal: Number(r.pendapatan_nominal ?? 0),
      errors:
        Array.isArray(r.errors) && r.errors.length > 0
          ? r.errors.slice(0, 20)
          : undefined,
    };
  });


/** Pengakuan manual memakai transaksi yang sama dengan cron, termasuk guard tanggal. */
export const akuiPendapatanDimuka = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }): Promise<void> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);
    if (!data?.id) throw new Error("Pendapatan diterima di muka wajib dipilih");
    const { error } = await admin.rpc("akui_pendapatan_dimuka_atomik", {
      p_dimuka_id: data.id,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
  });
