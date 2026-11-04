import { beforeEach, describe, expect, it, vi } from "vitest";

// Ganti metode pembayaran SPMB: sesi lama ditutup di Midtrans, lalu order baru
// dibuat. Keselamatan utama: tidak boleh menutup sesi yang sudah/ sedang dibayar
// dan tidak boleh membuat order baru bila penutupan sesi lama gagal.
const state = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null,
  siswa: null as Record<string, unknown> | null,
  items: [] as Array<Record<string, unknown>>,
  pembayaran: [] as Array<Record<string, unknown>>,
  gateway: null as Record<string, unknown> | null,
  readGateway: vi.fn(),
  processPaid: vi.fn(),
  closeSession: vi.fn(),
  create: vi.fn(),
  order: [] as string[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (input: unknown) => input;
    const q = {
      middleware: () => q,
      inputValidator: (fn: typeof validate) => { validate = fn; return q; },
      handler: (fn: (args: unknown) => unknown) => (args: { data: unknown }) => fn({ ...args, data: validate(args.data) }),
    };
    return q;
  },
}));
vi.mock("./supabase", () => {
  const builder = (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      or: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: table === "siswa_detail" ? state.detail : state.siswa, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "pembayaran" ? state.pembayaran : state.items, error: null }),
    };
    return q;
  };
  return { createAdminClient: () => ({ from: builder }), readEnv: () => "SB-server-key" };
});
vi.mock("./midtransGateway", () => ({
  readGatewayStatus: (...args: unknown[]) => { state.order.push("gateway"); return state.readGateway(...args); },
  isGatewayPaid: (p: { transaction_status?: string } | null) => p?.transaction_status === "settlement",
}));
vi.mock("./midtransSessions", () => ({
  processGatewayPayment: (...args: unknown[]) => { state.order.push("process"); return state.processPaid(...args); },
  closeStoredSession: (...args: unknown[]) => { state.order.push("close"); return state.closeSession(...args); },
}));
vi.mock("./pmbPayment", () => ({
  createPmbPayment: (...args: unknown[]) => { state.order.push("create"); return state.create(...args); },
}));

import { pmbChangePaymentMethod, PMB_MAX_METHOD_CHANGES } from "./pmbChangeMethod";

const SISWA_ID = "22222222-2222-4222-8222-222222222222";
const JENIS_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "token-pendaftaran";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();

const openTx = (extra: Record<string, unknown> = {}) => ({
  id: "tx-open", order_id: "HAT-PMB-20261104-OLD", status: "pending", snap_token: "snap-old",
  gateway_closed_at: null, expired_at: FUTURE, created_at: new Date().toISOString(),
  metadata: { source: "pmb_public", siswa_id: SISWA_ID, jenis_id: JENIS_ID }, ...extra,
});
const item = (tx: Record<string, unknown>, pembayaranId: string | null = null) => ({
  jenis_id: JENIS_ID, pembayaran_id: pembayaranId, transaksi: tx,
});
const closedByChange = (n: number) => item(openTx({
  id: `tx-closed-${n}`, status: "expired", gateway_closed_at: new Date().toISOString(),
  metadata: { source: "pmb_public", jenis_id: JENIS_ID, session_closure: { reason: "pmb_ganti_metode" } },
}));
const NEW_PAYMENT = {
  success: true, order_id: "HAT-PMB-20261104-NEW", total_amount: 100000, jenis_nama: "Biaya Pendaftaran",
  redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/snap-new",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.order = [];
  state.detail = { siswa_id: SISWA_ID, spmb_status_pendaftaran: "calon" };
  state.siswa = { id: SISWA_ID, status: "calon" };
  state.items = [item(openTx())];
  state.pembayaran = [];
  state.readGateway.mockResolvedValue({ transaction_status: "pending" });
  state.processPaid.mockResolvedValue(undefined);
  state.closeSession.mockResolvedValue(undefined);
  state.create.mockResolvedValue(NEW_PAYMENT);
});

describe("pmbChangePaymentMethod", () => {
  it("menutup sesi lama setelah gateway memastikan pending, baru membuat order baru", async () => {
    const result = await pmbChangePaymentMethod({ data: { payment_token: TOKEN } });
    expect(state.order).toEqual(["gateway", "close", "create"]);
    expect(state.closeSession).toHaveBeenCalledWith(expect.objectContaining({ order_id: "HAT-PMB-20261104-OLD" }), "pmb_ganti_metode");
    expect(state.create).toHaveBeenCalledWith({ payment_token: TOKEN });
    expect(result).toMatchObject({ ...NEW_PAYMENT, perubahan_tersisa: PMB_MAX_METHOD_CHANGES - 1 });
  });

  it("tetap menutup sesi bila belum ada metode terpilih di Midtrans (status 404 → null)", async () => {
    state.readGateway.mockResolvedValue(null);
    await pmbChangePaymentMethod({ data: { payment_token: TOKEN } });
    expect(state.order).toEqual(["gateway", "close", "create"]);
  });

  it("menolak dan mencatat pembayaran bila gateway sudah menyatakan lunas; tidak menutup/membuat order", async () => {
    state.readGateway.mockResolvedValue({ transaction_status: "settlement" });
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/sudah berhasil/i);
    expect(state.processPaid).toHaveBeenCalledTimes(1);
    expect(state.closeSession).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("tidak membuat order baru bila penutupan sesi lama gagal", async () => {
    state.closeSession.mockRejectedValue(new Error("Midtrans menolak pembatalan"));
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow("Midtrans menolak pembatalan");
    expect(state.create).not.toHaveBeenCalled();
  });

  it("menolak setelah batas penggantian tercapai tanpa menyentuh Midtrans", async () => {
    state.items = [item(openTx()), ...Array.from({ length: PMB_MAX_METHOD_CHANGES }, (_, i) => closedByChange(i))];
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/maksimal 3 kali/i);
    expect(state.readGateway).not.toHaveBeenCalled();
    expect(state.closeSession).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("menghitung sisa penggantian dari sesi yang sebelumnya ditutup karena ganti metode", async () => {
    state.items = [item(openTx()), closedByChange(1)];
    const result = await pmbChangePaymentMethod({ data: { payment_token: TOKEN } });
    expect(result.perubahan_tersisa).toBe(PMB_MAX_METHOD_CHANGES - 2);
  });

  it("menolak bila sudah ada transaksi lunas atau pembayaran tercatat", async () => {
    state.items = [item(openTx({ id: "tx-paid", status: "paid" }), "pay-1"), item(openTx())];
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/sudah/i);
    state.items = [item(openTx())];
    state.pembayaran = [{ id: "pay-2" }];
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/sudah dibayar/i);
    expect(state.closeSession).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("menolak token tidak dikenal dan pendaftar yang bukan calon", async () => {
    state.detail = null;
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/tidak valid/i);
    state.detail = { siswa_id: SISWA_ID, spmb_status_pendaftaran: "mengundurkan_diri" };
    await expect(pmbChangePaymentMethod({ data: { payment_token: TOKEN } })).rejects.toThrow(/tidak aktif/i);
    expect(state.closeSession).not.toHaveBeenCalled();
  });

  it("tanpa sesi terbuka (kedaluwarsa) langsung membuat order baru tanpa memakai jatah penggantian", async () => {
    state.items = [item(openTx({ status: "expired", gateway_closed_at: new Date().toISOString() }))];
    const result = await pmbChangePaymentMethod({ data: { payment_token: TOKEN } });
    expect(state.order).toEqual(["create"]);
    expect(result.perubahan_tersisa).toBe(PMB_MAX_METHOD_CHANGES);
  });
});
