import { beforeEach, describe, expect, it, vi } from "vitest";

// Rekonsiliasi berkala tidak boleh mencabut link pembayaran biaya pendaftaran
// SPMB (transaksi `pmb_public`). Item-nya memang tidak punya `tagihan_id`.
type Row = Record<string, unknown>;
interface Chain {
  select: () => Chain;
  update: () => Chain;
  eq: () => Chain;
  neq: () => Chain;
  is: () => Chain;
  single: () => Chain;
  then: (resolve: (value: { data: Row[]; error: null }) => unknown) => unknown;
}

const state = vi.hoisted(() => ({
  candidates: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
  gatewayStatus: null as Record<string, unknown> | null,
  closeGatewaySession: vi.fn(),
}));

vi.mock("./supabase", () => {
  const builder = (table: string): Chain => {
    const q: Chain = {
      select: () => q,
      update: () => q,
      eq: () => q,
      neq: () => q,
      is: () => q,
      single: () => q,
      then: (resolve) => resolve(
        table === "transaksi_midtrans_item"
          ? { data: state.items, error: null }
          : { data: [{ id: "tx" }], error: null },
      ),
    };
    return q;
  };
  return {
    readEnv: () => "SB-fixture",
    createAdminClient: () => ({
      from: builder,
      rpc: async () => ({ data: state.candidates, error: null }),
    }),
  };
});

vi.mock("./midtransGateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./midtransGateway")>();
  return {
    ...actual,
    readGatewayStatus: async () => state.gatewayStatus,
    closeGatewaySession: (...args: unknown[]) => state.closeGatewaySession(...args),
  };
});

import { reconcileOnlineSessions } from "./midtransSessions";

const HOUR = 60 * 60 * 1000;
function candidate(overrides: Row = {}): Row {
  return {
    id: "tx",
    order_id: "HAT-PMB-20261104-TEST",
    status: "pending",
    snap_token: "snap",
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    expired_at: new Date(Date.now() + 20 * HOUR).toISOString(),
    gateway_closed_at: null,
    metadata: { source: "pmb_public" },
    ...overrides,
  };
}

beforeEach(() => {
  state.candidates = [];
  state.items = [{ tagihan_id: null, pembayaran_id: null, jumlah: 150000 }];
  state.gatewayStatus = null;
  state.closeGatewaySession = vi.fn(async () => undefined);
});

describe("rekonsiliasi transaksi PMB publik (tanpa tagihan)", () => {
  it("tidak menutup sesi PMB yang masih berlaku walau item tanpa tagihan_id", async () => {
    state.candidates = [candidate()];
    const result = await reconcileOnlineSessions();
    expect(result.closed).toBe(0);
    expect(result.failed).toBe(0);
    expect(state.closeGatewaySession).not.toHaveBeenCalled();
  });

  it("tetap tidak menutup sesi PMB yang masih berlaku saat Midtrans melaporkan pending", async () => {
    state.candidates = [candidate()];
    state.gatewayStatus = { transaction_status: "pending", order_id: "HAT-PMB-20261104-TEST" };
    const result = await reconcileOnlineSessions();
    expect(result.closed).toBe(0);
    expect(state.closeGatewaySession).not.toHaveBeenCalled();
  });

  it("menutup sesi PMB setelah melewati expired_at", async () => {
    state.candidates = [candidate({ expired_at: new Date(Date.now() - HOUR).toISOString() })];
    const result = await reconcileOnlineSessions();
    expect(result.closed).toBe(1);
    expect(state.closeGatewaySession).toHaveBeenCalledTimes(1);
  });

  it("menutup sesi PMB bila Midtrans menyatakan expire", async () => {
    state.candidates = [candidate()];
    state.gatewayStatus = { transaction_status: "expire", order_id: "HAT-PMB-20261104-TEST" };
    const result = await reconcileOnlineSessions();
    expect(result.closed).toBe(1);
    expect(state.closeGatewaySession).toHaveBeenCalledTimes(1);
  });

  it("perilaku lama tetap: transaksi non-PMB tanpa tagihan_id dianggap basi", async () => {
    state.candidates = [candidate({ metadata: {} })];
    const result = await reconcileOnlineSessions();
    expect(result.closed).toBe(1);
    expect(state.closeGatewaySession).toHaveBeenCalledTimes(1);
  });
});
