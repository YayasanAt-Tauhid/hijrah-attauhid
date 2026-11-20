import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  result: { data: [] as unknown[], error: null as null | { code?: string; message?: string } },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "insert", "update"]) {
    builder[name] = (...args: unknown[]) => { state.calls.push([name, args]); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  return { supabase: { from: (table: string) => { state.calls.push(["from", [table]]); return builder; } } };
});

import {
  useHargaSeragamVendor, useSalinHargaSeragam, useSimpanHargaSeragamVendor, useUbahAktifHarga,
} from "./useHargaSeragamVendor";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const dipanggil = (nama: string) => state.calls.filter(([n]) => n === nama);

beforeEach(() => { state.calls = []; state.result = { data: [], error: null }; });
afterEach(cleanup);

describe("useHargaSeragamVendor", () => {
  it("membaca tabel harga untuk tahun ajaran terpilih dan mengubah harga menjadi angka", async () => {
    state.result = {
      data: [{ id: "h1", tahun_ajaran_id: "ta1", departemen_id: "d1", jenis_kelamin: "L", nama_stel: "Set", ukuran: ["S"], harga: "170000", catatan: null, aktif: true }],
      error: null,
    };
    const { result } = renderHook(() => useHargaSeragamVendor("ta1"), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].harga).toBe(170000);
    expect(dipanggil("from")[0][1]).toEqual(["harga_seragam_vendor"]);
    expect(dipanggil("eq")[0][1]).toEqual(["tahun_ajaran_id", "ta1"]);
  });
  it("tidak memanggil basis data bila tahun ajaran belum dipilih", () => {
    renderHook(() => useHargaSeragamVendor(""), { wrapper });
    expect(state.calls).toEqual([]);
  });
});

describe("mutasi", () => {
  const input = {
    tahun_ajaran_id: "ta1", departemen_id: "d1", jenis_kelamin: "L" as const, nama_stel: "  Set Gamis Merah ",
    ukuran: ["x4l", "s"], harga: 170000, catatan: null,
  };
  it("simpan baru: insert dengan nama dirapikan dan ukuran dinormalkan", async () => {
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(dipanggil("insert")[0][1]).toEqual([{ ...input, nama_stel: "Set Gamis Merah", ukuran: ["S", "4XL"] }]);
    expect(dipanggil("update")).toHaveLength(0);
  });
  it("simpan ubah: update menurut id, id tidak ikut dalam isian", async () => {
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ ...input, id: "h9" }); });
    expect(dipanggil("update")[0][1]).toEqual([{ ...input, nama_stel: "Set Gamis Merah", ukuran: ["S", "4XL"] }]);
    expect(dipanggil("eq")[0][1]).toEqual(["id", "h9"]);
  });
  it("tabrakan dari basis data menjadi pesan yang dapat dipahami", async () => {
    state.result = { data: [], error: { code: "23P01", message: "raw" } };
    const { result } = renderHook(() => useSimpanHargaSeragamVendor(), { wrapper });
    await expect(act(async () => { await result.current.mutateAsync(input); })).rejects.toThrow(/bertabrakan/i);
  });
  it("ubah aktif memperbarui hanya kolom aktif", async () => {
    const { result } = renderHook(() => useUbahAktifHarga(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "h1", aktif: false }); });
    expect(dipanggil("update")[0][1]).toEqual([{ aktif: false }]);
    expect(dipanggil("eq")[0][1]).toEqual(["id", "h1"]);
  });
  it("salin memasukkan banyak baris sekaligus", async () => {
    const { result } = renderHook(() => useSalinHargaSeragam(), { wrapper });
    await act(async () => { await result.current.mutateAsync([input, { ...input, nama_stel: "Pramuka" }]); });
    const [[, [baris]]] = dipanggil("insert");
    expect(baris).toHaveLength(2);
  });
});
