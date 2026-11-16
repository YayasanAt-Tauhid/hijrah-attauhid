import { describe, expect, it, vi } from "vitest";
import { fetchRpcAllRows } from "./rpcPaging";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ jurnal_id: `j${i}`, akun_id: "kas", debit: i, kredit: 0 }));

// Server yang menghormati range seperti PostgREST (maks 1000 baris per respons).
function honoringServer(all: ReturnType<typeof rows>) {
  return vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }));
}

// Server yang mengabaikan range seperti Rustbase untuk RPC: selalu mengembalikan SEMUA baris.
function ignoringServer(all: ReturnType<typeof rows>) {
  return vi.fn(async () => ({ data: all, error: null }));
}

describe("fetchRpcAllRows", () => {
  it("mengambil semua halaman dari server yang menghormati range", async () => {
    const all = rows(2500);
    const page = honoringServer(all);
    const result = await fetchRpcAllRows(page);
    expect(result).toEqual(all);
    expect(page).toHaveBeenCalledTimes(3);
    expect(page.mock.calls.map((c) => [c[0], c[1]])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("berhenti dengan benar bila jumlah baris tepat kelipatan ukuran halaman", async () => {
    const all = rows(2000);
    const page = honoringServer(all);
    expect(await fetchRpcAllRows(page)).toEqual(all);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("tidak berputar tanpa akhir bila server mengabaikan range dan mengembalikan seluruh hasil (kasus arus kas 29.481 baris)", async () => {
    const all = rows(29481);
    const page = ignoringServer(all);
    const result = await fetchRpcAllRows(page);
    expect(result).toHaveLength(29481);
    expect(result).toEqual(all);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("tidak menggandakan baris bila server mengabaikan range dan hasilnya tepat satu halaman penuh", async () => {
    const all = rows(1000);
    const page = ignoringServer(all);
    const result = await fetchRpcAllRows(page);
    expect(result).toEqual(all);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("mengembalikan array kosong bila tidak ada baris atau data null", async () => {
    expect(await fetchRpcAllRows(async () => ({ data: [], error: null }))).toEqual([]);
    expect(await fetchRpcAllRows(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it("melempar error dari halaman mana pun", async () => {
    const all = rows(2500);
    const page = vi.fn(async (from: number, to: number) =>
      from >= 1000 ? { data: null, error: { message: "Tidak diizinkan mengakses jurnal kas" } } : { data: all.slice(from, to + 1), error: null });
    await expect(fetchRpcAllRows(page)).rejects.toMatchObject({ message: "Tidak diizinkan mengakses jurnal kas" });
  });

  it("melempar error, bukan memotong data diam-diam, bila server terus mengembalikan halaman berbeda melewati batas halaman", async () => {
    const page = vi.fn(async (from: number) => ({ data: rows(1000).map((r, i) => ({ ...r, jurnal_id: `p${from}-${i}` })), error: null }));
    await expect(fetchRpcAllRows(page, { maxPages: 5 })).rejects.toThrow(/melebihi batas/i);
    expect(page).toHaveBeenCalledTimes(5);
  });

  it("memakai ukuran halaman yang diberikan", async () => {
    const all = rows(25);
    const page = honoringServer(all);
    expect(await fetchRpcAllRows(page, { pageSize: 10 })).toEqual(all);
    expect(page.mock.calls.map((c) => [c[0], c[1]])).toEqual([[0, 9], [10, 19], [20, 29]]);
  });
});
