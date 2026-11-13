import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  role: "admin" as string,
  managed: null as string[] | null,
  rows: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
  ins: [] as Array<[string, unknown]>,
  from: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  query.select = (columns: string) => { state.selects.push(columns); return query; };
  query.order = () => query;
  query.in = (column: string, values: unknown) => { state.ins.push([column, values]); return query; };
  query.range = () => Promise.resolve({ data: state.rows, error: null });
  return { supabase: { from: (table: string) => { state.from.push(table); return query; } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role }) }));
vi.mock("@/lib/akademikScope", () => ({ getAkademikManagedDepartemenIds: async () => state.managed }));

import { useSiswaSeragamList } from "./useSiswaSeragam";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.role = "admin";
  state.managed = null;
  state.rows = [{ id: "1", nama: "Ahmad", status: "aktif" }];
  state.selects = [];
  state.ins = [];
  state.from = [];
});
afterEach(cleanup);

describe("useSiswaSeragamList", () => {
  it("memuat siswa aktif dan calon diterima, lengkap dengan ukuran seragam dan lembaga tujuan", async () => {
    const { result } = renderHook(() => useSiswaSeragamList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.from).toEqual(["siswa"]);
    expect(state.ins).toContainEqual(["status", ["aktif", "diterima"]]);
    expect(state.selects[0]).toContain("ukuran_seragam");
    expect(state.selects[0]).toContain("spmb_departemen_tujuan_id");
    expect(result.current.data).toEqual(state.rows);
  });

  it("admin_tu hanya mendapat siswa dari lembaga yang dikelolanya", async () => {
    state.role = "admin_tu";
    state.managed = ["sd", "smp"];
    const { result } = renderHook(() => useSiswaSeragamList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.ins).toContainEqual(["departemen_id", ["sd", "smp"]]);
  });

  it("admin_tu tanpa lembaga kelolaan mendapat daftar kosong tanpa query siswa", async () => {
    state.role = "admin_tu";
    state.managed = [];
    const { result } = renderHook(() => useSiswaSeragamList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(state.from).toEqual([]);
  });

  it("peran lain tidak dibatasi lembaga", async () => {
    state.role = "kepala_sekolah";
    const { result } = renderHook(() => useSiswaSeragamList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.ins.some(([column]) => column === "departemen_id")).toBe(false);
  });
});
