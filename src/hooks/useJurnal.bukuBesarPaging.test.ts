// Regresi: Rustbase mengabaikan .range() pada RPC dan selalu mengembalikan SEMUA baris
// (lihat src/lib/rpcPaging.ts). Loop paginasi "lanjut selama halaman penuh 1000 baris" tidak
// pernah berhenti untuk akun dengan >= 1000 transaksi (log produksi: offset sampai 4.800.000).
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchBukuBesarAkun, fetchBukuBesarSemuaRinci } from "./useJurnal";

type Handler = (name: string, args: Record<string, unknown>, from: number, to: number | undefined) => unknown;

// Meniru builder Supabase: `await rpc(...)` dan `await rpc(...).range(a, b)`.
// Pembatas keselamatan: kode yang berputar tanpa akhir harus GAGAL cepat di tes (bukan menghabiskan
// memori mesin pengembangan seperti saat loop lama dijalankan terhadap 35.000 baris).
const BATAS_PANGGILAN = 25;

function pasangServer(handler: Handler) {
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (rpc.mock.calls.length > BATAS_PANGGILAN) {
      throw new Error(`Loop paginasi tak berujung: lebih dari ${BATAS_PANGGILAN} panggilan RPC`);
    }
    const selesai = (from: number, to?: number) => Promise.resolve({ data: handler(name, args, from, to), error: null });
    return {
      range: (from: number, to: number) => selesai(from, to),
      then: (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) => selesai(0).then(ok, ng),
    };
  });
}

const mutasiAkun = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    tanggal: "2026-03-01", nomor: `J${i}`, lembaga: "SMP", keterangan: "x", debit: String(i + 1), kredit: 0, tipe: "normal",
  }));
const mutasiSemua = (n: number) => mutasiAkun(n).map((r) => ({ ...r, akun_id: "a1" }));

const saldoAwalSatuAkun = (name: string) => (name === "buku_besar_saldo_awal" ? "250" : undefined);

const perAkun = { akunId: "a1", tglAwal: "2026-01-01", tglAkhir: "2026-12-31" };
const semua = { tglAwal: "2026-01-01", tglAkhir: "2026-12-31" };

function mutasiCalls(name: string) {
  return rpc.mock.calls.filter((c) => c[0] === name).length;
}

describe("fetchBukuBesarAkun", () => {
  beforeEach(() => rpc.mockReset());

  it("server mengabaikan range (Rustbase), akun 1.717 transaksi: satu permintaan, tanpa loop tak berujung", async () => {
    const all = mutasiAkun(1717);
    pasangServer((name) => (name === "buku_besar_mutasi" ? all : saldoAwalSatuAkun(name)));
    const r = await fetchBukuBesarAkun(perAkun);
    expect(r.mutasi).toHaveLength(1717);
    expect(r.saldoAwal).toBe(250);
    expect(mutasiCalls("buku_besar_mutasi")).toBe(1);
  });

  it("server mengabaikan range dan hasil tepat 1.000 baris: tidak digandakan", async () => {
    const all = mutasiAkun(1000);
    pasangServer((name) => (name === "buku_besar_mutasi" ? all : saldoAwalSatuAkun(name)));
    const r = await fetchBukuBesarAkun(perAkun);
    expect(r.mutasi).toHaveLength(1000);
    expect(mutasiCalls("buku_besar_mutasi")).toBeLessThanOrEqual(2);
  });

  it("server yang menghormati range (PostgREST) tetap lengkap", async () => {
    const all = mutasiAkun(2500);
    pasangServer((name, _a, from, to) => (name === "buku_besar_mutasi" ? all.slice(from, (to ?? from) + 1) : saldoAwalSatuAkun(name)));
    const r = await fetchBukuBesarAkun(perAkun);
    expect(r.mutasi).toHaveLength(2500);
    expect(mutasiCalls("buku_besar_mutasi")).toBe(3);
  });

  it("angka string dari database dikonversi menjadi number dan parameter diteruskan", async () => {
    pasangServer((name) => (name === "buku_besar_mutasi" ? mutasiAkun(2) : saldoAwalSatuAkun(name)));
    const r = await fetchBukuBesarAkun({ ...perAkun, departemenIds: ["d1"], includePenutup: true, excludeKoreksi: true });
    expect(r.mutasi.map((m) => m.debit)).toEqual([1, 2]);
    const args = rpc.mock.calls.find((c) => c[0] === "buku_besar_mutasi")![1];
    expect(args).toMatchObject({ p_akun_id: "a1", p_departemen_ids: ["d1"], p_include_penutup: true, p_exclude_koreksi: true });
  });
});

describe("fetchBukuBesarSemuaRinci", () => {
  beforeEach(() => rpc.mockReset());

  it("server mengabaikan range, 5.000 baris (setara 35.000 di produksi): satu permintaan mutasi (export tidak berputar tanpa akhir)", async () => {
    const all = mutasiSemua(5000);
    pasangServer((name) =>
      name === "buku_besar_mutasi_semua" ? all : name === "buku_besar_saldo_awal_semua" ? [{ akun_id: "a1", saldo: "10" }] : undefined);
    const r = await fetchBukuBesarSemuaRinci(semua);
    expect(r.mutasi).toHaveLength(5000);
    expect(r.saldoAwal).toEqual({ a1: 10 });
    expect(mutasiCalls("buku_besar_mutasi_semua")).toBe(1);
  });

  it("server yang menghormati range tetap lengkap", async () => {
    const all = mutasiSemua(2300);
    pasangServer((name, _a, from, to) =>
      name === "buku_besar_mutasi_semua" ? all.slice(from, (to ?? from) + 1) : name === "buku_besar_saldo_awal_semua" ? [] : undefined);
    const r = await fetchBukuBesarSemuaRinci(semua);
    expect(r.mutasi).toHaveLength(2300);
    expect(mutasiCalls("buku_besar_mutasi_semua")).toBe(3);
  });
});
