import { createServerFn } from "@tanstack/react-start";
import { createAdminClient, readEnv } from "./supabase";

export interface PmbPaymentInput {
  siswa_id?: string;
  payment_token: string;
}

export interface PmbPaymentResult {
  success: true;
  order_id: string;
  total_amount: number;
  jenis_nama: string;
  redirect_url: string;
}

export type PmbPaymentStatus =
  | "unpaid"
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "expired";

export interface PmbRegistrationStatusResult {
  success: true;
  siswa_id: string;
  nama: string;
  departemen_nama: string | null;
  status_pendaftaran: string;
  terverifikasi: boolean;
  payment_status: PmbPaymentStatus;
  jenis_nama: string | null;
  total_amount: number | null;
  order_id: string | null;
  paid_at: string | null;
  can_pay: boolean;
}

const DEFAULT_ENABLED_PAYMENTS = [
  "credit_card", "bca_va", "bni_va", "bri_va", "permata_va", "other_va",
  "gopay", "shopeepay", "other_qris", "indomaret", "alfamart",
];

function enabledPayments(): string[] {
  const raw = readEnv("MIDTRANS_ENABLED_PAYMENTS");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ENABLED_PAYMENTS;
}

function paymentRedirectUrl(baseUrl: string, snapToken: string): string {
  return `${baseUrl}/snap/v2/vtweb/${snapToken}`;
}

export const pmbGetStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { payment_token: string }) => d)
  .handler(async ({ data }): Promise<PmbRegistrationStatusResult> => {
    const admin = createAdminClient();
    const token = (data.payment_token || "").trim();
    if (!token) throw new Error("Token pendaftaran PMB tidak lengkap");

    const { data: detail } = await admin.from("siswa_detail")
      .select("siswa_id, spmb_departemen_tujuan_id, spmb_status_pendaftaran")
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (!detail?.siswa_id) throw new Error("Pendaftaran PMB tidak ditemukan");

    const { data: siswa, error: siswaErr } = await admin
      .from("siswa")
      .select("id, nama, departemen_id, status, terverifikasi")
      .eq("id", detail.siswa_id)
      .maybeSingle();
    if (siswaErr || !siswa) throw new Error("Calon siswa tidak ditemukan");

    const pmbDepartemenId = (detail as any).spmb_departemen_tujuan_id || siswa.departemen_id;
    const registrationStatus = (detail as any).spmb_status_pendaftaran || siswa.status;
    let departemenNama: string | null = null;
    if (pmbDepartemenId) {
      const { data: departemen } = await admin
        .from("departemen")
        .select("nama")
        .eq("id", pmbDepartemenId)
        .maybeSingle();
      departemenNama = departemen?.nama || null;
    }

    if (!pmbDepartemenId) {
      return {
        success: true,
        siswa_id: siswa.id,
        nama: siswa.nama,
        departemen_nama: departemenNama,
        status_pendaftaran: registrationStatus,
        terverifikasi: !!siswa.terverifikasi,
        payment_status: "unpaid",
        jenis_nama: null,
        total_amount: null,
        order_id: null,
        paid_at: null,
        can_pay: false,
      };
    }

    const { data: config } = await admin.from("konfigurasi_pmb")
      .select("jenis_pembayaran_id, pembayaran_online_aktif")
      .eq("departemen_id", pmbDepartemenId)
      .maybeSingle();

    if (!config?.jenis_pembayaran_id) {
      return {
        success: true,
        siswa_id: siswa.id,
        nama: siswa.nama,
        departemen_nama: departemenNama,
        status_pendaftaran: registrationStatus,
        terverifikasi: !!siswa.terverifikasi,
        payment_status: "unpaid",
        jenis_nama: null,
        total_amount: null,
        order_id: null,
        paid_at: null,
        can_pay: false,
      };
    }

    const { data: jenis } = await admin
      .from("jenis_pembayaran")
      .select("id, nama, nominal")
      .eq("id", config.jenis_pembayaran_id)
      .maybeSingle();

    if (!jenis) throw new Error("Jenis pembayaran PMB tidak ditemukan");

    const { data: tarifStatus } = await admin.rpc("get_tarif_siswa", {
      p_jenis_id: jenis.id,
      p_siswa_id: siswa.id,
      p_kelas_id: null,
      p_tahun_ajaran_id: null,
    });
    const configuredNominal = Number(tarifStatus) || Number(jenis.nominal) || null;

    const { data: pembayaranRows } = await admin
      .from("pembayaran")
      .select("id, jumlah, tanggal_bayar")
      .eq("siswa_id", siswa.id)
      .eq("jenis_id", jenis.id)
      .or("bulan.is.null,bulan.eq.0")
      .order("tanggal_bayar", { ascending: false })
      .limit(1);
    const pembayaran = pembayaranRows?.[0] || null;

    const { data: itemRows } = await admin
      .from("transaksi_midtrans_item")
      .select("transaksi_id, created_at")
      .eq("siswa_id", siswa.id)
      .eq("jenis_id", jenis.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const txCandidates: Array<{
      order_id: string;
      status: string;
      total_amount: number;
      paid_at: string | null;
      expired_at: string | null;
    }> = [];
    for (const item of itemRows || []) {
      const { data: tx } = await admin.from("transaksi_midtrans")
        .select("order_id, status, total_amount, paid_at, expired_at")
        .eq("id", item.transaksi_id)
        .maybeSingle();
      if (tx) txCandidates.push(tx);
    }

    // Jika ada beberapa order historis, status gateway `paid` selalu lebih
    // penting daripada order `pending` yang mungkin dibuat setelahnya. Ini
    // mencegah wali membayar dua kali ketika webhook masih menyelesaikan jurnal.
    const processingTx = txCandidates.find((tx) => tx.status === "paid") || null;
    const activePendingTx = txCandidates.find((tx) => {
      if (tx.status !== "pending") return false;
      return !tx.expired_at || new Date(tx.expired_at).getTime() > Date.now();
    }) || null;
    const latestTx = processingTx || activePendingTx || txCandidates[0] || null;

    let paymentStatus: PmbPaymentStatus = "unpaid";
    if (pembayaran) {
      // Hanya tabel pembayaran internal yang menjadi sumber kebenaran untuk `Lunas`.
      paymentStatus = "paid";
    } else if (processingTx) {
      paymentStatus = "processing";
    } else if (activePendingTx) {
      paymentStatus = "pending";
    } else if (latestTx?.status === "expired") {
      paymentStatus = "expired";
    } else if (latestTx?.status === "failed") {
      paymentStatus = "failed";
    } else if (latestTx?.status === "pending") {
      paymentStatus = "expired";
    }

    const nominal = Number(latestTx?.total_amount) || Number(pembayaran?.jumlah) || configuredNominal;
    const canPay =
      registrationStatus === "calon" &&
      config.pembayaran_online_aktif === true &&
      ["unpaid", "pending", "failed", "expired"].includes(paymentStatus);

    return {
      success: true,
      siswa_id: siswa.id,
      nama: siswa.nama,
      departemen_nama: departemenNama,
      status_pendaftaran: registrationStatus,
      terverifikasi: !!siswa.terverifikasi,
      payment_status: paymentStatus,
      jenis_nama: jenis.nama,
      total_amount: nominal,
      order_id: latestTx?.order_id || null,
      paid_at: pembayaran?.tanggal_bayar || latestTx?.paid_at || null,
      can_pay: canPay,
    };
  });

export const pmbCreatePayment = createServerFn({ method: "POST" })
  .inputValidator((d: PmbPaymentInput) => d)
  .handler(async ({ data }): Promise<PmbPaymentResult> => {
    const admin = createAdminClient();
    const expectedSiswaId = (data.siswa_id || "").trim();
    const token = (data.payment_token || "").trim();
    if (!token) throw new Error("Data checkout PMB tidak lengkap");

    // Token pendaftaran adalah credential publik yang opaque. siswa_id hanya
    // dipakai sebagai cross-check bila masih tersedia di state browser.
    const { data: detail } = await admin.from("siswa_detail")
      .select("siswa_id, pmb_payment_token, spmb_departemen_tujuan_id, spmb_status_pendaftaran")
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (!detail?.siswa_id) throw new Error("Tautan pembayaran PMB tidak valid");
    if (expectedSiswaId && expectedSiswaId !== detail.siswa_id) {
      throw new Error("Data pendaftaran PMB tidak cocok");
    }
    const siswaId = detail.siswa_id as string;

    const { data: siswa, error: siswaErr } = await admin
      .from("siswa")
      .select("id, nama, departemen_id, angkatan_id, status")
      .eq("id", siswaId)
      .maybeSingle();
    if (siswaErr || !siswa) throw new Error("Calon siswa tidak ditemukan");
    const pmbDepartemenId = (detail as any).spmb_departemen_tujuan_id || siswa.departemen_id;
    const registrationStatus = (detail as any).spmb_status_pendaftaran || siswa.status;
    if (!pmbDepartemenId || registrationStatus !== "calon") throw new Error("Pendaftaran calon siswa tidak aktif");

    // Gunakan konfigurasi PMB eksplisit per lembaga. Jangan menebak dari nama jenis pembayaran.
    const { data: config, error: configErr } = await admin.from("konfigurasi_pmb")
      .select("jenis_pembayaran_id, pembayaran_online_aktif")
      .eq("departemen_id", pmbDepartemenId)
      .maybeSingle();
    if (configErr) throw configErr;
    if (!config) throw new Error("Konfigurasi pembayaran PMB belum diset untuk lembaga ini");
    if (!config.pembayaran_online_aktif) throw new Error("Pembayaran online PMB sedang dinonaktifkan untuk lembaga ini");

    const { data: jenis, error: jenisErr } = await admin
      .from("jenis_pembayaran")
      .select("id, nama, nominal, departemen_id, akun_pendapatan_id, aktif")
      .eq("id", config.jenis_pembayaran_id)
      .eq("aktif", true)
      .maybeSingle();
    if (jenisErr) throw jenisErr;
    if (!jenis) throw new Error("Jenis pembayaran PMB yang dikonfigurasi tidak ditemukan atau tidak aktif");
    if (jenis.departemen_id && jenis.departemen_id !== pmbDepartemenId) {
      throw new Error("Jenis pembayaran PMB tidak berlaku untuk lembaga calon siswa ini");
    }
    if (!jenis.akun_pendapatan_id) throw new Error(`Akun pendapatan untuk ${jenis.nama} belum dikonfigurasi`);

    // Pembayaran internal adalah sumber kebenaran untuk status lunas.
    const { data: existingPayment } = await admin
      .from("pembayaran")
      .select("id")
      .eq("siswa_id", siswa.id)
      .eq("jenis_id", jenis.id)
      .or("bulan.is.null,bulan.eq.0")
      .limit(1);
    if (existingPayment && existingPayment.length > 0) throw new Error(`${jenis.nama} sudah dibayar`);

    const serverKey = readEnv("MIDTRANS_SERVER_KEY");
    if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
    const baseUrl = serverKey.startsWith("SB-") ? "https://app.sandbox.midtrans.com" : "https://app.midtrans.com";

    // Jangan membuat order baru jika transaksi lama masih bisa dilanjutkan.
    const { data: recentItems } = await admin
      .from("transaksi_midtrans_item")
      .select("transaksi_id, created_at")
      .eq("siswa_id", siswa.id)
      .eq("jenis_id", jenis.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const recentTransactions: Array<{
      order_id: string;
      total_amount: number;
      status: string;
      snap_token: string | null;
      expired_at: string | null;
    }> = [];
    for (const item of recentItems || []) {
      const { data: tx } = await admin.from("transaksi_midtrans")
        .select("order_id, total_amount, status, snap_token, expired_at")
        .eq("id", item.transaksi_id)
        .maybeSingle();
      if (tx) recentTransactions.push(tx);
    }

    if (recentTransactions.some((tx) => tx.status === "paid")) {
      throw new Error("Pembayaran sudah diterima dan sedang dikonfirmasi. Jangan membuat pembayaran baru.");
    }

    const pendingTx = recentTransactions.find((tx) => {
      const belumKedaluwarsa = !tx.expired_at || new Date(tx.expired_at).getTime() > Date.now();
      return tx.status === "pending" && !!tx.snap_token && belumKedaluwarsa;
    });
    if (pendingTx?.snap_token) {
      return {
        success: true,
        order_id: pendingTx.order_id,
        total_amount: Number(pendingTx.total_amount),
        jenis_nama: jenis.nama,
        redirect_url: paymentRedirectUrl(baseUrl, pendingTx.snap_token),
      };
    }

    const { data: tarif } = await admin.rpc("get_tarif_siswa", {
      p_jenis_id: jenis.id,
      p_siswa_id: siswa.id,
      p_kelas_id: null,
      p_tahun_ajaran_id: null,
    });
    const nominal = Number(tarif) || Number(jenis.nominal) || 0;
    if (nominal <= 0) throw new Error(`Nominal ${jenis.nama} belum dikonfigurasi`);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const orderId = `HAT-PMB-${dateStr}-${random}`;

    const { data: transaksi, error: txErr } = await admin.from("transaksi_midtrans")
      .insert({
        order_id: orderId,
        user_id: null,
        total_amount: nominal,
        biaya_admin: 0,
        status: "pending",
        expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        metadata: { source: "pmb_public", siswa_id: siswa.id, jenis_id: jenis.id },
      })
      .select("id")
      .single();
    if (txErr) throw txErr;

    const { error: itemErr } = await admin.from("transaksi_midtrans_item").insert({
      transaksi_id: transaksi.id,
      siswa_id: siswa.id,
      jenis_id: jenis.id,
      bulan: 0,
      jumlah: nominal,
      nama_item: `${jenis.nama} - ${siswa.nama}`,
      departemen_id: pmbDepartemenId,
      tahun_ajaran_id: null,
    });
    if (itemErr) {
      await admin.from("transaksi_midtrans").delete().eq("id", transaksi.id);
      throw itemErr;
    }

    const origin = new URL((await import("@tanstack/react-start/server")).getRequest().url).origin;
    const payments = enabledPayments();
    // Token hanya dibawa sekali pada fragment callback agar browser dapat
    // memulihkan pendaftaran. Fragment tidak dikirim ke server/referrer.
    // Halaman /spmb segera memindahkannya ke sessionStorage lalu membersihkannya.
    const registrationFragment = encodeURIComponent(token);
    const payload: Record<string, unknown> = {
      transaction_details: { order_id: orderId, gross_amount: Math.round(nominal) },
      customer_details: { first_name: siswa.nama },
      item_details: [{ id: "PMB-REG", price: Math.round(nominal), quantity: 1, name: `${jenis.nama} - ${siswa.nama}`.slice(0, 50) }],
      enabled_payments: payments,
      callbacks: {
        finish: `${origin}/spmb?payment=finish&order=${encodeURIComponent(orderId)}#registration=${registrationFragment}`,
        unfinish: `${origin}/spmb?payment=pending&order=${encodeURIComponent(orderId)}#registration=${registrationFragment}`,
        error: `${origin}/spmb?payment=error&order=${encodeURIComponent(orderId)}#registration=${registrationFragment}`,
      },
      expiry: { unit: "hours", duration: 24 },
    };
    if (payments.includes("other_qris")) payload.qris = { acquirer: "gopay" };

    const res = await fetch(`${baseUrl}/snap/v1/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${serverKey}:`)}` },
      body: JSON.stringify(payload),
    });
    const midtrans = await res.json();
    if (!res.ok || !midtrans.token) {
      await admin.from("transaksi_midtrans").delete().eq("id", transaksi.id);
      throw new Error(midtrans.error_messages?.[0] || "Gagal membuat pembayaran Midtrans");
    }

    await admin.from("transaksi_midtrans").update({ snap_token: midtrans.token }).eq("id", transaksi.id);
    return {
      success: true,
      order_id: orderId,
      total_amount: nominal,
      jenis_nama: jenis.nama,
      redirect_url: midtrans.redirect_url || paymentRedirectUrl(baseUrl, midtrans.token),
    };
  });
