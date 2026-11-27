// Penyajian data anak di portal orang tua (tampilan saja, bukan logika bisnis).

// Dua huruf awal nama untuk lingkaran inisial pada kartu anak.
export function inisialNama(nama: string): string {
  return nama
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((kata) => kata.charAt(0))
    .join("")
    .toUpperCase();
}

// Kelas ditampilkan di sebelah nama; kata "Kelas" tidak diulang bila data
// sudah memuatnya.
export function labelKelas(kelas: string | null | undefined): string {
  const nilai = (kelas ?? "").trim();
  if (!nilai) return "";
  return /^kelas\b/i.test(nilai) ? nilai : `Kelas ${nilai}`;
}

// ortu_siswa.hubungan hampir selalu berisi nilai generik "ortu" (lihat
// src/lib/ortu.ts); tampilkan dalam bahasa yang wajar bagi orang tua.
export function labelHubungan(hubungan: string | null | undefined): string {
  const nilai = (hubungan ?? "").trim().toLowerCase();
  if (!nilai) return "";
  if (nilai === "ortu") return "Orang tua";
  return nilai.charAt(0).toUpperCase() + nilai.slice(1);
}
