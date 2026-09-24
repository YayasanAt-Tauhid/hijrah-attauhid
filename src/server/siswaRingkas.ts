import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const ROLE_CARI_SISWA = ["admin", "keuangan"];

export interface SiswaRingkasServer {
  id: string;
  nama: string;
  nis: string | null;
  departemen_id: string | null;
}

export interface CariSiswaRingkasInput {
  search: string;
  limit?: number;
}

/**
 * Pencarian siswa untuk form keuangan.
 *
 * Dibaca melalui server agar staf keuangan tidak perlu diberi SELECT penuh ke
 * tabel `siswa` (yang juga berisi alamat, telepon, tanggal lahir, dan data lain
 * yang tidak dibutuhkan oleh combobox keuangan).
 */
export const cariSiswaRingkas = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CariSiswaRingkasInput) => d)
  .handler(async ({ data, context }): Promise<{ items: SiswaRingkasServer[] }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_CARI_SISWA);

    const search = data?.search?.trim() ?? "";
    if (search.length < 2) return { items: [] };

    const limit = Math.min(Math.max(Number(data.limit ?? 20), 1), 30);
    const select = "id, nama, nis, departemen_id";

    const [byNama, byNis] = await Promise.all([
      admin
        .from("siswa")
        .select(select)
        .eq("status", "aktif")
        .ilike("nama", `%${search}%`)
        .limit(limit),
      admin
        .from("siswa")
        .select(select)
        .eq("status", "aktif")
        .ilike("nis", `%${search}%`)
        .limit(limit),
    ]);

    if (byNama.error) throw new Error("Gagal mencari siswa: " + byNama.error.message);
    if (byNis.error) throw new Error("Gagal mencari siswa: " + byNis.error.message);

    const unik = new Map<string, SiswaRingkasServer>();
    for (const row of [...(byNama.data ?? []), ...(byNis.data ?? [])]) {
      const item = row as SiswaRingkasServer;
      unik.set(item.id, {
        ...item,
        nama: item.nama?.trim() || "—",
        nis: item.nis?.trim() || null,
      });
    }

    return {
      items: Array.from(unik.values())
        .sort((a, b) => a.nama.localeCompare(b.nama, "id-ID"))
        .slice(0, limit),
    };
  });
