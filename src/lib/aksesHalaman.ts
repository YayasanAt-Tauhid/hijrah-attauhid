// Aturan akses halaman per peran yang dipakai AppLayout, route guard, dan halaman.
// Hanya fungsi murni supaya mudah diuji; tidak menggantikan RLS di database.

type Peran = string | null | undefined;

const rapikan = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

/** Halaman Keuangan yang boleh dibuka admin_tu (selain seluruh /akademik). */
export function adminTuBolehBukaKeuangan(pathname: string): boolean {
  const path = rapikan(pathname);
  return path === "/keuangan/monitoring-spmb" || path === "/keuangan/seragam-vendor";
}

/** Admin TU dikurung ke /akademik dan halaman Keuangan yang diizinkan. */
export function adminTuBolehBuka(pathname: string): boolean {
  return pathname.startsWith("/akademik") || adminTuBolehBukaKeuangan(pathname);
}

/** Keuangan di Akademik hanya boleh melihat daftar siswa dan detail satu siswa. */
export function keuanganBolehBukaAkademik(pathname: string): boolean {
  const path = rapikan(pathname);
  return path === "/akademik/siswa" || /^\/akademik\/siswa\/(?!tambah$)[^/]+$/.test(path);
}

/** Tambah, impor, ubah, dan hapus data siswa; keuangan hanya membaca. */
export function bolehKelolaSiswa(role: Peran): boolean {
  return role !== "keuangan";
}

/** Admin TU melihat harga seragam vendor tetapi tidak mengubahnya. */
export function hargaSeragamBacaSaja(role: Peran): boolean {
  return role === "admin_tu";
}
