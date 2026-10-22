/**
 * Server function: generateNis
 * Format resmi NIS per lembaga: YYKKNNN (tanpa tanda hubung).
 * siswa.id tetap identitas permanen; riwayat NIS per lembaga disimpan di
 * siswa_tahun_masuk_departemen.
 */
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireAcademicDepartment, requireContext } from "./auth";
import { createAdminClient } from "./supabase";

export interface GenerateNisInput {
  siswa_id: string;
  departemen_id: string;
  angkatan_id: string;
  /**
   * Dipertahankan sementara untuk kompatibilitas pemanggil lama.
   * Format NIS baru tidak bergantung pada kelas/rombel.
   */
  kelas_id?: string;
  tujuan?: "current" | "spmb";
  nis_manual?: string;
}

export const generateNis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: GenerateNisInput) => z.object({
    siswa_id: z.string().uuid(), departemen_id: z.string().uuid(), angkatan_id: z.string().uuid(),
    tujuan: z.enum(["current", "spmb"]).optional(),
    nis_manual: z.string().trim().min(1).max(16).optional(),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ success: true; nis: string }> => {
    const admin = createAdminClient();
    const { siswa_id, departemen_id, angkatan_id } = data;

    await requireAcademicDepartment(
      admin,
      requireContext(context).userId,
      departemen_id,
    );

    if (!siswa_id || !departemen_id || !angkatan_id) {
      throw new Error("siswa_id, departemen_id, dan angkatan_id diperlukan");
    }

    if (data.nis_manual !== undefined && data.tujuan !== "spmb") {
      throw new Error("Input NIS tujuan harus menggunakan mode SPMB");
    }
    const { data: nis, error } = await (admin as any).rpc(
      data.tujuan === "spmb" ? "akademik_generate_nis_spmb" : "akademik_generate_nis_current",
      {
        p_siswa_id: siswa_id, p_departemen_id: departemen_id, p_angkatan_id: angkatan_id,
        ...(data.tujuan === "spmb" ? { p_nis: data.nis_manual ?? null } : {}),
      },
    );

    if (error) throw new Error(error.message);
    if (!nis || typeof nis !== "string") {
      throw new Error("NIS gagal dibuat");
    }

    return { success: true, nis };
  });
