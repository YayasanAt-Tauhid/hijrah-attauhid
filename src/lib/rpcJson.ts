import type { Json } from "@/integrations/supabase/types";

/**
 * Argumen RPC bertipe `jsonb`: nilai yang akan diserialisasi sebagai JSON.
 * Hanya penanda di batas tipe; pemanggil bertanggung jawab agar nilainya serializable
 * (tanpa fungsi, `undefined` di dalam array, dst.).
 */
export function toJson(value: unknown): Json {
  return value as Json;
}

/**
 * Hasil RPC bertipe `jsonb`. Bentuk `T` dijamin oleh fungsi SQL-nya, BUKAN divalidasi di sini;
 * tulis `T` sesuai kembalian fungsi (jadikan properti opsional bila tidak selalu ada).
 */
export function fromJson<T>(data: Json | null | undefined): T {
  return data as unknown as T;
}
