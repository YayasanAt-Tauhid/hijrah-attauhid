/**
 * Kirim push notification ke perangkat orang tua via Expo Push API.
 *
 * Token perangkat didaftarkan app mobile (apps/portal-ortu) lewat RPC
 * `daftarkan_push_token` ke tabel `perangkat_push_ortu`. Fungsi ini dipanggil
 * dari kode server (mis. webhook Midtrans) dengan client service-role.
 *
 * Sifatnya BEST-EFFORT: tidak pernah melempar error — kegagalan push tidak
 * boleh menggagalkan proses utama (pencatatan pembayaran dsb.). Token yang
 * dilaporkan mati (DeviceNotRegistered) dihapus agar tidak dikirimi lagi.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100; // batas maksimal pesan per request Expo Push API

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface KirimPushResult {
  sent: number;
  failed: number;
}

export async function kirimPushKeOrtu(
  admin: SupabaseClient<Database>,
  userId: string | null | undefined,
  judul: string,
  pesan: string,
  data?: Record<string, unknown>
): Promise<KirimPushResult> {
  if (!userId) return { sent: 0, failed: 0 };

  try {
    const { data: perangkat } = await admin
      .from("perangkat_push_ortu")
      .select("expo_push_token")
      .eq("user_id", userId);

    const tokens = (perangkat || []).map((p) => p.expo_push_token);
    if (tokens.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const tokenMati: string[] = [];

    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
      const chunk = tokens.slice(i, i + CHUNK_SIZE);
      const messages = chunk.map((to) => ({
        to,
        title: judul,
        body: pesan,
        sound: "default",
        data: data ?? {},
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        failed += chunk.length;
        continue;
      }

      const body = (await res.json()) as { data?: ExpoPushTicket[] };
      const tickets = body.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent += 1;
        } else {
          failed += 1;
          if (ticket.details?.error === "DeviceNotRegistered") {
            tokenMati.push(chunk[idx]);
          }
        }
      });
    }

    if (tokenMati.length > 0) {
      await admin
        .from("perangkat_push_ortu")
        .delete()
        .in("expo_push_token", tokenMati);
    }

    return { sent, failed };
  } catch {
    return { sent: 0, failed: 0 };
  }
}
