import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresi: "Too many subrequests by single Worker invocation".
 *
 * Setiap `admin.from(...)`, `admin.rpc(...)` dan `fetch(...)` di Cloudflare
 * Worker dihitung sebagai satu subrequest (batas 50 per invocation di plan
 * gratis). Checkout keranjang besar tidak boleh menambah subrequest seiring
 * bertambahnya jumlah item tagihan.
 */
type Row = Record<string, unknown>;
const calls = vi.hoisted(() => ({ count: 0 }));
const data = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("./auth", () => ({ authMiddleware: {}, requireContext: (context: unknown) => context }));
vi.mock("./pendingMidtrans", () => ({
  findReusablePaymentForBills: async () => {
    calls.count += 1;
    return null;
  },
  resumeOwnedMidtransPayment: vi.fn(),
  cancelOwnedMidtransPayment: vi.fn(),
}));
vi.mock("./supabase", () => {
  // Basis data in-memory minimal: cukup meniru filter yang dipakai checkout
  // sehingga implementasi lama maupun batch menghasilkan perilaku yang sama.
  const makeQuery = (table: string) => {
    calls.count += 1;
    const filters: Array<(row: Row) => boolean> = [];
    let max = Infinity;
    const q: Record<string, unknown> = {
      select: () => q,
      update: () => q,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return q;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return q;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return q;
      },
      not: (column: string, _op: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) !== value);
        return q;
      },
      limit: (n: number) => {
        max = n;
        return q;
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        resolve({
          data: (data.tables[table] ?? []).filter((row) => filters.every((f) => f(row))).slice(0, max),
          error: null,
        }),
    };
    return q;
  };
  return {
    createAdminClient: () => ({
      from: makeQuery,
      rpc: async () => {
        calls.count += 1;
        return { data: { id: "transaction", metadata: {} }, error: null };
      },
    }),
    readEnv: (name: string) => (name === "MIDTRANS_SERVER_KEY" ? "SB-test-fixture" : undefined),
  };
});
import { buatTransaksiSnap } from "./payment";

const JENIS = ["spp", "asrama", "makan"];
const BATAS_AMAN = 15; // jauh di bawah batas 50, menyisakan ruang untuk auth/middleware.

/** Satu siswa, tiga jenis tagihan bulanan, `perJenis` bulan per jenis (Juli dst.). */
function seed(perJenis: number) {
  const tagihan: Row[] = [];
  for (const jenis of JENIS) {
    for (let i = 0; i < perJenis; i += 1) {
      tagihan.push({
        id: `${jenis}-${i}`,
        siswa_id: "student",
        jenis_id: jenis,
        nominal: 450_000,
        status: "belum_bayar",
        bulan: ((6 + i) % 12) + 1,
        jatuh_tempo: null,
        tahun_ajaran_id: "ta-1",
        tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" },
        jenis: { nama: jenis.toUpperCase(), departemen_id: "SD" },
      });
    }
  }
  data.tables = {
    ortu_siswa: [{ user_id: "parent", siswa_id: "student" }],
    tagihan,
    pembayaran: [],
    transaksi_midtrans: [{ id: "transaction", status: "pending" }],
  };
  return tagihan;
}

const checkout = (rows: Row[]) =>
  buatTransaksiSnap({
    userId: "parent",
    input: {
      items: rows.map((row) => ({
        tagihan_id: String(row.id),
        siswa_id: "student",
        nama_siswa: "Siswa Uji",
        jenis_id: String(row.jenis_id),
        jenis_nama: String((row.jenis as Row).nama),
        bulan: Number(row.bulan),
        jumlah: 450_000,
        departemen_id: "SD",
      })),
      customer: { user_id: "client-supplied-owner", email: "qa@example.invalid", nama: "Orang tua" },
    },
    callbacks: () => ({ finish: "https://x.invalid/f", unfinish: "https://x.invalid/u", error: "https://x.invalid/e" }),
  });

beforeEach(() => {
  calls.count = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      calls.count += 1;
      return Response.json({ token: "fixture-token", redirect_url: "https://app.sandbox.midtrans.com/fixture" });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("checkout orang tua: batas subrequest Worker", () => {
  it("keranjang 30 item tetap di bawah batas aman subrequest", async () => {
    const rows = seed(10); // 3 jenis x 10 bulan = 30 item
    const result = await checkout(rows);
    expect(result.total_amount).toBe(30 * 450_000);
    expect(calls.count).toBeLessThanOrEqual(BATAS_AMAN);
  });

  it("jumlah subrequest tidak bertambah seiring jumlah item", async () => {
    await checkout(seed(2)); // 6 item
    const kecil = calls.count;
    calls.count = 0;
    await checkout(seed(10)); // 30 item
    expect(calls.count).toBe(kecil);
  });
});
