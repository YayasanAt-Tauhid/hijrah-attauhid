/**
 * Nilai sel aman untuk berkas spreadsheet. Teks berawalan = + - @ diberi apostrof agar tidak dibaca sebagai rumus
 * saat dibuka di Excel/LibreOffice (formula injection).
 */
export function safeSpreadsheetValue(value: unknown): string | number | boolean {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  let text: string;
  if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }

  // Hindari formula injection saat file dibuka di Excel/LibreOffice.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
