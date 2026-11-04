import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  rows: [] as Array<{ role: string; permission: string }>,
  log: [] as Array<Record<string, unknown>>,
  order: [] as string[],
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
      const q: Record<string, unknown> = {
        select: () => q, in: () => q, order: () => q, limit: () => q,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: table === "role_permissions" ? state.rows : state.log, error: null }),
      };
      return q;
    },
    rpc: (...args: unknown[]) => { state.order.push("rpc"); return state.rpc(...args); },
  }),
}));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "admin-1" }),
  requireRole: (...args: unknown[]) => { state.order.push("role"); return state.requireRole(...args); },
}));

import { listRolePermissions, updateRolePermissions } from "./rolePermissions";

beforeEach(() => {
  vi.clearAllMocks();
  state.order = [];
  state.requireRole.mockResolvedValue("admin");
  state.rpc.mockResolvedValue({ data: { granted: ["keuangan.laporan"], revoked: [] }, error: null });
  state.rows = [
    { role: "kasir", permission: "keuangan.pembayaran" },
    { role: "bendahara", permission: "keuangan.laporan" },
  ];
  state.log = [{ role: "kasir", granted: ["keuangan.pembayaran"], revoked: [], changed_at: "2026-11-04T06:00:00Z" }];
});

describe("listRolePermissions", () => {
  it("hanya untuk admin dan mengelompokkan izin per peran yang bisa diatur", async () => {
    const result = await (listRolePermissions as unknown as (a: object) => Promise<Awaited<ReturnType<typeof listRolePermissions>>>)({});
    expect(state.requireRole).toHaveBeenCalledWith(expect.anything(), "admin-1", ["admin"]);
    expect(result.roles).toEqual({
      keuangan: [], kasir: ["keuangan.pembayaran"], bendahara: ["keuangan.laporan"], sekretaris_yayasan: [],
    });
    expect(result.log).toHaveLength(1);
  });

  it("menolak non-admin tanpa membaca data", async () => {
    state.requireRole.mockRejectedValue(new Error("Forbidden"));
    await expect((listRolePermissions as unknown as (a: object) => Promise<unknown>)({})).rejects.toThrow("Forbidden");
  });
});

describe("updateRolePermissions", () => {
  it("memeriksa admin dulu, membersihkan izin, lalu memanggil RPC atomik", async () => {
    const result = await updateRolePermissions({ data: { role: "bendahara", permissions: ["keuangan.laporan", "ngawur", "keuangan.laporan"] } });
    expect(state.order).toEqual(["role", "rpc"]);
    expect(state.rpc).toHaveBeenCalledWith("set_role_permissions", {
      p_role: "bendahara",
      // akses data otomatis ditambahkan untuk bendahara; kunci ngawur dan duplikat dibuang
      p_permissions: ["keuangan.akses_data", "keuangan.laporan"],
      p_actor_id: "admin-1",
    });
    expect(result).toEqual({ success: true, granted: ["keuangan.laporan"], revoked: [] });
  });

  it("menolak peran yang tidak bisa diatur (termasuk admin) tanpa memanggil RPC", async () => {
    for (const role of ["admin", "ortu", "guru", ""]) {
      await expect(updateRolePermissions({ data: { role, permissions: [] } })).rejects.toThrow(/tidak dapat diatur/i);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("non-admin ditolak sebelum menyentuh data", async () => {
    state.requireRole.mockRejectedValue(new Error("Forbidden"));
    await expect(updateRolePermissions({ data: { role: "kasir", permissions: [] } })).rejects.toThrow("Forbidden");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("meneruskan galat RPC", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Akses ditolak" } });
    await expect(updateRolePermissions({ data: { role: "kasir", permissions: [] } })).rejects.toThrow("Akses ditolak");
  });
});
