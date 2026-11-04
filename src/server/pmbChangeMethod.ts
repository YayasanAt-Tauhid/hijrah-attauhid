/**
 * Ganti metode pembayaran pendaftaran SPMB publik.
 *
 * Token Snap terikat pada metode yang sudah dipilih (VA/QRIS), jadi metode baru
 * hanya bisa dipilih lewat order baru. Urutan wajib: (1) pastikan belum dibayar,
 * (2) tutup sesi lama di Midtrans, (3) baru buat order baru. Bila langkah 1 atau
 * 2 gagal, tidak ada order baru, sehingga orang tua tidak bisa membayar dua kali.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAdminClient, readEnv } from "./supabase";
import { isGatewayPaid, readGatewayStatus } from "./midtransGateway";
import { closeStoredSession, processGatewayPayment } from "./midtransSessions";
import { createPmbPayment, type PmbPaymentResult } from "./pmbPayment";

export const PMB_MAX_METHOD_CHANGES = 3;
export const PMB_METHOD_CHANGE_REASON = "pmb_ganti_metode";

export interface PmbChangeMethodResult extends PmbPaymentResult {
  /** Sisa kesempatan ganti metode setelah penggantian ini. */
  perubahan_tersisa: number;
}

interface PmbTransaction {
  id: string;
  order_id: string;
  status: string;
  snap_token: string | null;
  gateway_closed_at: string | null;
  expired_at: string | null;
  metadata?: { source?: string; session_closure?: { reason?: string } } | null;
}
interface PmbItemRow {
  jenis_id: string | null;
  pembayaran_id: string | null;
  transaksi: PmbTransaction | null;
}

export const pmbChangePaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((d: { payment_token: string }) => d)
  .handler(async ({ data }): Promise<PmbChangeMethodResult> => {
    const token = typeof data.payment_token === "string" ? data.payment_token.trim() : "";
    if (!token) throw new Error("Data pembayaran PMB tidak lengkap");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: detail } = await admin.from("siswa_detail")
      .select("siswa_id, spmb_status_pendaftaran")
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (!detail?.siswa_id) throw new Error("Tautan pembayaran PMB tidak valid");
    const siswaId = String(detail.siswa_id);

    const { data: siswa } = await admin.from("siswa").select("id, status").eq("id", siswaId).maybeSingle();
    const registrationStatus = detail.spmb_status_pendaftaran || siswa?.status;
    if (registrationStatus !== "calon") throw new Error("Pendaftaran calon siswa tidak aktif");

    const { data: rows, error: rowsError } = await admin.from("transaksi_midtrans_item")
      .select("jenis_id, pembayaran_id, transaksi:transaksi_id(*)")
      .eq("siswa_id", siswaId);
    if (rowsError) throw new Error(rowsError.message);

    const pmbRows = ((rows || []) as PmbItemRow[]).filter((row) => row.transaksi?.metadata?.source === "pmb_public");
    const transactions = pmbRows.map((row) => row.transaksi as PmbTransaction);

    if (transactions.some((tx) => tx.status === "paid")) {
      throw new Error("Pembayaran sudah diterima dan sedang dikonfirmasi. Jangan membuat pembayaran baru.");
    }
    const jenisIds = [...new Set(pmbRows.map((row) => row.jenis_id).filter((id): id is string => !!id))];
    for (const jenisId of jenisIds) {
      const { data: lunas } = await admin.from("pembayaran")
        .select("id")
        .eq("siswa_id", siswaId)
        .eq("jenis_id", jenisId)
        .or("bulan.is.null,bulan.eq.0")
        .limit(1);
      if (lunas && lunas.length > 0) throw new Error("Biaya pendaftaran sudah dibayar");
    }

    const open = transactions.find((tx) => !tx.gateway_closed_at && tx.status === "pending" && !!tx.snap_token) || null;
    if (!open) {
      // Tidak ada sesi aktif (mis. kedaluwarsa): cukup buat order baru, tanpa memakai jatah.
      const created = await createPmbPayment({ payment_token: token });
      return { ...created, perubahan_tersisa: PMB_MAX_METHOD_CHANGES };
    }

    const used = transactions.filter((tx) => tx.metadata?.session_closure?.reason === PMB_METHOD_CHANGE_REASON).length;
    if (used >= PMB_MAX_METHOD_CHANGES) {
      throw new Error(`Ganti metode pembayaran dibatasi maksimal ${PMB_MAX_METHOD_CHANGES} kali. Hubungi sekolah untuk bantuan.`);
    }

    const key = readEnv("MIDTRANS_SERVER_KEY");
    if (!key) throw new Error("Konfigurasi pembayaran belum tersedia.");
    const gateway = await readGatewayStatus(open.order_id, key);
    if (gateway && isGatewayPaid(gateway)) {
      await processGatewayPayment(gateway);
      throw new Error("Pembayaran sudah berhasil di Midtrans dan sedang dicatat. Jangan membayar lagi; muat ulang status beberapa saat lagi.");
    }

    // Gagal menutup = berhenti: order lama mungkin masih bisa dibayar.
    await closeStoredSession(open, PMB_METHOD_CHANGE_REASON);

    const created = await createPmbPayment({ payment_token: token });
    return { ...created, perubahan_tersisa: PMB_MAX_METHOD_CHANGES - used - 1 };
  });
