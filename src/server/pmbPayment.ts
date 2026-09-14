import { createServerFn } from "@tanstack/react-start";
import { createAdminClient, readEnv } from "./supabase";

export interface PmbPaymentInput {
  siswa_id: string;
  payment_token: string;
}

export interface PmbPaymentResult {
  success: true;
  order_id: string;
  total_amount: number;
  jenis_nama: string;
  redirect_url: string;
}

const DEFAULT_ENABLED_PAYMENTS = [
  "credit_card", "bca_va", "bni_va", "bri_va", "permata_va", "other_va",
  "gopay", "shopeepay", "other_qris", "indomaret", "alfamart",
];

function enabledPayments(): string[] {
  const raw = readEnv("MIDTRANS_ENABLED_PAYMENTS");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ENABLED_PAYMENTS;
}

export const pmbCreatePayment = createServerFn({ method: "POST" })
  .inputValidator((d: PmbPaymentInput) => d)
  .handler(async ({ data }): Promise<PmbPaymentResult> => {
    const admin = createAdminClient();
    const siswaId = (data.siswa_id || "").trim();
    const token = (data.payment_token || "").trim();
    if (!siswaId || !token) throw new Error("Data checkout PMB tidak lengkap");

    const { data: detail } = await (admin.from("siswa_detail") as any)
      .select("siswa_id, pmb_payment_token")
      .eq("siswa_id", siswaId)
      .eq("pmb_payment_token", token)
      .maybeSingle();
    if (!detail) throw new Error("Tautan pembayaran PMB tidak valid");

    const { data: siswa, error: siswaErr } = await admin
      .from("siswa")
      .select("id, nama, departemen_id, angkatan_id, status")
      .eq("id", siswaId)
      .eq("status", "calon")
      .maybeSingle();
    if (siswaErr || !siswa || !siswa.departemen_id) throw new Error("Calon siswa tidak ditemukan");

    // Gunakan konfigurasi PMB eksplisit per lembaga. Jangan menebak dari nama jenis pembayaran.
    const { data: config, error: configErr } = await (admin.from("konfigurasi_pmb") as any)
      .select("jenis_pembayaran_id, pembayaran_online_aktif")
      .eq("departemen_id", siswa.departemen_id)
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
    if (jenis.departemen_id && jenis.departemen_id !== siswa.departemen_id) {
      throw new Error("Jenis pembayaran PMB tidak berlaku untuk lembaga calon siswa ini");
    }
    if (!jenis.akun_pendapatan_id) throw new Error(`Akun pendapatan untuk ${jenis.nama} belum dikonfigurasi`);

    // Tolak hanya jika jenis pembayaran PMB yang dikonfigurasi ini sudah dibayar.
    const { data: paidItems } = await admin
      .from("transaksi_midtrans_item")
      .select("id, pembayaran_id, transaksi_midtrans!inner(status)")
      .eq("siswa_id", siswaId)
      .eq("jenis_id", jenis.id)
      .not("pembayaran_id", "is", null)
      .limit(1);
    if (paidItems && paidItems.length > 0) throw new Error(`${jenis.nama} sudah dibayar`);

    const { data: tarif } = await admin.rpc("get_tarif_siswa", {
      p_jenis_id: jenis.id,
      p_siswa_id: siswa.id,
      p_kelas_id: null,
      p_tahun_ajaran_id: null,
    });
    const nominal = Number(tarif) || Number(jenis.nominal) || 0;
    if (nominal <= 0) throw new Error(`Nominal ${jenis.nama} belum dikonfigurasi`);

    const { data: existingPayment } = await admin
      .from("pembayaran")
      .select("id")
      .eq("siswa_id", siswa.id)
      .eq("jenis_id", jenis.id)
      .or("bulan.is.null,bulan.eq.0")
      .limit(1);
    if (existingPayment && existingPayment.length > 0) throw new Error(`${jenis.nama} sudah dibayar`);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const orderId = `HAT-PMB-${dateStr}-${random}`;

    const { data: transaksi, error: txErr } = await (admin.from("transaksi_midtrans") as any)
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
      departemen_id: siswa.departemen_id,
      tahun_ajaran_id: null,
    });
    if (itemErr) {
      await admin.from("transaksi_midtrans").delete().eq("id", transaksi.id);
      throw itemErr;
    }

    const serverKey = readEnv("MIDTRANS_SERVER_KEY");
    if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi");
    const baseUrl = serverKey.startsWith("SB-") ? "https://app.sandbox.midtrans.com" : "https://app.midtrans.com";
    const origin = new URL((await import("@tanstack/react-start/server")).getRequest().url).origin;
    const payments = enabledPayments();
    const payload: Record<string, unknown> = {
      transaction_details: { order_id: orderId, gross_amount: Math.round(nominal) },
      customer_details: { first_name: siswa.nama },
      item_details: [{ id: "PMB-REG", price: Math.round(nominal), quantity: 1, name: `${jenis.nama} - ${siswa.nama}`.slice(0, 50) }],
      enabled_payments: payments,
      callbacks: {
        finish: `${origin}/pmb?payment=finish&order=${encodeURIComponent(orderId)}`,
        unfinish: `${origin}/pmb?payment=pending&order=${encodeURIComponent(orderId)}`,
        error: `${origin}/pmb?payment=error&order=${encodeURIComponent(orderId)}`,
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
      redirect_url: midtrans.redirect_url || `${baseUrl}/snap/v2/vtweb/${midtrans.token}`,
    };
  });
