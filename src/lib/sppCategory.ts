import { isSppPaymentName } from "./installment";

export const SPP_CATEGORY_LABELS = {
  asrama: "Asrama",
  non_asrama: "Non Asrama",
  umum: "Umum (TK/SD)",
  belum_terverifikasi: "Belum terverifikasi",
} as const;

export type SppCategory = keyof typeof SPP_CATEGORY_LABELS;

/** Hanya snapshot transaksi; status siswa sekarang bukan sumber histori. */
export function sppCategory(snapshot: unknown, paymentName: unknown, departmentCode?: unknown): SppCategory | null {
  if (!isSppPaymentName(paymentName)) return null;
  if (typeof snapshot === "string" && Object.prototype.hasOwnProperty.call(SPP_CATEGORY_LABELS, snapshot)) {
    return snapshot as SppCategory;
  }
  if (departmentCode === "TK" || departmentCode === "SD") return "umum";
  return "belum_terverifikasi";
}

export function sppCategoryLabel(category: SppCategory | null): string {
  return category ? SPP_CATEGORY_LABELS[category] : "—";
}

export function sppReceiptGroups(rows: Array<{ jumlah: unknown; spp_kategori?: unknown; jenis_pembayaran?: { nama?: unknown; departemen?: { kode?: unknown } }; departemen?: { kode?: unknown } }>) {
  const groups = new Map<string, { lembaga: string; kategori: SppCategory; label: string; jumlah: number; transaksi: number }>();
  for (const row of rows) {
    const departmentCode = row.jenis_pembayaran?.departemen?.kode || row.departemen?.kode;
    const category = sppCategory(row.spp_kategori, row.jenis_pembayaran?.nama, departmentCode);
    if (!category) continue;
    const department = String(departmentCode || "Belum ditetapkan");
    const key = `${department}:${category}`;
    const group = groups.get(key) || { lembaga: department, kategori: category, label: sppCategoryLabel(category), jumlah: 0, transaksi: 0 };
    group.jumlah += Number(row.jumlah || 0);
    group.transaksi++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.lembaga.localeCompare(b.lembaga) || a.label.localeCompare(b.label));
}
