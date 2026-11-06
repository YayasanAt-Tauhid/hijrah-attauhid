/**
 * Hapus siswa dengan penjaga riwayat.
 *
 * Server function memegang otorisasi lembaga; pemeriksaan riwayat dan penghapusan
 * dilakukan atomik oleh RPC `hapus_siswa`, yang menolak bila siswa punya data di
 * tabel mana pun yang merujuknya (termasuk tabel dengan ON DELETE CASCADE).
 */
import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";
import { authMiddleware, requireAcademicDepartment, requireContext } from "./auth";
import {
  isForeignKeyViolation,
  normalisasiHasilHapusSiswa,
  type HapusSiswaResult,
} from "@/lib/siswaDeletion";

interface QueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}
interface Query<T> {
  select(columns: string): Query<T>;
  eq(column: string, value: string): Query<T>;
  maybeSingle(): Promise<QueryResult<T>>;
}
interface LooseAdmin {
  from(table: string): Query<Record<string, unknown>>;
  rpc(fn: string, args: Record<string, unknown>): Promise<QueryResult<unknown>>;
}

export const hapusSiswa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { siswa_id: string }) => d)
  .handler(async ({ data, context }): Promise<HapusSiswaResult> => {
    const actor = requireContext(context);

    const siswaId = typeof data.siswa_id === "string" ? data.siswa_id.trim() : "";
    if (!siswaId) throw new Error("Data siswa tidak valid");

    const adminClient = createAdminClient();
    const admin = adminClient as unknown as LooseAdmin;

    const { data: siswa, error: siswaError } = await admin
      .from("siswa")
      .select("id,departemen_id")
      .eq("id", siswaId)
      .maybeSingle();
    if (siswaError) throw new Error(siswaError.message);
    if (!siswa?.id) throw new Error("Siswa tidak ditemukan");

    await requireAcademicDepartment(
      adminClient,
      actor.userId,
      (siswa.departemen_id as string | null) ?? null,
      ["admin", "admin_tu"],
    );

    const { data: hasil, error } = await admin.rpc("hapus_siswa", {
      p_siswa_id: siswaId,
      p_actor_id: actor.userId,
    });
    if (error) {
      if (isForeignKeyViolation(error)) {
        throw new Error("Siswa ini punya riwayat data sehingga tidak dapat dihapus");
      }
      throw new Error(error.message);
    }
    return normalisasiHasilHapusSiswa(hasil);
  });
