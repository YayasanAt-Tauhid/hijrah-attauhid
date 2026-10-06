import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";
import { safeStudentSearch, sppPeriodSchema, type SppPeriodInput, type SppPeriodPreview } from "@/lib/sppPeriod";

export const getSppPeriodOptions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { search: string; departemen_id?: string }) =>
    z.object({ search: z.string().max(100), departemen_id: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);
    const { data: profile } = await admin.from("users_profile").select("aktif").eq("id", userId).single();
    if (!profile?.aktif) throw new Error("Akun tidak aktif");
    const search = safeStudentSearch(data.search);
    if (search.length < 2) return { siswa: [], jenis: [] };
    const { data: departments, error: departmentError } = await admin.from("departemen").select("id,kode").in("kode", ["SMP", "SMA", "MTA"]);
    if (departmentError) throw departmentError;
    const deptIds = (departments || []).map((d) => d.id).filter((id) => !data.departemen_id || id === data.departemen_id);
    if (!deptIds.length) return { siswa: [], jenis: [] };
    const { data: siswa, error } = await admin.from("siswa").select("id,nis,nama,departemen_id")
      .eq("status", "aktif").in("departemen_id", deptIds).or(`nama.ilike.%${search}%,nis.ilike.%${search}%`)
      .order("nama").limit(20);
    if (error) throw error;
    const { data: jenis, error: jenisError } = await admin.from("jenis_pembayaran").select("id,nama,departemen_id")
      .eq("aktif", true).eq("tipe", "bulanan").in("departemen_id", deptIds);
    if (jenisError) throw jenisError;
    return {
      siswa: (siswa || []).map((s) => ({ ...s, lembaga: departments?.find((d) => d.id === s.departemen_id)?.kode || "" })),
      jenis: (jenis || []).filter((j) => /^spp([\s-]|$)/i.test(j.nama.trim())),
    };
  });

export const previewOrApplySppPeriod = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: SppPeriodInput) => sppPeriodSchema.parse(data))
  .handler(async ({ data, context }): Promise<SppPeriodPreview> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);
    const { data: result, error } = await admin.rpc("sesuaikan_kategori_spp_periode", {
      p_siswa_id: data.siswa_id, p_jenis_id: data.jenis_id,
      p_mulai: data.mulai + "-01", p_selesai: data.selesai + "-01", p_kategori: data.kategori,
      p_nominal_bruto: data.nominal_bruto,
      p_user_id: userId, p_apply: data.apply, p_preview_hash: data.preview_hash, p_alasan: data.alasan,
    });
    if (error) {
      if (error.code === "55P03") throw new Error("Ada transaksi lain yang sedang berjalan. Coba muat pratinjau kembali.");
      if (error.code === "PGRST202") throw new Error("Fitur kategori per periode belum diaktifkan. Migration database perlu diterapkan dahulu.");
      throw new Error(error.message);
    }
    return result as unknown as SppPeriodPreview;
  });

export const getSppPeriodHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { siswa_id: string }) => z.object({ siswa_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan"]);
    const { data: profile } = await admin.from("users_profile").select("aktif").eq("id", userId).single();
    if (!profile?.aktif) throw new Error("Akun tidak aktif");
    const { data: rows, error } = await admin.from("spp_kategori_periode_audit")
      .select("id,mulai,selesai,kategori,alasan,dibuat_at,dibuat_oleh,perubahan")
      .eq("siswa_id", data.siswa_id).order("dibuat_at", { ascending: false }).limit(20);
    if (error) {
      if (error.code === "PGRST205") return [];
      throw error;
    }
    return rows || [];
  });

