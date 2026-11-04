/**
 * Pengajuan & persetujuan pembatalan pembayaran.
 *
 * Kasir/keuangan (izin `keuangan.pembatalan.ajukan`) mengajukan; pemegang
 * `keuangan.pembatalan.setujui` menyetujui/menolak. Semua perubahan lewat RPC
 * database ber-guard (izin, pengaju ≠ penyetuju, satu transaksi dengan pembatalan
 * atomik); identitas pelaku selalu dari sesi, tidak pernah dari input.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, checkPermission, requireContext, requirePermission } from "./auth";
import { createAdminClient } from "./supabase";

interface QueryResult<T> {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
}
interface Query<T> extends PromiseLike<QueryResult<T>> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query<T>;
  eq(column: string, value: string): Query<T>;
  in(column: string, values: readonly string[]): Query<T>;
  order(column: string, options?: { ascending: boolean }): Query<T>;
  limit(count: number): Query<T>;
}
interface LooseAdmin {
  from(table: string): Query<Record<string, unknown>>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

const TABLE = "pembatalan_pembayaran_pengajuan";
const MIN_REASON = 5;

export type PengajuanStatus = "menunggu" | "disetujui" | "ditolak" | "dibatalkan";

export interface PengajuanSnapshot {
  siswa_nama?: string | null;
  siswa_nis?: string | null;
  jenis_nama?: string | null;
  bulan?: number | null;
  jumlah?: number | null;
  tanggal_bayar?: string | null;
  keterangan?: string | null;
  nomor_kuitansi?: string | null;
}

export interface PengajuanPembatalan {
  id: string;
  pembayaran_id: string;
  snapshot: PengajuanSnapshot;
  alasan: string;
  status: PengajuanStatus;
  diajukan_oleh: string | null;
  diajukan_nama: string;
  diajukan_at: string;
  diputuskan_oleh: string | null;
  diputuskan_nama: string | null;
  diputuskan_at: string | null;
  catatan_keputusan: string | null;
  tanggal_pembatalan: string | null;
  milik_sendiri: boolean;
  dapat_diputuskan: boolean;
}

const tooShort = (label: string) => `${label} wajib diisi minimal ${MIN_REASON} karakter`;

export const ajukanPembatalanPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { pembayaran_id: string; alasan: string }) => d)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    await requirePermission(adminClient, userId, "keuangan.pembatalan.ajukan");

    const pembayaranId = String(data?.pembayaran_id ?? "").trim();
    const alasan = String(data?.alasan ?? "").trim();
    if (!pembayaranId) throw new Error("pembayaran_id wajib diisi");
    if (alasan.length < MIN_REASON) throw new Error(tooShort("Alasan pembatalan"));

    const admin = adminClient as unknown as LooseAdmin;
    const { data: id, error } = await admin.rpc("ajukan_pembatalan_pembayaran", {
      p_pembayaran_id: pembayaranId, p_alasan: alasan, p_actor_id: userId,
    });
    if (error) throw new Error(error.message);
    return { id: String(id) };
  });

export const putuskanPengajuanPembatalan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { id: string; keputusan: "setujui" | "tolak"; catatan?: string; tanggal?: string }) => d)
  .handler(async ({ data, context }): Promise<{ success: true; jurnal_pembalik_id: string | null }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    await requirePermission(adminClient, userId, "keuangan.pembatalan.setujui");

    const id = String(data?.id ?? "").trim();
    if (!id) throw new Error("id pengajuan wajib diisi");
    const catatan = String(data?.catatan ?? "").trim();
    const admin = adminClient as unknown as LooseAdmin;

    if (data?.keputusan === "setujui") {
      const tanggal = data.tanggal || new Date().toISOString().split("T")[0];
      const { data: result, error } = await admin.rpc("setujui_pembatalan_pembayaran", {
        p_pengajuan_id: id, p_actor_id: userId, p_tanggal: tanggal, p_catatan: catatan || null,
      });
      if (error) throw new Error(error.message);
      const jurnal = (result as { jurnal_pembalik_id?: string | null } | null)?.jurnal_pembalik_id ?? null;
      return { success: true, jurnal_pembalik_id: jurnal };
    }
    if (data?.keputusan === "tolak") {
      if (catatan.length < MIN_REASON) throw new Error(tooShort("Alasan penolakan"));
      const { error } = await admin.rpc("tolak_pembatalan_pembayaran", {
        p_pengajuan_id: id, p_actor_id: userId, p_catatan: catatan,
      });
      if (error) throw new Error(error.message);
      return { success: true, jurnal_pembalik_id: null };
    }
    throw new Error("Keputusan tidak valid");
  });

export const batalkanPengajuanPembatalan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }): Promise<{ success: true }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    await requirePermission(adminClient, userId, ["keuangan.pembatalan.ajukan", "keuangan.pembatalan.setujui"]);
    const id = String(data?.id ?? "").trim();
    if (!id) throw new Error("id pengajuan wajib diisi");
    const admin = adminClient as unknown as LooseAdmin;
    // Kepemilikan (pengaju atau admin) dicek di dalam fungsi database.
    const { error } = await admin.rpc("batalkan_pengajuan_pembatalan", { p_pengajuan_id: id, p_actor_id: userId });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const listPengajuanPembatalan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { status?: "menunggu" | "semua" } | undefined) => d)
  .handler(async ({ data, context }): Promise<{ items: PengajuanPembatalan[]; canDecide: boolean }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    const approver = (await checkPermission(adminClient, userId, "keuangan.pembatalan.setujui")).allowed;
    if (!approver) await requirePermission(adminClient, userId, "keuangan.pembatalan.ajukan");

    const admin = adminClient as unknown as LooseAdmin;
    let query = admin
      .from(TABLE)
      .select("id, pembayaran_id, snapshot, alasan, status, diajukan_oleh, diajukan_at, diputuskan_oleh, diputuskan_at, catatan_keputusan, tanggal_pembatalan")
      .order("diajukan_at", { ascending: false })
      .limit(200);
    if (data?.status === "menunggu") query = query.eq("status", "menunggu");
    if (!approver) query = query.eq("diajukan_oleh", userId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const list = rows || [];
    const userIds = [...new Set(list.flatMap((r) => [r.diajukan_oleh, r.diputuskan_oleh]).filter((v): v is string => typeof v === "string"))];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await admin.from("users_profile").select("id, email, pegawai_id").in("id", userIds);
      const pegawaiIds = [...new Set((profiles || []).map((p) => p.pegawai_id).filter((v): v is string => typeof v === "string"))];
      const pegawaiName = new Map<string, string>();
      if (pegawaiIds.length > 0) {
        const { data: pegawai } = await admin.from("pegawai").select("id, nama").in("id", pegawaiIds);
        for (const p of pegawai || []) if (p.nama) pegawaiName.set(String(p.id), String(p.nama));
      }
      for (const p of profiles || []) {
        names.set(String(p.id), (p.pegawai_id && pegawaiName.get(String(p.pegawai_id))) || String(p.email ?? "-"));
      }
    }

    const items = list.map((r): PengajuanPembatalan => {
      const own = r.diajukan_oleh === userId;
      return {
        id: String(r.id),
        pembayaran_id: String(r.pembayaran_id),
        snapshot: (r.snapshot ?? {}) as PengajuanSnapshot,
        alasan: String(r.alasan),
        status: r.status as PengajuanStatus,
        diajukan_oleh: (r.diajukan_oleh as string | null) ?? null,
        diajukan_nama: (r.diajukan_oleh && names.get(String(r.diajukan_oleh))) || "-",
        diajukan_at: String(r.diajukan_at),
        diputuskan_oleh: (r.diputuskan_oleh as string | null) ?? null,
        diputuskan_nama: (r.diputuskan_oleh && names.get(String(r.diputuskan_oleh))) || null,
        diputuskan_at: (r.diputuskan_at as string | null) ?? null,
        catatan_keputusan: (r.catatan_keputusan as string | null) ?? null,
        tanggal_pembatalan: (r.tanggal_pembatalan as string | null) ?? null,
        milik_sendiri: own,
        dapat_diputuskan: approver && !own && r.status === "menunggu",
      };
    });
    return { items, canDecide: approver };
  });

/** Jumlah pengajuan menunggu yang dapat diputuskan pengguna ini (lencana menu); 0 bila bukan penyetuju. */
export const countPengajuanPembatalanMenunggu = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    const approver = (await checkPermission(adminClient, userId, "keuangan.pembatalan.setujui")).allowed;
    if (!approver) return { count: 0 };

    const admin = adminClient as unknown as LooseAdmin;
    const total = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "menunggu");
    if (total.error) throw new Error(total.error.message);
    const own = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "menunggu").eq("diajukan_oleh", userId);
    if (own.error) throw new Error(own.error.message);
    return { count: Math.max(0, (total.count ?? 0) - (own.count ?? 0)) };
  });

/** Pengajuan menunggu per pembayaran, untuk menandai baris di halaman Input Pembayaran. */
export const statusPengajuanPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { pembayaran_ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<Record<string, { id: string; milik_sendiri: boolean }>> => {
    const adminClient = createAdminClient();
    const { userId } = requireContext(context);
    await requirePermission(adminClient, userId, [
      "keuangan.pembayaran", "keuangan.pembatalan.ajukan", "keuangan.pembatalan.setujui",
    ]);
    const ids = [...new Set((Array.isArray(data?.pembayaran_ids) ? data.pembayaran_ids : []).filter(Boolean))].slice(0, 500);
    if (ids.length === 0) return {};
    const admin = adminClient as unknown as LooseAdmin;
    const { data: rows, error } = await admin
      .from(TABLE).select("id, pembayaran_id, diajukan_oleh").eq("status", "menunggu").in("pembayaran_id", ids);
    if (error) throw new Error(error.message);
    const result: Record<string, { id: string; milik_sendiri: boolean }> = {};
    for (const r of rows || []) result[String(r.pembayaran_id)] = { id: String(r.id), milik_sendiri: r.diajukan_oleh === userId };
    return result;
  });
