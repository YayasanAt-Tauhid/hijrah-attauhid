/**
 * Server functions: createPayment, getMidtransConfig
 * Migrasi dari supabase/functions/create-payment & get-midtrans-config.
 *
 * createPayment: buat transaksi Midtrans Snap untuk pembayaran online orang tua.
 * getMidtransConfig: kembalikan client key + mode (sandbox/produksi) untuk Snap.js.
 * buatTransaksiSnap: inti logika yang juga dipakai API route /api/portal/checkout
 * untuk app mobile Portal Ortu.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  billingPeriodLabel,
  findBillingPrerequisite,
  type BillingSequenceBill,
} from "@/lib/billingSequence";
import { isUangPangkalPaymentName } from "@/lib/installment";
import { authMiddleware, requireContext } from "./auth";
import { createAdminClient, readEnv } from "./supabase";
import { paymentExpiry, readGatewayStatus } from "./midtransGateway";
import { processGatewayPayment } from "./midtransSessions";
import { findReusablePaymentForBills, resumeOwnedMidtransPayment, cancelOwnedMidtransPayment } from "./pendingMidtrans";

interface TagihanItem {
  tagihan_id?: string;
  siswa_id: string;
  nama_siswa: string;
  jenis_id: string;
  jenis_nama: string;
  bulan: number;
  jumlah: number;
  departemen_id?: string;
  tahun_ajaran_id?: string;
  departemen_nama?: string;
}

/**
 * Legacy compatibility only. Klien lama masih boleh mengirim field ini,
 * tetapi pilihan channel dan biaya pembayaran sekarang sepenuhnya ditangani
 * Midtrans Snap.
 */
export type PaymentCategory = "qris_gopay" | "lainnya";

export interface CreatePaymentInput {
  items: TagihanItem[];
  customer: {
    user_id: string;
    email: string;
    nama: string;
    telepon?: string;
  };
  payment_category?: PaymentCategory;
}

export interface CreatePaymentResult {
  success: true;
  snap_token: string;
  order_id: string;
  transaksi_id: string;
  total_amount: number;
  /**
   * Dipertahankan untuk kompatibilitas klien lama. Selalu 0 untuk transaksi
   * baru karena fee customer dihitung oleh fitur Split Midtrans fee with customers.
   */
  biaya_admin: number;
  /** True ketika checkout melanjutkan order lama; bukan membuat order baru. */
  reused?: boolean;
  /** URL halaman Snap (vtweb) — dipakai app mobile untuk membuka pembayaran di browser/WebView. */
  redirect_url: string;
}

const NAMA_BULAN = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const DEFAULT_ENABLED_PAYMENTS = [
  "credit_card",
  "bca_va", "bni_va", "bri_va", "permata_va", "other_va",
  "gopay", "shopeepay", "other_qris",
  "indomaret", "alfamart",
];

// MIDTRANS_ENABLED_PAYMENTS: allowlist channel dipisah koma
// (mis. "credit_card,gopay,other_qris"). Jika kosong, gunakan daftar default.
// Pilihan metode dan fee customer tetap ditangani di Midtrans Snap; env ini hanya
// berguna bila sekolah ingin membatasi channel yang memang tersedia di akun.
// Catatan: channel key QRIS generik di Snap adalah "other_qris", BUKAN "qris".
function getEnabledPayments(): string[] {
  const raw = readEnv("MIDTRANS_ENABLED_PAYMENTS");
  if (!raw) return DEFAULT_ENABLED_PAYMENTS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ENABLED_PAYMENTS;
}

export interface SnapCallbacks {
  finish: string;
  unfinish: string;
  error: string;
}

/**
 * Inti pembuatan transaksi Midtrans Snap — dipakai dua jalur:
 *   - server function `createPayment` (portal web, callback ke halaman portal)
 *   - API route `/api/portal/checkout` (app mobile, callback ke deep link app)
 * Validasi kepemilikan siswa, anti double-payment, dan re-fetch nominal dari DB
 * semuanya terjadi di sini sehingga kedua jalur setara keamanannya.
 */
export async function buatTransaksiSnap(params: {
  userId: string;
  input: CreatePaymentInput;
  /** Dipanggil dengan order_id yang baru dibuat agar callback bisa menyematkannya. */
  callbacks: (orderId: string) => SnapCallbacks;
}): Promise<CreatePaymentResult> {
  const admin = createAdminClient();
  const { userId, callbacks } = params;

  const { items, customer } = params.input;
  if (!items || items.length === 0) {
    throw new Error("Tidak ada tagihan yang dipilih");
  }

  // Validasi: semua siswa_id memang anak dari user ini
  const siswaIds = [...new Set(items.map((i) => i.siswa_id))];
  const { data: ortuData, error: ortuError } = await admin
    .from("ortu_siswa")
    .select("siswa_id")
    .eq("user_id", userId)
    .in("siswa_id", siswaIds);
  if (ortuError) throw ortuError;
  if (!ortuData || ortuData.length !== siswaIds.length) {
    throw new Error("Akses ditolak: beberapa siswa bukan anak Anda");
  }

  // Validasi pembayaran dilakukan terhadap tagihan exact di bawah. Untuk
  // tagihan sekali bayar, beberapa pembayaran memang sah karena merupakan cicilan.
  // Re-fetch TAGIHAN dari DB (JANGAN percaya nominal frontend). Untuk
  // tagihan sekali bayar yang sudah jatuh tempo, jumlah frontend adalah nominal
  // cicilan yang diminta; server tetap menghitung sisa dan membatasi nominalnya.
  const validatedItems: TagihanItem[] = [];
  for (const item of items) {
    let tagihanQuery = admin
      .from("tagihan")
      .select("id, nominal, nominal_bruto, nominal_diskon, status, tahun_ajaran_id, bulan, jatuh_tempo")
      .eq("siswa_id", item.siswa_id)
      .eq("jenis_id", item.jenis_id);

    if (item.tagihan_id) {
      tagihanQuery = tagihanQuery.eq("id", item.tagihan_id);
    } else if (item.tahun_ajaran_id) {
      tagihanQuery = tagihanQuery.eq("tahun_ajaran_id", item.tahun_ajaran_id);
    }

    tagihanQuery =
      item.bulan === 0
        ? tagihanQuery.is("bulan", null)
        : tagihanQuery.eq("bulan", item.bulan);

    const { data: tagihanRows, error: tagihanError } = await tagihanQuery
      .in("status", ["belum_bayar", "sebagian", "terjadwal"])
      .limit(2);

    if (tagihanError) throw tagihanError;
    if (!tagihanRows || tagihanRows.length === 0) {
      throw new Error(
        `Tagihan aktif tidak ditemukan untuk ${item.jenis_nama} - ${item.nama_siswa}`
      );
    }
    if (tagihanRows.length > 1) {
      throw new Error(
        `Periode tagihan tidak unik untuk ${item.jenis_nama} - ${item.nama_siswa}. Silakan pilih ulang tagihan.`
      );
    }

    const tagihan = tagihanRows[0];
    const nominalTagihan = Number(tagihan.nominal) || 0;
    if (nominalTagihan <= 0) {
      throw new Error(
        `Nominal tagihan tidak valid untuk ${item.jenis_nama} - ${item.nama_siswa}`
      );
    }

    const { data: paidRows, error: paidError } = await admin
      .from("pembayaran")
      .select("jumlah")
      .eq("tagihan_id", tagihan.id);
    if (paidError) throw paidError;
    const totalSudahBayar = (paidRows || []).reduce(
      (sum, row) => sum + Number(row.jumlah || 0),
      0
    );
    const sisa = Math.max(nominalTagihan - totalSudahBayar, 0);
    if (sisa <= 0) {
      throw new Error(
        `Tagihan ${item.jenis_nama} untuk ${item.nama_siswa} sudah lunas`
      );
    }

    const requested = Number(item.jumlah);
    if (!Number.isSafeInteger(requested) || requested <= 0) {
      throw new Error("Jumlah pembayaran harus lebih dari 0");
    }
    if (requested > sisa) {
      throw new Error(
        `Jumlah pembayaran ${item.jenis_nama} melebihi sisa tagihan`
      );
    }

    const cicilanDiizinkan =
      item.bulan === 0 &&
      (tagihan.status !== "terjadwal" ||
        isUangPangkalPaymentName(item.jenis_nama));
    if (!cicilanDiizinkan && requested !== sisa) {
      throw new Error(
        tagihan.status === "terjadwal"
          ? "Tagihan yang belum jatuh tempo harus dibayar penuh"
          : "Tagihan bulanan harus dibayar penuh"
      );
    }

    validatedItems.push({
      ...item,
      tagihan_id: tagihan.id,
      jumlah: requested,
      departemen_id: item.departemen_id || undefined,
      tahun_ajaran_id: tagihan.tahun_ajaran_id || item.tahun_ajaran_id || undefined,
    });
  }

  // Tagihan bulanan wajib dibayar berurutan per siswa + jenis pembayaran.
  // Beberapa bulan boleh dibayar dalam satu transaksi selama pilihan tersebut
  // merupakan prefix berurutan dari tagihan terbuka yang paling lama.
  const periodicGroups = new Map<string, TagihanItem[]>();
  for (const item of validatedItems) {
    if (item.bulan <= 0 || !item.tagihan_id) continue;
    const key = `${item.siswa_id}:${item.jenis_id}`;
    const group = periodicGroups.get(key) ?? [];
    group.push(item);
    periodicGroups.set(key, group);
  }

  for (const groupItems of periodicGroups.values()) {
    const first = groupItems[0];
    const { data: openRows, error: openError } = await admin
      .from("tagihan")
      .select(
        "id, siswa_id, jenis_id, bulan, jatuh_tempo, tahun_ajaran:tahun_ajaran_id(nama, tanggal_mulai)"
      )
      .eq("siswa_id", first.siswa_id)
      .eq("jenis_id", first.jenis_id)
      .not("bulan", "is", null)
      .in("status", ["belum_bayar", "sebagian", "terjadwal"]);

    if (openError) {
      throw new Error("Gagal memeriksa urutan tagihan: " + openError.message);
    }

    const openBills = (openRows ?? []) as unknown as BillingSequenceBill[];
    const selectedIds = new Set(
      groupItems
        .map((item) => item.tagihan_id)
        .filter((id): id is string => Boolean(id)),
    );

    for (const item of groupItems) {
      const target = openBills.find((bill) => bill.id === item.tagihan_id);
      if (!target) {
        throw new Error(
          `Tagihan ${item.jenis_nama} untuk ${item.nama_siswa} sudah berubah. Silakan pilih ulang tagihan.`
        );
      }

      const prerequisite = findBillingPrerequisite(
        target,
        openBills,
        selectedIds,
      );
      if (prerequisite) {
        throw new Error(
          `Selesaikan ${item.jenis_nama} ${billingPeriodLabel(prerequisite)} terlebih dahulu sebelum membayar ${billingPeriodLabel(target)}.`
        );
      }
    }
  }

  const totalAmount = validatedItems.reduce((sum, i) => sum + i.jumlah, 0);
  // Fee customer tidak lagi dihitung aplikasi. Midtrans yang menambahkan dan
  // menampilkan fee sesuai metode berdasarkan konfigurasi dashboard.
  const biayaAdmin = 0;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
  const orderId = `HAT-${dateStr}-${random}`;

  const serverKey = readEnv("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
  const baseUrl = serverKey.startsWith("SB-") ? "https://app.sandbox.midtrans.com" : "https://app.midtrans.com";
  const authString = btoa(`${serverKey}:`);
  const billIds = validatedItems.map(item => item.tagihan_id!);
  if (new Set(billIds).size !== billIds.length) throw new Error("Tagihan yang sama tidak boleh dipilih dua kali");
  // Resume an identical active checkout instead of generating a second Midtrans order.
  // If another pending session overlaps, the parent must cancel it explicitly first.
  const reusablePayment = await findReusablePaymentForBills(userId,
    validatedItems.map(item => ({ tagihan_id: item.tagihan_id!, jumlah: item.jumlah })));
  if (reusablePayment) return reusablePayment;
  const itemsToInsert = validatedItems.map((item) => ({
    tagihan_id: item.tagihan_id,
    siswa_id: item.siswa_id,
    jenis_id: item.jenis_id,
    bulan: item.bulan,
    jumlah: item.jumlah,
    nama_item: `${item.jenis_nama} - ${item.nama_siswa} - ${NAMA_BULAN[item.bulan]}`,
    departemen_id: item.departemen_id || null,
    tahun_ajaran_id: item.tahun_ajaran_id || null,
  }));
  const { data: transaksi, error: txError } = await (admin as any).rpc("create_midtrans_checkout_atomik", {
    p_user_id: userId, p_order_id: orderId, p_items: itemsToInsert,
    p_expired_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
  });
  if (txError) throw new Error(txError.message);

  const itemDetails = validatedItems.map((item, idx) => ({
    id: `ITEM-${idx + 1}-${item.bulan}`,
    price: Math.round(item.jumlah),
    quantity: 1,
    name: `${item.jenis_nama} ${NAMA_BULAN[item.bulan]} - ${item.nama_siswa}`.substring(
      0,
      50
    ),
  }));

  const enabledPayments = getEnabledPayments();
  const midtransPayload: Record<string, unknown> = {
    transaction_details: {
      order_id: orderId,
      gross_amount: Math.round(totalAmount),
    },
    customer_details: {
      first_name: customer.nama,
      email: customer.email,
      phone: customer.telepon || "",
    },
    item_details: itemDetails,
    callbacks: callbacks(orderId),
    expiry: paymentExpiry(now),
    page_expiry: { unit: "hours", duration: 24 },
    enabled_payments: enabledPayments,
  };

  if (enabledPayments.includes("other_qris")) {
    // "other_qris" (channel QRIS generik) wajib disertai acquirer di Snap.
    midtransPayload.qris = { acquirer: "gopay" };
  }

  // Persist the exact request before contacting the gateway, so a timed-out
  // token response can be recovered with the same order ID instead of unlocking.
  const { error: requestSaveError } = await (admin as any).from("transaksi_midtrans").update({
    metadata: { ...(transaksi.metadata || {}), snap_request: midtransPayload },
  }).eq("id", transaksi.id).eq("status", "pending");
  if (requestSaveError) throw requestSaveError;

  const midtransRes = await fetch(`${baseUrl}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${authString}`,
    },
    body: JSON.stringify(midtransPayload),
    signal: AbortSignal.timeout(12000),
  });
  const midtransData = await midtransRes.json();

  if (!midtransRes.ok || !midtransData.token) {
    // A timeout/5xx/duplicate order may have created a session remotely.
    // Keep the reservation until its closure can be confirmed.
    const rejection = [400, 401, 403, 422].includes(midtransRes.status) &&
      !/duplicate|sudah digunakan|already.*(used|utilized)/i.test(JSON.stringify(midtransData));
    await (admin as any).from("transaksi_midtrans").update({
      ...(rejection ? { status: "failed", gateway_closed_at: new Date().toISOString() } : {}),
      reconciliation_error: "Pembuatan sesi Midtrans belum berhasil dikonfirmasi",
    }).eq("id", transaksi.id);
    throw new Error(
      midtransData.error_messages?.[0] || "Gagal membuat transaksi Midtrans"
    );
  }

  const { data: savedToken, error: tokenError } = await admin
    .from("transaksi_midtrans")
    .update({ snap_token: midtransData.token })
    .eq("id", transaksi.id).eq("status", "pending")
    .select("id");
  if (tokenError || !savedToken?.length) {
    throw new Error("Sesi pembayaran belum dapat disimpan. Pembayaran baru ditahan sampai pemeriksaan selesai.");
  }

  return {
    success: true,
    snap_token: midtransData.token,
    order_id: orderId,
    transaksi_id: transaksi.id,
    total_amount: totalAmount,
    biaya_admin: biayaAdmin,
    redirect_url:
      midtransData.redirect_url || `${baseUrl}/snap/v2/vtweb/${midtransData.token}`,
  };
}

export const createPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CreatePaymentInput) => d)
  .handler(async ({ data, context }): Promise<CreatePaymentResult> => {
    // Gunakan origin dari URL request yang diterima server, bukan header
    // Origin/Referer yang berasal dari klien dan dapat dipalsukan. Dengan ini
    // callback Midtrans tidak dapat diarahkan ke domain arbitrer oleh pemanggil.
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;

    const result = await buatTransaksiSnap({
      userId: requireContext(context).userId,
      input: data,
      callbacks: (orderId) => ({
        finish: `${origin}/portal/pembayaran?order=${orderId}`,
        unfinish: `${origin}/portal/tagihan`,
        error: `${origin}/portal/tagihan`,
      }),
    });
    return result;
  });

/** The order owner alone may resume a still-valid Snap token. */
export const resumePendingMidtransPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: SyncMidtransPaymentInput) => d)
  .handler(async ({ data, context }): Promise<CreatePaymentResult> =>
    resumeOwnedMidtransPayment(requireContext(context).userId, String(data?.order_id || "").trim())
  );

/** Parent-requested cancellation always closes the gateway before freeing a bill. */
export const cancelPendingMidtransPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: SyncMidtransPaymentInput) => d)
  .handler(async ({ data, context }) =>
    cancelOwnedMidtransPayment(requireContext(context).userId, String(data?.order_id || "").trim())
  );

export interface MidtransConfig {
  client_key: string;
  is_sandbox: boolean;
  snap_url: string;
}

// Publik — tidak butuh auth (setara get-midtrans-config lama).
export const getMidtransConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<MidtransConfig> => {
    const clientKey = readEnv("MIDTRANS_CLIENT_KEY") || "";
    const serverKey = readEnv("MIDTRANS_SERVER_KEY") || "";
    const isSandbox =
      clientKey.startsWith("SB-") || serverKey.startsWith("SB-");
    return {
      client_key: clientKey,
      is_sandbox: isSandbox,
      snap_url: isSandbox
        ? "https://app.sandbox.midtrans.com/snap/snap.js"
        : "https://app.midtrans.com/snap/snap.js",
    };
  }
);

export interface SyncMidtransPaymentInput {
  order_id: string;
}

export interface SyncMidtransPaymentResult {
  order_id: string;
  status: string;
  gateway_status: string | null;
}

/**
 * Fallback rekonsiliasi ketika webhook Midtrans terlambat atau tidak sampai.
 * Hanya pemilik order yang boleh memanggilnya. Status resmi tetap diambil
 * langsung dari Status API Midtrans, lalu payload sah tersebut diproses oleh
 * handler webhook yang sama agar pencatatan pembayaran dan jurnal tetap atomik.
 */
export const syncMidtransPaymentStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: SyncMidtransPaymentInput) => d)
  .handler(async ({ data, context }): Promise<SyncMidtransPaymentResult> => {
    const orderId = String(data?.order_id || "").trim();
    if (!/^HAT-[A-Z0-9-]+$/.test(orderId)) {
      throw new Error("Order ID tidak valid");
    }

    const admin = createAdminClient();
    const userId = requireContext(context).userId;
    const { data: transaksi, error: txError } = await admin
      .from("transaksi_midtrans")
      .select("order_id, status, midtrans_payment_status")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (txError) throw txError;
    if (!transaksi) throw new Error("Transaksi tidak ditemukan");
    if (transaksi.status !== "pending") {
      return {
        order_id: transaksi.order_id,
        status: transaksi.status,
        gateway_status: transaksi.midtrans_payment_status,
      };
    }

    const serverKey = readEnv("MIDTRANS_SERVER_KEY") || "";
    if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
    const gatewayPayload = await readGatewayStatus(orderId, serverKey);
    if (!gatewayPayload) {
      return { order_id: orderId, status: transaksi.status, gateway_status: null };
    }
    await processGatewayPayment(gatewayPayload);

    const { data: refreshed, error: refreshError } = await admin
      .from("transaksi_midtrans")
      .select("order_id, status, midtrans_payment_status")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .single();
    if (refreshError) throw refreshError;

    return {
      order_id: refreshed.order_id,
      status: refreshed.status,
      gateway_status: refreshed.midtrans_payment_status,
    };
  });