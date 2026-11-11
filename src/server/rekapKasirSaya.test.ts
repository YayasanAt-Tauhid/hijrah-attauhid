import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; column?: string; value?: unknown }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
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
      const filters: Array<(row: Row) => boolean> = [];
      const record = (op: string, column?: string, value?: unknown) => state.calls.push({ table, op, column, value });
      const rows = () => (state.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const q: Record<string, unknown> = {
        select: () => { record("select"); return q; },
        eq: (c: string, v: unknown) => { record("eq", c, v); filters.push((r) => r[c] === v); return q; },
        gte: (c: string, v: string) => { record("gte", c, v); filters.push((r) => String(r[c]) >= v); return q; },
        lte: (c: string, v: string) => { record("lte", c, v); filters.push((r) => String(r[c]) <= v); return q; },
        in: (c: string, v: unknown[]) => { record("in", c, v); filters.push((r) => v.includes(r[c])); return q; },
        order: () => q,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      };
      return q;
    },
  }),
}));

vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "user-1" }),
  requirePermission: async () => "kasir",
}));

vi.mock("./midtransSessions", () => ({ closeOnlineSessionsForBills: vi.fn() }));

import { getRekapKasirSaya } from "./pembayaran";

const payment = (id: string, tanggal: string, petugas = "user-1"): Row => ({
  id, jumlah: 450000, tanggal_bayar: tanggal, bulan: 10, keterangan: null, siswa_id: "s1", petugas_id: petugas,
  jenis_pembayaran: { nama: "SPP SMP" },
  siswa: { nama: "Nailah", nis: "257", nisn: "012", status: "aktif", kelas_siswa: [{ aktif: true, kelas: { nama: "8C" } }] },
  departemen: { kode: "SMP", nama: "SMP" },
  jurnal: { nomor: "JU-1" },
});

beforeEach(() => {
  state.calls = [];
  state.tables = {
    users_profile: [{ id: "user-1", pegawai_id: "peg-1" }],
    pegawai: [{ id: "peg-1", nama: "Fitri Yanto, S.Si" }],
    pembayaran: [
      payment("p1", "2026-11-10"),
      payment("p2", "2026-11-11"),
      payment("p3", "2026-11-12", "peg-1"),
      payment("p4", "2026-11-11", "user-lain"),
      payment("p5", "2026-11-20"),
    ],
    payment_receipt_items: [
      { payment_id: "p1", receipt_id: "r1", period_label: "Oktober 2026" },
      { payment_id: "p2", receipt_id: "r1", period_label: "November 2026" },
    ],
    payment_receipts: [{ id: "r1", receipt_number: "KWT-2026-11-0439", payment_method: "bank_transfer" }],
  };
});

describe("getRekapKasirSaya", () => {
  it("still accepts a single date", async () => {
    const result = await getRekapKasirSaya({ data: { tanggal: "2026-11-11" } });
    expect(result.items.map((item) => item.id)).toEqual(["p2"]);
    expect(result.tanggal_dari).toBe("2026-11-11");
    expect(result.tanggal_sampai).toBe("2026-11-11");
  });

  it("returns the logged-in cashier's payments inside the date range only", async () => {
    const result = await getRekapKasirSaya({ data: { tanggal_dari: "2026-11-10", tanggal_sampai: "2026-11-12" } });
    expect(result.items.map((item) => item.id).sort()).toEqual(["p1", "p2", "p3"]);
    expect(result.total_penerimaan).toBe(1350000);
    expect(state.calls).toContainEqual({ table: "pembayaran", op: "gte", column: "tanggal_bayar", value: "2026-11-10" });
    expect(state.calls).toContainEqual({ table: "pembayaran", op: "lte", column: "tanggal_bayar", value: "2026-11-12" });
    expect(state.calls).toContainEqual({ table: "pembayaran", op: "in", column: "petugas_id", value: ["user-1", "peg-1"] });
  });

  it("attaches receipt number, payment method and period label with batched lookups", async () => {
    const result = await getRekapKasirSaya({ data: { tanggal_dari: "2026-11-10", tanggal_sampai: "2026-11-12" } });
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
    expect(byId.p1).toMatchObject({ receipt_number: "KWT-2026-11-0439", payment_method: "bank_transfer", periode_label: "Oktober 2026" });
    expect(byId.p2).toMatchObject({ receipt_number: "KWT-2026-11-0439", periode_label: "November 2026" });
    expect(byId.p3).toMatchObject({ receipt_number: null, payment_method: null, periode_label: null });
    const lookups = state.calls.filter((call) => call.op === "select" && call.table.startsWith("payment_receipt"));
    expect(lookups.map((call) => call.table)).toEqual(["payment_receipt_items", "payment_receipts"]);
  });

  it("rejects ranges longer than 31 days", async () => {
    await expect(getRekapKasirSaya({ data: { tanggal_dari: "2026-10-01", tanggal_sampai: "2026-11-11" } }))
      .rejects.toThrow(/31 hari/);
  });
});
