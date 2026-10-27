import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePaymentLinkToken, hashPaymentLinkToken } from "@/lib/paymentLink";

type Call = { table: string; op: string; filters: Array<[string, string, unknown]>; payload?: any };
const h = vi.hoisted(() => ({
  calls: [] as any[],
  handler: (() => ({ data: null, error: null })) as (call: any) => { data: any; error: any },
  role: "kasir",
  snap: vi.fn(),
  close: vi.fn(),
  cancelSession: vi.fn(),
  resumeSession: vi.fn(),
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
  ForbiddenError: class extends Error {},
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
        not: (c: string, _o: string, v: unknown) => { call.filters.push(["not", c, v]); return q; },
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
vi.mock("./midtransSessions", () => ({ closeStoredSession: h.close }));
vi.mock("./pendingMidtrans", () => ({
  cancelOwnedMidtransPayment: h.cancelSession,
  resumeOwnedMidtransPayment: h.resumeSession,
}));

import {
  cancelPaymentLinkForStaff,
  checkoutPaymentLinkByToken,
  createPaymentLinkForStaff,
  listPaymentLinksForStaff,
  resolvePaymentLinkByToken,
  resumePaymentLinkSessionByToken,
  cancelPaymentLinkSessionByToken,
} from "./paymentLink";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const BILL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const future = () => new Date(Date.now() + 3 * 86400_000).toISOString();

const bill = (id: string, bulan: number | null, nominal: number, paid = 0, status = "belum_bayar") => ({
  id, siswa_id: STUDENT, jenis_id: "spp", bulan, nominal, status, jatuh_tempo: null, tahun_ajaran_id: "ta",
  jenis: { nama: "SPP" }, tahun_ajaran: { nama: "2026/2027", tanggal_mulai: "2026-07-01" },
  pembayaran: paid ? [{ jumlah: paid }] : [],
});

const filterValue = (call: Call, column: string) => call.filters.find(([, c]) => c === column)?.[2];

beforeEach(() => {
  h.calls.length = 0;
  h.role = "kasir";
  h.snap.mockReset();
  h.close.mockReset();
  h.cancelSession.mockReset();
  h.resumeSession.mockReset();
  h.handler = () => ({ data: null, error: null });
});

describe("createPaymentLinkForStaff", () => {
  const input = { siswa_id: STUDENT, tagihan_ids: [BILL_A, BILL_B] };

  beforeEach(() => {
    h.handler = (call) => {
      if (call.table === "tagihan") return { data: [bill(BILL_A, 7, 300_000), bill(BILL_B, 8, 300_000, 100_000)], error: null };
      if (call.table === "siswa") return { data: { nama: "Ahmad", telepon: "0812-3456-7890" }, error: null };
      if (call.table === "payment_link" && call.op === "insert") {
        return { data: { id: "link-1", expires_at: call.payload.expires_at }, error: null };
      }
      return { data: null, error: null };
    };
  });

  it.each(["kasir", "admin", "keuangan"])("allows %s and stores only the token hash", async (role) => {
    h.role = role;
    const result = await createPaymentLinkForStaff("staff-1", input, "https://hijrah.example");
    const insert = h.calls.find((c) => c.table === "payment_link" && c.op === "insert")!;
    const token = result.url.split("#")[1];
    expect(result.url).toMatch(/^https:\/\/hijrah\.example\/bayar#[A-Za-z0-9_-]{43}$/);
    expect(insert.payload.token_hash).toBe(await hashPaymentLinkToken(token));
    expect(JSON.stringify(insert.payload)).not.toContain(token);
    expect(insert.payload).toMatchObject({ siswa_id: STUDENT, tagihan_ids: [BILL_A, BILL_B], created_by: "staff-1" });
    expect(Date.parse(insert.payload.expires_at) - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(result.total).toBe(500_000);
    expect(result.telepon).toBe("6281234567890");
    expect(result.whatsapp_url).toContain("https://wa.me/6281234567890?text=");
  });

  it("rejects other roles such as parents and teachers", async () => {
    for (const role of ["ortu", "guru", "kepala_sekolah"]) {
      h.role = role;
      await expect(createPaymentLinkForStaff("x", input, "https://h")).rejects.toThrow("Forbidden");
    }
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("rejects bills that are paid, changed, or belong to another student", async () => {
    h.handler = (call) => call.table === "tagihan"
      ? { data: [bill(BILL_A, 7, 300_000)], error: null }
      : { data: null, error: null };
    await expect(createPaymentLinkForStaff("staff-1", input, "https://h")).rejects.toThrow("Muat ulang tagihan");
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("validates identifiers before querying", async () => {
    await expect(createPaymentLinkForStaff("staff-1", { siswa_id: "x", tagihan_ids: [BILL_A] }, "https://h")).rejects.toThrow("tidak valid");
    await expect(createPaymentLinkForStaff("staff-1", { siswa_id: STUDENT, tagihan_ids: ["1 OR 1=1"] }, "https://h")).rejects.toThrow("tidak valid");
    await expect(createPaymentLinkForStaff("staff-1", { siswa_id: STUDENT, tagihan_ids: [] }, "https://h")).rejects.toThrow("Pilih minimal satu tagihan");
    expect(h.calls.length).toBe(0);
  });
});

describe("listPaymentLinksForStaff", () => {
  it("limits cashiers to their own links but lets admin see all", async () => {
    h.handler = (call) => ({ data: call.table === "payment_link" ? [] : [], error: null });
    await listPaymentLinksForStaff("kasir-1");
    expect(filterValue(h.calls[0], "created_by")).toBe("kasir-1");
    h.calls.length = 0;
    h.role = "admin";
    await listPaymentLinksForStaff("admin-1");
    expect(filterValue(h.calls[0], "created_by")).toBeUndefined();
  });
});

describe("cancelPaymentLinkForStaff", () => {
  const LINK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const link = { id: LINK, created_by: "kasir-1", canceled_at: null };

  it("prevents a cashier from canceling someone else's link", async () => {
    h.handler = (call) => ({ data: call.table === "payment_link" ? link : null, error: null });
    await expect(cancelPaymentLinkForStaff("kasir-2", LINK)).rejects.toThrow("hanya dapat membatalkan link buatan sendiri");
    expect(h.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("rejects malformed link ids", async () => {
    await expect(cancelPaymentLinkForStaff("kasir-1", "link-1")).rejects.toThrow("tidak valid");
  });

  it("cancels first, then closes running Midtrans sessions of the link", async () => {
    const session = { id: "tx", order_id: "HAT-1", status: "pending" };
    h.handler = (call) => {
      if (call.table === "payment_link" && call.op === "select") return { data: link, error: null };
      if (call.table === "payment_link" && call.op === "update") return { data: [{ id: LINK }], error: null };
      if (call.table === "transaksi_midtrans") return { data: [session], error: null };
      return { data: null, error: null };
    };
    await cancelPaymentLinkForStaff("kasir-1", LINK);
    const update = h.calls.find((c) => c.op === "update")!;
    expect(update.payload).toMatchObject({ canceled_by: "kasir-1" });
    expect(filterValue(h.calls.find((c) => c.table === "transaksi_midtrans")!, "payment_link_id")).toBe(LINK);
    expect(h.close).toHaveBeenCalledWith(session, "payment_link_canceled");
  });
});

describe("public access by token", () => {
  let token: string;
  let hash: string;
  let linkRow: any;

  beforeEach(async () => {
    token = generatePaymentLinkToken();
    hash = await hashPaymentLinkToken(token);
    linkRow = { id: "link-1", siswa_id: STUDENT, tagihan_ids: [BILL_A, BILL_B], expires_at: future(), canceled_at: null };
    h.handler = (call) => {
      if (call.table === "payment_link") {
        return { data: filterValue(call, "token_hash") === hash ? linkRow : null, error: null };
      }
      if (call.table === "tagihan") return { data: [bill(BILL_B, 8, 300_000), bill(BILL_A, 7, 300_000)], error: null };
      if (call.table === "siswa") return { data: { nama: "Ahmad", telepon: "0812" }, error: null };
      if (call.table === "transaksi_midtrans") return { data: [], error: null };
      return { data: null, error: null };
    };
  });

  it("rejects malformed and unknown tokens with the same generic message", async () => {
    await expect(resolvePaymentLinkByToken("bukan-token")).rejects.toThrow("Link pembayaran tidak valid");
    expect(h.calls.length).toBe(0);
    await expect(resolvePaymentLinkByToken(generatePaymentLinkToken())).rejects.toThrow("Link pembayaran tidak valid");
  });

  it("shows only the student name and the open bills of the link, oldest first", async () => {
    const result = await resolvePaymentLinkByToken(token);
    expect(result.state).toBe("aktif");
    expect(result.nama_siswa).toBe("Ahmad");
    expect(result.bills.map((b) => b.id)).toEqual([BILL_A, BILL_B]);
    expect(result.total).toBe(600_000);
    expect(JSON.stringify(result)).not.toMatch(/telepon|0812|siswa_id|token_hash/);
  });

  it("hides bills when the link was canceled or expired", async () => {
    linkRow.canceled_at = new Date().toISOString();
    expect((await resolvePaymentLinkByToken(token)).state).toBe("dibatalkan");
    expect((await resolvePaymentLinkByToken(token)).bills).toEqual([]);
    linkRow.canceled_at = null;
    linkRow.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await resolvePaymentLinkByToken(token)).state).toBe("kedaluwarsa");
  });

  it("checks out the selected bills at their database balance via the link owner", async () => {
    h.snap.mockResolvedValue({ redirect_url: "https://app.sandbox.midtrans.com/x", order_id: "HAT-1" });
    const result = await checkoutPaymentLinkByToken(token, [BILL_A], "https://hijrah.example");
    expect(result.redirect_url).toContain("midtrans.com");
    const params = h.snap.mock.calls[0][0];
    expect(params.paymentLink).toEqual({ id: "link-1", siswaId: STUDENT, tagihanIds: [BILL_A, BILL_B] });
    expect(params.userId).toBeUndefined();
    expect(params.input.items).toEqual([expect.objectContaining({ tagihan_id: BILL_A, siswa_id: STUDENT, jumlah: 300_000, bulan: 7 })]);
    const callbacks = params.callbacks("HAT-1");
    // Token tidak boleh dikirim ke Midtrans melalui URL callback.
    expect(JSON.stringify(callbacks)).not.toContain(token);
    expect(callbacks.finish).toBe("https://hijrah.example/bayar?status=selesai&order=HAT-1");
  });

  it("refuses checkout on inactive links or for bills outside the link", async () => {
    await expect(checkoutPaymentLinkByToken(token, ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"], "https://h")).rejects.toThrow("tidak termasuk dalam link");
    linkRow.expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(checkoutPaymentLinkByToken(token, [BILL_A], "https://h")).rejects.toThrow("sudah kedaluwarsa");
    expect(h.snap).not.toHaveBeenCalled();
  });

  it("resumes or cancels only sessions owned by this link", async () => {
    h.resumeSession.mockResolvedValue({ redirect_url: "https://app.sandbox.midtrans.com/x" });
    await resumePaymentLinkSessionByToken(token, "HAT-20261027-ABC");
    expect(h.resumeSession).toHaveBeenCalledWith({ paymentLinkId: "link-1" }, "HAT-20261027-ABC");
    await cancelPaymentLinkSessionByToken(token, "HAT-20261027-ABC");
    expect(h.cancelSession).toHaveBeenCalledWith({ paymentLinkId: "link-1" }, "HAT-20261027-ABC");
    await expect(resumePaymentLinkSessionByToken(token, "DROP TABLE")).rejects.toThrow("Order ID tidak valid");
    await expect(resumePaymentLinkSessionByToken(generatePaymentLinkToken(), "HAT-1")).rejects.toThrow("Link pembayaran tidak valid");
  });

  it("does not resume sessions of an expired or canceled link", async () => {
    linkRow.canceled_at = new Date().toISOString();
    await expect(resumePaymentLinkSessionByToken(token, "HAT-1")).rejects.toThrow("dibatalkan");
    expect(h.resumeSession).not.toHaveBeenCalled();
  });
});
