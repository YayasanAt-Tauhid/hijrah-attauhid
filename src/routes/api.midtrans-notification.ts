/**
 * Server route: POST /api/midtrans-notification
 * Migrasi dari supabase/functions/midtrans-notification.
 *
 * Webhook publik yang dipanggil server Midtrans (bukan frontend). Verifikasi
 * signature, update status transaksi, buat record pembayaran + auto-jurnal,
 * dan kirim notifikasi ke orang tua saat pembayaran lunas.
 *
 * PENTING: setelah migrasi, ubah "Notification URL" di dashboard Midtrans ke
 *   https://<domain-anda>/api/midtrans-notification
 */
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, readEnv } from "@/server/supabase";
import { kirimPushKeOrtu } from "@/server/push";

async function sha512(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function tanggalJakarta(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function handleNotification(request: Request): Promise<Response> {
  try {
    const notification = await request.json();

    const {
      order_id,
      transaction_id,
      gross_amount,
      transaction_status,
      payment_type,
      signature_key,
      status_code,
      fraud_status,
    } = notification;

    // 0. Akun Midtrans dipakai bersama beberapa aplikasi lewat webhook
    //    forwarder yang broadcast ke semua endpoint terdaftar. Notifikasi
    //    order_id milik aplikasi lain diabaikan lebih awal di sini supaya
    //    tidak membebani DB dengan query yang pasti tidak ketemu.
    if (typeof order_id !== "string" || !order_id.startsWith("HAT-")) {
      return new Response(
        JSON.stringify({ message: "Ignored: bukan order Hijrah At-Tauhid" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Verifikasi signature Midtrans
    const serverKey = readEnv("MIDTRANS_SERVER_KEY") || "";
    const expectedSignature = await sha512(
      `${order_id}${status_code}${gross_amount}${serverKey}`
    );
    if (signature_key !== expectedSignature) {
      return new Response("Invalid signature", { status: 403 });
    }

    // Client service-role dibuat SETELAH notifikasi terbukti sah dan memang
    // milik kita. Dulu dibuat di baris pertama handler, DI LUAR blok try:
    // kalau env belum lengkap, `createAdminClient()` melempar tanpa tertangkap
    // sehingga worker membalas 5xx mentah — dan notifikasi milik aplikasi lain
    // pun ikut gagal, padahal seharusnya cukup dibalas "Ignored" di atas.
    const admin = createAdminClient();

    // 2. Ambil transaksi.
    //    `maybeSingle()` (bukan `single()`) supaya "tidak ada baris" pulang
    //    sebagai data null, bukan error — dengan begitu `txFetchError` benar-
    //    benar hanya berisi kegagalan nyata (koneksi, key salah, permission,
    //    relasi embed), yang wajib dibedakan dari order milik aplikasi lain.
    const { data: transaksi, error: txFetchError } = await admin
      .from("transaksi_midtrans")
      .select("*, transaksi_midtrans_item(*)")
      .eq("order_id", order_id)
      .maybeSingle();
    // Dulu `txFetchError || !transaksi` sama-sama dibalas 404 "Order not
    // found", sehingga salah konfigurasi tidak bisa dibedakan dari order yang
    // memang bukan milik kita — persis yang bikin diagnosis webhook berputar.
    if (txFetchError) {
      return new Response(
        JSON.stringify({
          message: "Gagal mengambil transaksi",
          order_id,
          error: txFetchError.message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!transaksi) {
      return new Response("Order not found", { status: 404 });
    }

    // 3. Tentukan status baru
    let newStatus: string = transaksi.status;
    let paidAt: string | null = null;

    if (
      transaction_status === "capture" ||
      transaction_status === "settlement"
    ) {
      if (transaction_status === "capture" && fraud_status !== "accept") {
        newStatus = "failed";
      } else {
        newStatus = "paid";
        paidAt = new Date().toISOString();
      }
    } else if (
      transaction_status === "deny" ||
      transaction_status === "cancel" ||
      transaction_status === "failure"
    ) {
      newStatus = "failed";
    } else if (transaction_status === "expire") {
      newStatus = "expired";
    } else if (transaction_status === "pending") {
      newStatus = "pending";
    }

    // 4. Update transaksi
    const { error: updateError } = await admin
      .from("transaksi_midtrans")
      .update({
        status: newStatus,
        payment_type,
        midtrans_transaction_id: transaction_id,
        midtrans_payment_status: transaction_status,
        fraud_status: fraud_status || null,
        paid_at: paidAt,
        metadata: notification,
      })
      .eq("order_id", order_id);
    if (updateError) throw updateError;

    // 5. Jika PAID → proses pembayaran + jurnal SECARA ATOMIK per item
    //    via RPC proses_pembayaran_midtrans_dengan_kuitansi_atomik. Setiap item sukses/gagal
    //    independen (dicatat di hasilItems), tidak lagi ada silent-catch:
    //    kegagalan jurnal SELALU berarti pembayaran juga tidak tercatat untuk
    //    item itu (rollback RPC), dan errornya disimpan ke metadata transaksi.
    if (newStatus === "paid") {
      const items = transaksi.transaksi_midtrans_item || [];
      // Tanggal pembukuan mengikuti hari operasional sekolah (WIB), bukan UTC.
      // Tanpa ini, pembayaran antara 00.00–06.59 WIB tercatat sebagai hari sebelumnya.
      const today = tanggalJakarta();

      // Ambil akun Bank Midtrans (debit) sekali di awal
      const { data: bankMidtransSetting } = await admin
        .from("pengaturan_akun")
        .select("akun_id")
        .eq("kode_setting", "bank_midtrans")
        .maybeSingle();
      const bankMidtransId = bankMidtransSetting?.akun_id ?? null;

      const hasilItems: Array<{
        item_id: string;
        success: boolean;
        pembayaran_id?: string;
        jurnal_id?: string;
        error?: string;
      }> = [];

      for (const item of items) {
        // Skip jika item ini sudah pernah diproses (idempotent terhadap retry webhook)
        if (item.pembayaran_id) {
          hasilItems.push({ item_id: item.id, success: true, pembayaran_id: item.pembayaran_id });
          continue;
        }

        // Validasi ulang terhadap tagihan exact. Untuk tagihan sekali bayar
        // yang sudah jatuh tempo, transaksi boleh lebih kecil dari sisa (cicilan).
        let tagihanQuery = admin
          .from("tagihan")
          .select("id, nominal, status, bulan")
          .eq("siswa_id", item.siswa_id)
          .eq("jenis_id", item.jenis_id)
          .eq("tahun_ajaran_id", item.tahun_ajaran_id);

        if (item.tagihan_id) {
          tagihanQuery = tagihanQuery.eq("id", item.tagihan_id);
        } else {
          tagihanQuery =
            item.bulan === 0 || item.bulan == null
              ? tagihanQuery.is("bulan", null)
              : tagihanQuery.eq("bulan", item.bulan);
        }

        const { data: tagihanAktif, error: tagihanError } =
          await tagihanQuery.maybeSingle();

        if (tagihanError) {
          hasilItems.push({
            item_id: item.id,
            success: false,
            error: "Gagal memvalidasi tagihan saat ini: " + tagihanError.message,
          });
          continue;
        }

        if (!tagihanAktif || !["belum_bayar", "sebagian", "terjadwal"].includes(tagihanAktif.status)) {
          hasilItems.push({
            item_id: item.id,
            success: false,
            error: "Tagihan sudah tidak aktif atau sudah diselesaikan",
          });
          continue;
        }

        const { data: paidRows, error: paidError } = await admin
          .from("pembayaran")
          .select("jumlah")
          .eq("tagihan_id", tagihanAktif.id);
        if (paidError) {
          hasilItems.push({
            item_id: item.id,
            success: false,
            error: "Gagal menghitung sisa tagihan: " + paidError.message,
          });
          continue;
        }

        const totalSudahBayar = (paidRows || []).reduce(
          (sum, row) => sum + Number(row.jumlah || 0),
          0
        );
        const nominalTagihan = Math.round(Number(tagihanAktif.nominal) || 0);
        const sisaTagihan = Math.max(nominalTagihan - totalSudahBayar, 0);
        const nominalTransaksi = Math.round(Number(item.jumlah) || 0);
        const cicilanDiizinkan =
          (item.bulan === 0 || item.bulan == null) &&
          tagihanAktif.status !== "terjadwal";

        if (
          sisaTagihan <= 0 ||
          nominalTransaksi <= 0 ||
          nominalTransaksi > sisaTagihan ||
          (!cicilanDiizinkan && nominalTransaksi !== sisaTagihan)
        ) {
          hasilItems.push({
            item_id: item.id,
            success: false,
            error:
              "Nominal transaksi Rp " + nominalTransaksi.toLocaleString("id-ID") +
              " tidak valid terhadap sisa tagihan Rp " + sisaTagihan.toLocaleString("id-ID"),
          });
          continue;
        }

        const { data: jenis } = await admin
          .from("jenis_pembayaran")
          .select("nama, akun_pendapatan_id")
          .eq("id", item.jenis_id)
          .single();

        const { data: rpcResult, error: rpcErr } = await (admin as any).rpc(
          "proses_pembayaran_midtrans_dengan_kuitansi_atomik",
          {
            p_transaksi_item_id: item.id,
            p_siswa_id: item.siswa_id,
            p_jenis_id: item.jenis_id,
            p_bulan: item.bulan,
            p_jumlah: item.jumlah,
            p_tanggal_bayar: today,
            p_departemen_id: item.departemen_id || null,
            p_tahun_ajaran_id: item.tahun_ajaran_id || null,
            p_order_id: order_id,
            p_payment_type: payment_type,
            p_kas_akun_id: bankMidtransId,
            p_kredit_akun_id: jenis?.akun_pendapatan_id ?? null,
            p_jenis_nama: jenis?.nama || "Pembayaran",
          }
        );

        if (rpcErr) {
          hasilItems.push({ item_id: item.id, success: false, error: rpcErr.message });
          continue;
        }

        const r = rpcResult as { pembayaran_id: string; jurnal_id: string };
        hasilItems.push({
          item_id: item.id,
          success: true,
          pembayaran_id: r.pembayaran_id,
          jurnal_id: r.jurnal_id,
        });
      }

      const adaGagal = hasilItems.some((h) => !h.success);

      // Simpan hasil pemrosesan ke metadata — SELALU tercatat, bukan silent.
      // Jika ada item gagal, admin bisa lihat dari sini akun mana yang perlu
      // dikonfigurasi lalu proses ulang manual (webhook Midtrans juga retry
      // otomatis untuk status non-2xx, tapi kita selalu balas 200 di bawah).
      await admin
        .from("transaksi_midtrans")
        .update({
          metadata: {
            ...notification,
            item_processing: hasilItems,
            ada_item_gagal_jurnal: adaGagal,
          },
        })
        .eq("order_id", order_id);

      // Notifikasi orang tua (in-app + push ke perangkat mobile) — best-effort.
      // Jika ada mismatch nominal / kegagalan item, jangan menyatakan pembayaran
      // sudah berhasil dibukukan.
      const judulNotif = adaGagal
        ? "Pembayaran Perlu Verifikasi"
        : "Pembayaran Berhasil";
      const pesanNotif = adaGagal
        ? "Pembayaran Midtrans order " + order_id +
          " telah diterima, tetapi ada tagihan yang berubah atau belum dapat dibukukan otomatis. Silakan hubungi admin/TU untuk verifikasi."
        : "Pembayaran " + items.length + " tagihan senilai Rp " +
          Number(transaksi.total_amount).toLocaleString("id-ID") +
          " berhasil diproses via " + payment_type + ". Order: " + order_id;
      try {
        await admin.from("notifikasi_ortu").insert({
          user_id: transaksi.user_id,
          judul: judulNotif,
          pesan: pesanNotif,
          tipe: "pembayaran",
          url: `/portal/pembayaran?order=${order_id}`,
          dibaca: false,
        });
      } catch {
        // best-effort
      }
      await kirimPushKeOrtu(admin, transaksi.user_id, judulNotif, pesanNotif, {
        url: "/riwayat",
        order_id,
      });
    }

    return new Response(
      JSON.stringify({ message: "OK", order_id, status: newStatus }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    // Midtrans meng-retry pada non-2xx; balas 200 agar tidak retry badai,
    // error sudah tercatat di log server.
    return new Response(
      JSON.stringify({
        message: "Error logged",
        error: error instanceof Error ? error.message : "unknown",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const Route = createFileRoute("/api/midtrans-notification")({
  server: {
    handlers: {
      POST: ({ request }) => handleNotification(request),
    },
  },
});