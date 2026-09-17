/**
 * Ubah akhiran nama kelas menjadi kode rombel satu digit.
 *
 * Format lama memakai huruf (12A -> 1, 5C -> 3), sedangkan beberapa unit
 * memakai angka (MTA 1 -> 1, TK A2 -> 2). NIS saat ini hanya menyediakan
 * satu digit untuk kode rombel, sehingga angka yang didukung adalah 1-9.
 */
export function getKodeRombel(namaKelas: string): number | null {
  const lastChar = namaKelas.trim().slice(-1).toUpperCase();

  if (/^[1-9]$/.test(lastChar)) return Number(lastChar);

  if (/^[A-Z]$/.test(lastChar)) {
    return lastChar.charCodeAt(0) - 64;
  }

  return null;
}
