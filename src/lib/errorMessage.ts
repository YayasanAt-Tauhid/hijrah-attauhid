/**
 * Ambil pesan galat dari nilai `unknown` yang ditangkap `catch`.
 *
 * Galat dari Supabase/PostgREST dan RPC sering berupa objek biasa ber-`message`,
 * bukan instance `Error`, jadi `instanceof Error` saja tidak cukup. Perilakunya sama
 * dengan pola lama `err?.message || fallback`: pesan kosong atau tidak ada memakai fallback.
 */
export function getErrorMessage(error: unknown, fallback = "Terjadi kesalahan"): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return fallback;
}
