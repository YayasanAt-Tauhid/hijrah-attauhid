/**
 * Izin modul Keuangan yang dapat diatur admin per peran.
 *
 * Admin selalu memiliki semua izin. Peran yang bisa diatur: keuangan, kasir,
 * bendahara, sekretaris_yayasan. Peran lain (admin_tu, guru, dst.) tetap
 * memakai aturan peran lama di tempatnya masing-masing.
 *
 * Penegakan berlapis: menu/rute/halaman (client) dan server function memakai
 * kunci izin ini; RLS database hanya mengenal `keuangan.akses_data` (lewat
 * `has_role(uid,'keuangan')` untuk bendahara/sekretaris), sehingga pembatasan
 * halus per fitur berlaku di server dan UI, bukan di tiap kebijakan RLS.
 */

export const CONFIGURABLE_ROLES = ["keuangan", "kasir", "bendahara", "sekretaris_yayasan"] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const ROLE_LABELS: Record<ConfigurableRole, string> = {
  keuangan: "Keuangan",
  kasir: "Kasir",
  bendahara: "Bendahara",
  sekretaris_yayasan: "Sekretaris",
};

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

export const PERMISSIONS = [
  { key: "keuangan.pembayaran", group: "Transaksi harian", label: "Pembayaran siswa",
    description: "Input pembayaran, pembayaran SPMB, link pembayaran, monitoring pembayaran SPMB." },
  { key: "keuangan.transaksi", group: "Transaksi harian", label: "Transaksi keuangan lain",
    description: "Rencana tagihan siswa baru, penerimaan lain, pengeluaran, kas kecil, online payment, tabungan siswa/pegawai." },
  { key: "keuangan.pembatalan.ajukan", group: "Pembatalan pembayaran", label: "Mengajukan pembatalan",
    description: "Mengajukan pembatalan pembayaran; pembatalan baru berlaku setelah disetujui." },
  { key: "keuangan.pembatalan.setujui", group: "Pembatalan pembayaran", label: "Menyetujui pembatalan",
    description: "Menyetujui atau menolak pengajuan pembatalan. Tidak bisa menyetujui pengajuan sendiri." },
  { key: "keuangan.pembatalan.langsung", group: "Pembatalan pembayaran", label: "Membatalkan langsung",
    description: "Membatalkan pembayaran tanpa persetujuan. Admin selalu memilikinya." },
  { key: "keuangan.rekap_kasir", group: "Laporan & rekap", label: "Tunggakan & rekap kasir",
    description: "Halaman Tunggakan dan Rekap Kasir Saya." },
  { key: "keuangan.laporan", group: "Laporan & rekap", label: "Laporan keuangan",
    description: "Laporan per siswa/kelas, rekap harian, laporan pengeluaran, unit pendidikan, unit usaha & dana." },
  { key: "keuangan.akuntansi", group: "Akuntansi", label: "Akuntansi",
    description: "Jurnal umum, buku besar, piutang, aset tetap, tutup buku, pengakuan pendapatan, laporan ISAK 35." },
  { key: "keuangan.diskon", group: "Lainnya", label: "Keringanan & beasiswa",
    description: "Halaman Siswa Penerima Keringanan." },
  { key: "keuangan.pengaturan", group: "Lainnya", label: "Pengaturan keuangan",
    description: "Audit trail, audit perubahan data, referensi keuangan." },
  { key: "keuangan.akses_data", group: "Teknis", label: "Akses data keuangan (database)",
    description: "Otomatis untuk Bendahara dan Sekretaris yang punya izin apa pun; memungkinkan membaca dan menulis data keuangan di database." },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

export const DATA_ACCESS_KEY: PermissionKey = "keuangan.akses_data";
/** Peran yang memakai DATA_ACCESS_KEY (peran keuangan/kasir sudah punya akses RLS sendiri). */
const DATA_ACCESS_ROLES: readonly string[] = ["bendahara", "sekretaris_yayasan"];

const ALL_EXCEPT_DIRECT = PERMISSION_KEYS.filter((k) => k !== "keuangan.pembatalan.langsung");

/** Meniru perilaku lama untuk keuangan/kasir; bendahara & sekretaris: seluruh menu Keuangan + hak menyetujui. */
export const DEFAULT_ROLE_PERMISSIONS: Record<ConfigurableRole, PermissionKey[]> = {
  keuangan: [
    "keuangan.pembayaran", "keuangan.transaksi", "keuangan.rekap_kasir", "keuangan.laporan",
    "keuangan.akuntansi", "keuangan.diskon", "keuangan.pengaturan", "keuangan.pembatalan.ajukan",
  ],
  kasir: ["keuangan.pembayaran", "keuangan.rekap_kasir", "keuangan.pembatalan.ajukan"],
  bendahara: [...ALL_EXCEPT_DIRECT],
  sekretaris_yayasan: [...ALL_EXCEPT_DIRECT],
};

export function isConfigurableRole(role: string | null | undefined): role is ConfigurableRole {
  return !!role && (CONFIGURABLE_ROLES as readonly string[]).includes(role);
}

/** Admin selalu boleh; selain itu hanya bila izin diberikan. Tanpa data → ditolak. */
export function canAccess(
  role: string | null | undefined,
  granted: ReadonlySet<string> | null | undefined,
  permission: PermissionKey,
): boolean {
  if (role === "admin") return true;
  if (!role || !granted) return false;
  return granted.has(permission);
}

/** Bersihkan daftar izin sebelum disimpan: kunci valid, tanpa duplikat, aturan akses data. */
export function normalizePermissions(role: string, keys: readonly string[]): PermissionKey[] {
  const wanted = new Set(keys.filter((k): k is PermissionKey => (PERMISSION_KEYS as readonly string[]).includes(k)));
  wanted.delete(DATA_ACCESS_KEY);
  const result = PERMISSION_KEYS.filter((k) => wanted.has(k));
  if (DATA_ACCESS_ROLES.includes(role) && result.length > 0) result.unshift(DATA_ACCESS_KEY);
  return result;
}

const PATH_PERMISSIONS: ReadonlyArray<readonly [string, PermissionKey]> = [
  ["/keuangan/pembayaran", "keuangan.pembayaran"],
  ["/keuangan/pembayaran-spmb", "keuangan.pembayaran"],
  ["/keuangan/pembayaran-pmb", "keuangan.pembayaran"],
  ["/keuangan/pembayaran-psb", "keuangan.pembayaran"],
  ["/keuangan/link-pembayaran", "keuangan.pembayaran"],
  ["/keuangan/monitoring-spmb", "keuangan.pembayaran"],
  ["/keuangan/rencana-siswa-baru", "keuangan.transaksi"],
  ["/keuangan/penerimaan-lain", "keuangan.transaksi"],
  ["/keuangan/pengeluaran", "keuangan.transaksi"],
  ["/keuangan/kas-kecil", "keuangan.transaksi"],
  ["/keuangan/online-payment", "keuangan.transaksi"],
  ["/keuangan/tabungan", "keuangan.transaksi"],
  ["/keuangan/tabungan-pegawai", "keuangan.transaksi"],
  ["/keuangan/tunggakan", "keuangan.rekap_kasir"],
  ["/keuangan/rekap-kasir", "keuangan.rekap_kasir"],
  ["/keuangan/laporan", "keuangan.laporan"],
  ["/keuangan/laporan-siswa", "keuangan.laporan"],
  ["/keuangan/laporan-kelas", "keuangan.laporan"],
  ["/keuangan/laporan-pengeluaran", "keuangan.laporan"],
  ["/keuangan/laporan-unit-usaha", "keuangan.laporan"],
  ["/keuangan/rekap-harian", "keuangan.laporan"],
  ["/keuangan/cek-kejanggalan", "keuangan.laporan"],
  ["/keuangan/jurnal", "keuangan.akuntansi"],
  ["/keuangan/buku-besar", "keuangan.akuntansi"],
  ["/keuangan/piutang", "keuangan.akuntansi"],
  ["/keuangan/aset-tetap", "keuangan.akuntansi"],
  ["/keuangan/tutup-buku", "keuangan.akuntansi"],
  ["/keuangan/pengakuan-pendapatan", "keuangan.akuntansi"],
  ["/keuangan/isak35", "keuangan.akuntansi"],
  ["/keuangan/audit-trail", "keuangan.pengaturan"],
  ["/keuangan/audit-perubahan", "keuangan.pengaturan"],
  ["/keuangan/referensi", "keuangan.pengaturan"],
  ["/keuangan/diskon-siswa", "keuangan.diskon"],
];

/** Izin untuk sebuah rute Keuangan (cocok per segmen, terpanjang menang); null bila tidak dikenal. */
export function permissionForPath(pathname: string): PermissionKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: readonly [string, PermissionKey] | null = null;
  for (const entry of PATH_PERMISSIONS) {
    const [prefix] = entry;
    if ((path === prefix || path.startsWith(prefix + "/")) && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best ? best[1] : null;
}
