import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePaymentLinkToken, hashPaymentLinkToken } from "@/lib/paymentLink";

type Call = { table: string; op: string; filters: Array<[string, string, unknown]>; payload?: any };
const h = vi.hoisted(() => ({
  calls: [] as any[],
  handler: (() => ({ data: null, error: null })) as (call: any) => { data: any; error: any },
  role: "kasir",
  snap: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: any) => fn };
    return chain;
  },
}));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: (c: any) => c,
  requireRole: async (_a: unknown, _u: string, roles: string[]) => {
    if (!roles.includes(h.role)) throw new Error("Forbidden: akses ditolak");
    return h.role;
  },
}));
vi.mock("./supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call: Call = { table, op: "select", filters: [] };
      const q: any = {
        select: () => q,
        insert: (payload: any) => { call.op = "insert"; call.payload = payload; return q; },
        update: (payload: any) => { call.op = "update"; call.payload = payload; return q; },
        order: () => q, limit: () => q,
        eq: (c: string, v: unknown) => { call.filters.push(["eq", c, v]); return q; },
        in: (c: string, v: unknown) => { call.filters.push(["in", c, v]); return q; },
        is: (c: string, v: unknown) => { call.filters.push(["is", c, v]); return q; },
        single: () => q, maybeSingle: () => q,
        then: (resolve: any, reject: any) => {
          h.calls.push(call);
          try { resolve(h.handler(call)); } catch (e) { reject(e); }
        },
      };
      return q;
    },
  }),
  readEnv: () => "SB-key",
}));
vi.mock("./payment", () => ({ buatTransaksiSnap: h.snap }));
vi.mock("./midtransSessions", () => ({ closeStoredSession: vi.fn() }));
vi.mock("./pendingMidtrans", () => ({ cancelOwnedMidtransPayment: vi.fn(), resumeOwnedMidtransPayment: vi.fn() }));

import { checkoutPaymentLinkByToken, createPaymentLinkForStaff, resolvePaymentLinkByToken } from "./paymentLink";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const UP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const uangPangkal = (paid = 1_200_000) => ({
  id: UP, siswa_id: STUDENT, jenis_id: "up", bulan: null, nominal: 4_200_000, status: "terjadwal",
  jatuh_tempo: null, tahun_ajaran_id: "ta", jenis: { nama: "UANG PANGKAL SMP" },
  tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" }, pembayaran: paid ? [{ jumlah: paid }] : [],
});
const spp = {
  id: SPP, siswa_id: STUDENT, jenis_id: "spp", bulan: 8, nominal: 300_000, status: "belum_bayar", jatuh_tempo: null,
  tahun_ajaran_id: "ta", jenis: { nama: "SPP SMP" }, tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" }, pembayaran: [],
};
const perlengkapan = {
  ...spp, id: ALAT, jenis_id: "alat", bulan: null, nominal: 900_000, status: "terjadwal", jenis: { nama: "BIAYA PERLENGKAPAN SMP" },
};

const filterValue = (call: Call, column: string) => call.filters.find(([, c]) => c === column)?.[2];
const byIds = (call: Call, rows: Array<{ id: string }>) => {
  const ids = filterValue(call, "id") as string[] | undefined;
  return { data: ids ? rows.filter((r) => ids.includes(r.id)) : rows, error: null };
};

beforeEach(() => {
  h.calls.length = 0;
  h.role = "kasir";
  h.snap.mockReset();
});

describe("membuat link dengan nominal cicilan", () => {
  beforeEach(() => {
    h.handler = (call) => {
      if (call.table === "tagihan") return byIds(call, [uangPangkal(), spp, perlengkapan]);
      if (call.table === "siswa") return { data: { nama: "Ahmad", telepon: null }, error: null };
      if (call.table === "payment_link" && call.op === "insert") {
        return { data: { id: LINK, expires_at: call.payload.expires_at }, error: null };
      }
      return { data: null, error: null };
    };
  });

  const create = (cicilan: Record<string, unknown>, ids = [UP, SPP]) =>
    createPaymentLinkForStaff("kasir-1", { siswa_id: STUDENT, tagihan_ids: ids, cicilan } as any, "https://h");

  it("menyimpan nominal cicilan uang pangkal dan memakainya di total pesan", async () => {
    const result = await create({ [UP]: 1_000_000 });
    const insert = h.calls.find((c) => c.table === "payment_link" && c.op === "insert")!;
    expect(insert.payload.cicilan).toEqual({ [UP]: 1_000_000 });
    expect(result.total).toBe(1_300_000);
    expect(result.message).toContain("1.300.000");
  });

  it("tanpa cicilan tetap melunasi sisa tagihan", async () => {
    const result = await create({});
    const insert = h.calls.find((c) => c.table === "payment_link" && c.op === "insert")!;
    expect(insert.payload.cicilan).toEqual({});
    expect(result.total).toBe(3_300_000);
  });

  it("menolak cicilan untuk tagihan bulanan dan biaya terjadwal yang wajib penuh", async () => {
    await expect(create({ [SPP]: 100_000 })).rejects.toThrow("tidak dapat dicicil");
    await expect(create({ [ALAT]: 100_000 }, [ALAT])).rejects.toThrow("tidak dapat dicicil");
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("menolak nominal cicilan yang tidak valid", async () => {
    for (const bad of [0, -5, 1_500.5, 3_000_000, 3_500_000, "1000000"]) {
      await expect(create({ [UP]: bad })).rejects.toThrow("Nominal cicilan");
    }
    await expect(create({ [ALAT]: 100_000 })).rejects.toThrow("tidak termasuk");
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
  });
});

describe("orang tua membayar cicilan lewat link", () => {
  let token: string;
  let hash: string;
  let paidViaLink: number;
  let upPaid: number;

  beforeEach(async () => {
    token = generatePaymentLinkToken();
    hash = await hashPaymentLinkToken(token);
    paidViaLink = 0;
    upPaid = 1_200_000;
    h.handler = (call) => {
      if (call.table === "payment_link") {
        return {
          data: filterValue(call, "token_hash") === hash
            ? { id: LINK, siswa_id: STUDENT, tagihan_ids: [UP, SPP], cicilan: { [UP]: 1_000_000 },
              expires_at: new Date(Date.now() + 86400_000).toISOString(), canceled_at: null }
            : null,
          error: null,
        };
      }
      if (call.table === "tagihan") return byIds(call, [uangPangkal(upPaid), spp]);
      if (call.table === "siswa") return { data: { nama: "Ahmad" }, error: null };
      if (call.table === "transaksi_midtrans") {
        const paidQuery = filterValue(call, "status") === "paid";
        return { data: paidQuery && paidViaLink ? [{ id: "tx-1", payment_link_id: LINK }] : [], error: null };
      }
      if (call.table === "transaksi_midtrans_item") {
        return { data: paidViaLink ? [{ transaksi_id: "tx-1", tagihan_id: UP, jumlah: paidViaLink }] : [], error: null };
      }
      return { data: null, error: null };
    };
  });

  it("menampilkan nominal cicilan beserta sisa tagihannya", async () => {
    const view = await resolvePaymentLinkByToken(token);
    const up = view.bills.find((b) => b.id === UP)!;
    expect(up).toMatchObject({ sisa: 1_000_000, sisa_tagihan: 3_000_000, cicilan: true });
    expect(view.bills.find((b) => b.id === SPP)).toMatchObject({ sisa: 300_000, sisa_tagihan: 300_000, cicilan: false });
    expect(view.total).toBe(1_300_000);
  });

  it("membayar nominal cicilan, bukan seluruh sisa", async () => {
    h.snap.mockResolvedValue({ redirect_url: "https://app.sandbox.midtrans.com/x" });
    await checkoutPaymentLinkByToken(token, [UP], "https://h");
    expect(h.snap.mock.calls[0][0].input.items).toEqual([expect.objectContaining({ tagihan_id: UP, jumlah: 1_000_000, bulan: 0 })]);
  });

  it("memakai sisa tagihan bila lebih kecil dari nominal cicilan", async () => {
    upPaid = 3_600_000; // sisa 600.000 (mis. sebagian dibayar tunai)
    const view = await resolvePaymentLinkByToken(token);
    expect(view.bills.find((b) => b.id === UP)).toMatchObject({ sisa: 600_000, sisa_tagihan: 600_000 });
  });

  it("cicilan yang sudah dibayar lewat link ini tidak bisa dibayar lagi dengan link yang sama", async () => {
    paidViaLink = 1_000_000;
    upPaid = 2_200_000;
    const view = await resolvePaymentLinkByToken(token);
    expect(view.bills.map((b) => b.id)).toEqual([SPP]);
    await expect(checkoutPaymentLinkByToken(token, [UP], "https://h")).rejects.toThrow("sudah dibayar");
    expect(h.snap).not.toHaveBeenCalled();
  });
});
