/**
 * Aturan murni teks toast saat SEMUA item keranjang kasir gagal diproses.
 *
 * Pesan asli tiap item (mis. "UANG PANGKAL SMP: Sesi pembayaran lama belum
 * dapat ditutup di Midtrans.") sudah dikumpulkan komponen, tetapi sebelumnya
 * dibuang sehingga kasir hanya melihat teks generik dan penyebabnya baru bisa
 * ditemukan lewat log server. Fungsi ini menyusun judul + deskripsi toast.
 */

export const CART_FAILURE_TITLE = "Semua item keranjang gagal diproses";

/** Jumlah pesan yang ditampilkan; sisanya diringkas "(+N lainnya)". */
export const CART_FAILURE_MAX_SHOWN = 2;
/** Batas panjang satu pesan agar toast tetap terbaca (termasuk tanda "…"). */
export const CART_FAILURE_MAX_MESSAGE_CHARS = 240;
/** Lebih lama dari bawaan sonner (4 detik) agar pesan sempat dibaca. */
export const CART_FAILURE_DURATION_MS = 10_000;

export interface CartFailureToast {
  title: string;
  description?: string;
  duration: number;
}

function truncate(message: string): string {
  if (message.length <= CART_FAILURE_MAX_MESSAGE_CHARS) return message;
  return message.slice(0, CART_FAILURE_MAX_MESSAGE_CHARS - 1) + "…";
}

export function describeCartFailures(failures: readonly string[]): CartFailureToast {
  const cleaned = failures.map((message) => message.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { title: CART_FAILURE_TITLE, duration: CART_FAILURE_DURATION_MS };
  }
  const shown = cleaned.slice(0, CART_FAILURE_MAX_SHOWN).map(truncate);
  const hidden = cleaned.length - shown.length;
  const description = shown.join(" | ") + (hidden > 0 ? ` (+${hidden} lainnya)` : "");
  return { title: CART_FAILURE_TITLE, description, duration: CART_FAILURE_DURATION_MS };
}
