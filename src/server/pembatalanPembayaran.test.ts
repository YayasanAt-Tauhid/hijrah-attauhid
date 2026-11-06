import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAllows } from "@/test/defaultPermissions";

const state = vi.hoisted(() => ({
  role: "kasir" as string,
  userId: "user-1",
  rpc: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  count: 0,
  ownCount: 0,
  filters: [] as Array<[string, unknown]>,
  profiles: [] as Array<Record<string, unknown>>,
  pegawai: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (input: unknown) => input;
    const q = {
      middleware: () => q,
      inputValidator: (fn: typeof validate) => { validate = fn; return q; },
      handler: (fn: (args: unknown) => unknown) => (args: { data?: unknown }) => fn({ ...args, data: validate(args.data) }),
    };
    return q;
  },
}));
vi.mock("./supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const local: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {
        select: (_c: string, opts?: { head?: boolean }) => { if (opts?.head) (q as { head: boolean }).head = true; return q; },
        eq: (c: string, v: unknown) => { state.filters.push([c, v]); local.push([c, v]); return q; },
        in: (c: string, v: unknown) => { state.filters.push([c, v]); return q; },
        order: () => q,
        limit: () => q,
        update: () => q,
        then: (resolve: (v: unknown) => unknown) => {
          if ((q as { head?: boolean }).head) {
            const own = local.some(([c]) => c === "diajukan_oleh");
            return resolve({ count: own ? state.ownCount : state.count, data: null, error: null });
          }
          const data = table === "pembatalan_pembayaran_pengajuan" ? state.rows : table === "users_profile" ? state.profiles : state.pegawai;
          return resolve({ data, error: null });
        },
      };
      return q;
    },
    rpc: (...args: unknown[]) => state.rpc(...args),
  }),
}));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: state.userId }),
  checkPermission: async (_a: unknown, _u: string, permission: string | string[]) => ({
    role: state.role,
    allowed: defaultAllows(state.role, permission as never),
  }),
  requirePermission: async (_a: unknown, _u: string, permission: string | string[]) => {
    if (!defaultAllows(state.role, permission as never)) throw new Error("Akses ditolak");
    return state.role;
  },
}));

import {
  ajukanPembatalanPembayaran,
  batalkanPengajuanPembatalan,
  countPengajuanPembatalanMenunggu,
  listPengajuanPembatalan,
  putuskanPengajuanPembatalan,
} from "./pembatalanPembayaran";

const call = <T,>(fn: unknown, data?: unknown) => (fn as (a: { data?: unknown; context: unknown }) => Promise<T>)({ data, context: {} });

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "kasir";
  state.userId = "user-1";
  state.rows = [];
  state.count = 0;
  state.ownCount = 0;
  state.filters = [];
  state.profiles = [];
  state.pegawai = [];
  state.rpc.mockResolvedValue({ data: "pengajuan-1", error: null });
});

describe("ajukanPembatalanPembayaran", () => {
  it("kasir mengajukan lewat RPC dengan identitas dari sesi, bukan dari input", async () => {
    const result = await call<{ id: string }>(ajukanPembatalanPembayaran, { pembayaran_id: "pay-1", alasan: "Salah input nominal" });
    expect(result).toEqual({ id: "pengajuan-1" });
    expect(state.rpc).toHaveBeenCalledWith("ajukan_pembatalan_pembayaran", {
      p_pembayaran_id: "pay-1", p_alasan: "Salah input nominal", p_actor_id: "user-1",
    });
  });

  it("menolak peran tanpa izin mengajukan dan input tidak lengkap sebelum menyentuh database", async () => {
    state.role = "admin_tu";
    await expect(call(ajukanPembatalanPembayaran, { pembayaran_id: "pay-1", alasan: "Salah input" })).rejects.toThrow("Akses ditolak");
    state.role = "kasir";
    await expect(call(ajukanPembatalanPembayaran, { pembayaran_id: "", alasan: "Salah input" })).rejects.toThrow("pembayaran_id wajib diisi");
    await expect(call(ajukanPembatalanPembayaran, { pembayaran_id: "pay-1", alasan: "  abc " })).rejects.toThrow("minimal 5 karakter");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("meneruskan galat database (mis. sudah ada pengajuan menunggu) apa adanya", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Pembayaran ini sudah memiliki pengajuan pembatalan yang menunggu keputusan" } });
    await expect(call(ajukanPembatalanPembayaran, { pembayaran_id: "pay-1", alasan: "Salah input" })).rejects.toThrow("sudah memiliki pengajuan");
  });
});

describe("putuskanPengajuanPembatalan", () => {
  it("penyetuju menyetujui lewat RPC atomik dengan tanggal dan catatan", async () => {
    state.role = "bendahara";
    state.rpc.mockResolvedValue({ data: { jurnal_pembalik_id: "jr-1", tanggal: "2026-11-04" }, error: null });
    const result = await call<{ success: true; jurnal_pembalik_id: string | null }>(putuskanPengajuanPembatalan, {
      id: "p-1", keputusan: "setujui", catatan: "Sesuai bukti", tanggal: "2026-11-04",
    });
    expect(result).toEqual({ success: true, jurnal_pembalik_id: "jr-1" });
    expect(state.rpc).toHaveBeenCalledWith("setujui_pembatalan_pembayaran", {
      p_pengajuan_id: "p-1", p_actor_id: "user-1", p_tanggal: "2026-11-04", p_catatan: "Sesuai bukti",
    });
  });

  it("menolak dengan alasan wajib", async () => {
    state.role = "sekretaris_yayasan";
    state.rpc.mockResolvedValue({ data: null, error: null });
    await expect(call(putuskanPengajuanPembatalan, { id: "p-1", keputusan: "tolak", catatan: "ya" })).rejects.toThrow("minimal 5 karakter");
    await call(putuskanPengajuanPembatalan, { id: "p-1", keputusan: "tolak", catatan: "Bukti valid, tidak perlu dibatalkan" });
    expect(state.rpc).toHaveBeenCalledWith("tolak_pembatalan_pembayaran", {
      p_pengajuan_id: "p-1", p_actor_id: "user-1", p_catatan: "Bukti valid, tidak perlu dibatalkan",
    });
  });

  it.each(["kasir", "keuangan", "guru"])("peran %s (tanpa izin menyetujui) ditolak sebelum RPC", async (role) => {
    state.role = role;
    await expect(call(putuskanPengajuanPembatalan, { id: "p-1", keputusan: "setujui" })).rejects.toThrow("Akses ditolak");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("keputusan selain setujui/tolak ditolak", async () => {
    state.role = "bendahara";
    await expect(call(putuskanPengajuanPembatalan, { id: "p-1", keputusan: "hapus" })).rejects.toThrow("Keputusan tidak valid");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("galat pembatalan (mis. periode ditutup) diteruskan dan tidak dianggap berhasil", async () => {
    state.role = "bendahara";
    state.rpc.mockResolvedValue({ data: null, error: { message: "Periode 2026-11-04 sudah ditutup" } });
    await expect(call(putuskanPengajuanPembatalan, { id: "p-1", keputusan: "setujui" })).rejects.toThrow("sudah ditutup");
  });
});

describe("batalkanPengajuanPembatalan", () => {
  it("memanggil RPC dengan identitas sesi; kepemilikan dicek database", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    await expect(call(batalkanPengajuanPembatalan, { id: "p-1" })).resolves.toEqual({ success: true });
    expect(state.rpc).toHaveBeenCalledWith("batalkan_pengajuan_pembatalan", { p_pengajuan_id: "p-1", p_actor_id: "user-1" });
  });
});

describe("listPengajuanPembatalan", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: "p-1", pembayaran_id: "pay-1", snapshot: { siswa_nama: "Aulia" }, alasan: "Salah input", status: "menunggu",
    diajukan_oleh: "user-9", diajukan_at: "2026-11-04T06:00:00Z", diputuskan_oleh: null, diputuskan_at: null,
    catatan_keputusan: null, tanggal_pembatalan: null, ...extra,
  });

  it("penyetuju melihat semua pengajuan dan boleh memutuskan yang bukan miliknya", async () => {
    state.role = "bendahara";
    state.rows = [row(), row({ id: "p-2", diajukan_oleh: "user-1" })];
    state.profiles = [{ id: "user-9", email: "kasir@x.id", pegawai_id: "peg-1" }, { id: "user-1", email: "me@x.id", pegawai_id: null }];
    state.pegawai = [{ id: "peg-1", nama: "Siti Kasir" }];
    const result = await call<{ items: Array<Record<string, unknown>>; canDecide: boolean }>(listPengajuanPembatalan, { status: "menunggu" });
    expect(result.canDecide).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: "p-1", diajukan_nama: "Siti Kasir", dapat_diputuskan: true, milik_sendiri: false });
    expect(result.items[1]).toMatchObject({ id: "p-2", diajukan_nama: "me@x.id", dapat_diputuskan: false, milik_sendiri: true });
    expect(state.filters.find(([c]) => c === "diajukan_oleh")).toBeUndefined();
  });

  it("kasir hanya melihat pengajuannya sendiri (difilter di server) dan tidak bisa memutuskan", async () => {
    state.role = "kasir";
    state.rows = [row({ diajukan_oleh: "user-1" })];
    const result = await call<{ items: Array<Record<string, unknown>>; canDecide: boolean }>(listPengajuanPembatalan, {});
    expect(result.canDecide).toBe(false);
    expect(state.filters).toContainEqual(["diajukan_oleh", "user-1"]);
    expect(result.items[0]).toMatchObject({ dapat_diputuskan: false, milik_sendiri: true });
  });

  it("peran tanpa izin apa pun ditolak", async () => {
    state.role = "guru";
    await expect(call(listPengajuanPembatalan, {})).rejects.toThrow("Akses ditolak");
  });
});

describe("countPengajuanPembatalanMenunggu", () => {
  it("penyetuju mendapat jumlah pengajuan menunggu milik orang lain (milik sendiri tidak dihitung)", async () => {
    state.role = "bendahara";
    state.count = 4;
    state.ownCount = 1;
    await expect(call(countPengajuanPembatalanMenunggu)).resolves.toEqual({ count: 3 });
  });
  it("peran lain mendapat 0 tanpa galat (dipakai lencana menu)", async () => {
    state.role = "kasir";
    state.count = 3;
    await expect(call(countPengajuanPembatalanMenunggu)).resolves.toEqual({ count: 0 });
  });
});
