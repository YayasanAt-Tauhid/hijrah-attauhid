import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ client: () => ({ server: () => ({}) }) }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ForbiddenError, checkPermission, requirePermission } from "./auth";

interface Profile { role: string; aktif?: boolean | null }
function fakeAdmin(profile: Profile | null, granted: string[] = []) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      const filters: Record<string, string> = {};
      let wanted: readonly string[] = [];
      const q = {
        select: () => q,
        eq: (column: string, value: string) => { filters[column] = value; return q; },
        in: (_column: string, values: readonly string[]) => { wanted = values; return q; },
        single: async () => ({ data: profile, error: null }),
        limit: async () => {
          calls.push(`${table}:${filters.role}:${wanted.join("|")}`);
          return { data: wanted.filter((key) => granted.includes(key)).map((permission) => ({ permission })), error: null };
        },
      };
      return q;
    },
  };
  return { admin: admin as never, calls };
}

describe("requirePermission", () => {
  it("admin selalu lolos tanpa membuka tabel izin", async () => {
    const { admin, calls } = fakeAdmin({ role: "admin" });
    await expect(requirePermission(admin, "u1", "keuangan.akuntansi")).resolves.toBe("admin");
    expect(calls).toEqual([]);
  });

  it("peran yang bisa diatur lolos hanya bila izinnya ada dan mengembalikan perannya", async () => {
    const ok = fakeAdmin({ role: "kasir" }, ["keuangan.pembayaran"]);
    await expect(requirePermission(ok.admin, "u1", "keuangan.pembayaran")).resolves.toBe("kasir");
    expect(ok.calls).toEqual(["role_permissions:kasir:keuangan.pembayaran"]);
    const denied = fakeAdmin({ role: "kasir" }, ["keuangan.pembayaran"]);
    await expect(requirePermission(denied.admin, "u1", "keuangan.laporan")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("peran tambahan (mis. admin_tu) lolos lewat extraRoles tanpa tabel izin", async () => {
    const { admin, calls } = fakeAdmin({ role: "admin_tu" });
    await expect(requirePermission(admin, "u1", "keuangan.pembayaran", { extraRoles: ["admin_tu"] })).resolves.toBe("admin_tu");
    expect(calls).toEqual([]);
  });

  it("peran yang tidak bisa diatur tidak pernah lolos hanya karena tabel izin berisi namanya", async () => {
    const { admin, calls } = fakeAdmin({ role: "guru" }, ["keuangan.pembayaran"]);
    await expect(requirePermission(admin, "u1", "keuangan.pembayaran")).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toEqual([]);
  });

  it("akun nonaktif atau tanpa profil ditolak", async () => {
    await expect(requirePermission(fakeAdmin({ role: "admin", aktif: false }).admin, "u1", "keuangan.laporan")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requirePermission(fakeAdmin(null).admin, "u1", "keuangan.laporan")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("beberapa kunci: cukup salah satu yang diberikan", async () => {
    const { admin, calls } = fakeAdmin({ role: "bendahara" }, ["keuangan.laporan"]);
    await expect(requirePermission(admin, "u1", ["keuangan.rekap_kasir", "keuangan.laporan"])).resolves.toBe("bendahara");
    expect(calls).toEqual(["role_permissions:bendahara:keuangan.rekap_kasir|keuangan.laporan"]);
    const none = fakeAdmin({ role: "bendahara" }, []);
    await expect(requirePermission(none.admin, "u1", ["keuangan.rekap_kasir", "keuangan.laporan"])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("checkPermission", () => {
  it("mengembalikan allowed=false tanpa melempar dan tetap menyebut perannya", async () => {
    const { admin } = fakeAdmin({ role: "ortu" });
    await expect(checkPermission(admin, "u1", "keuangan.pembayaran")).resolves.toEqual({ role: "ortu", allowed: false });
  });
  it("allowed=true untuk peran yang punya izin", async () => {
    const { admin } = fakeAdmin({ role: "kasir" }, ["keuangan.pembayaran"]);
    await expect(checkPermission(admin, "u1", "keuangan.pembayaran")).resolves.toEqual({ role: "kasir", allowed: true });
  });
});
