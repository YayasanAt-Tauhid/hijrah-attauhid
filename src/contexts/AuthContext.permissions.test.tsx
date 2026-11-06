import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  role: "kasir" as string,
  permissionRows: vi.fn(),
  permissionCalls: [] as Array<[string, string]>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          if (table === "role_permissions") {
            mocks.permissionCalls.push([column, value]);
            return mocks.permissionRows();
          }
          return { abortSignal: () => ({ maybeSingle: async () => ({ data: { role: mocks.role, departemen_id: null }, error: null }) }) };
        },
      }),
    }),
  },
}));

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}
const stored = { data: { session: { user: { id: "u1" }, access_token: "t" } as Session }, error: null };
async function start() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissionCalls = [];
  mocks.getSession.mockResolvedValue(stored);
});
afterEach(cleanup);

describe("AuthProvider: izin peran", () => {
  it("memuat izin peran yang bisa diatur dan menjawab can() sesuai isinya", async () => {
    mocks.role = "kasir";
    mocks.permissionRows.mockResolvedValue({ data: [{ permission: "keuangan.pembayaran" }], error: null });
    await start();
    expect(mocks.permissionCalls).toEqual([["role", "kasir"]]);
    expect(auth.permissionsLoading).toBe(false);
    expect(auth.can("keuangan.pembayaran")).toBe(true);
    expect(auth.can("keuangan.laporan")).toBe(false);
  });

  it("menandai sedang memuat sebelum izin tiba (belum boleh memutus akses)", async () => {
    mocks.role = "bendahara";
    let release!: (value: unknown) => void;
    mocks.permissionRows.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await start();
    expect(auth.permissionsLoading).toBe(true);
    expect(auth.can("keuangan.laporan")).toBe(false);
    await act(async () => release({ data: [{ permission: "keuangan.laporan" }], error: null }));
    expect(auth.permissionsLoading).toBe(false);
    expect(auth.can("keuangan.laporan")).toBe(true);
  });

  it("admin boleh semuanya tanpa membaca tabel izin", async () => {
    mocks.role = "admin";
    await start();
    expect(mocks.permissionCalls).toEqual([]);
    expect(auth.permissionsLoading).toBe(false);
    expect(auth.can("keuangan.akuntansi")).toBe(true);
  });

  it("peran lain (ortu) tidak membaca tabel izin dan tidak punya izin keuangan", async () => {
    mocks.role = "ortu";
    await start();
    expect(mocks.permissionCalls).toEqual([]);
    expect(auth.can("keuangan.pembayaran")).toBe(false);
  });

  it("gagal memuat izin = tanpa izin, bukan galat login", async () => {
    mocks.role = "kasir";
    mocks.permissionRows.mockResolvedValue({ data: null, error: { message: "boom" } });
    await start();
    expect(auth.permissionsLoading).toBe(false);
    expect(auth.authError).toBeNull();
    expect(auth.can("keuangan.pembayaran")).toBe(false);
  });
});
