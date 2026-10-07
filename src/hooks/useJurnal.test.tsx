import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useJurnalList, useJurnalPenginput } from "./useJurnal";

const { pages, calls } = vi.hoisted(() => ({
  pages: [] as Array<{ data: Array<{ id?: string; dibuat_oleh?: string; penginput?: { nama: string } }> | null; error: Error | null }>,
  calls: [] as Array<[string, ...unknown[]]>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ["select", "order", "gte", "lte", "eq", "is", "like", "or", "not"]) {
        query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
      }
      query.range = (...args: unknown[]) => {
        calls.push(["range", ...args]);
        return Promise.resolve(pages.shift() || { data: [], error: null });
      };
      return query;
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>;
}
beforeEach(() => { pages.length = 0; calls.length = 0; });
afterEach(cleanup);

describe("Filter penginput jurnal", () => {
  it("menggabungkan penginput dengan tanggal dan lembaga sebelum mengambil data", async () => {
    pages.push({ data: [{ id: "j-1", dibuat_oleh: "pegawai-a" }], error: null });
    const { result } = renderHook(() => useJurnalList("2026-10-01", "2026-10-07", "sd", "pegawai-a"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual(expect.arrayContaining([
      ["gte", "tanggal", "2026-10-01"], ["lte", "tanggal", "2026-10-07"],
      ["eq", "departemen_id", "sd"], ["eq", "dibuat_oleh", "pegawai-a"],
    ]));
    expect(result.current.data).toHaveLength(1);
  });

  it("mengambil semua halaman sehingga hasil lebih dari 1000 jurnal tetap lengkap", async () => {
    pages.push({ data: Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), error: null },
      { data: [{ id: "last" }], error: null });
    const { result } = renderHook(() => useJurnalList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1001);
    expect(calls.filter(([m]) => m === "range")).toEqual([["range", 0, 999], ["range", 1000, 1999]]);
    expect(calls.some(([m, field]) => m === "eq" && field === "dibuat_oleh")).toBe(false);
  });

  it.each([
    ["__online__", ["like", "referensi", "HAT-%"]],
    ["__unknown__", ["or", "referensi.is.null,referensi.not.like.HAT-%"]],
  ])("membedakan kategori %s dari penginput manusia", async (filter, expected) => {
    const { result } = renderHook(() => useJurnalList(undefined, undefined, undefined, filter), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toContainEqual(["is", "dibuat_oleh", null]);
    expect(calls).toContainEqual(expected);
    expect(result.current.data).toEqual([]);
  });

  it("memuat nama unik dari seluruh halaman tanpa menyatukan pegawai bernama sama", async () => {
    pages.push({ data: Array.from({ length: 1000 }, () => ({ dibuat_oleh: "a", penginput: { nama: "Zaki" } })), error: null },
      { data: [{ dibuat_oleh: "b", penginput: { nama: "Ali" } }, { dibuat_oleh: "c", penginput: { nama: "Ali" } }], error: null });
    const { result } = renderHook(() => useJurnalPenginput(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "b", nama: "Ali" }, { id: "c", nama: "Ali" }, { id: "a", nama: "Zaki" }]);
  });

  it("melaporkan kegagalan halaman berikutnya tanpa menampilkan hasil parsial", async () => {
    pages.push({ data: Array.from({ length: 1000 }, () => ({ id: "j" })), error: null },
      { data: null, error: new Error("Akses ditolak") });
    const { result } = renderHook(() => useJurnalList(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
