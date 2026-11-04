import { beforeEach, describe, expect, it, vi } from "vitest";

// Biaya pendaftaran SPMB (`metadata.source === "pmb_public"`) bukan tagihan:
// itemnya memang tanpa `tagihan_id` dan `tahun_ajaran_id`. Pencatatan setelah
// Midtrans `settlement` tidak boleh mencoba memvalidasi tagihan untuk item itu
// (dulu: `invalid input syntax for type uuid: "null"` sehingga tidak tercatat).
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  transaksi: null as Record<string, unknown> | null,
  tagihanQueries: [] as Array<Array<[string, ...unknown[]]>>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  metadataWrites: [] as Row[],
}));

vi.mock("@/server/supabase", () => {
  const builder = (table: string) => {
    const filters: Array<[string, ...unknown[]]> = [];
    let updateValues: Row | null = null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (...f: unknown[]) => { filters.push(["eq", ...f]); return q; };
    q.is = (...f: unknown[]) => { filters.push(["is", ...f]); return q; };
    q.update = (v: Row) => { updateValues = v; if (table === "transaksi_midtrans") state.metadataWrites.push(v); return q; };
    q.insert = async () => ({ error: null });
    q.maybeSingle = async () => {
      if (table === "transaksi_midtrans") return { data: state.transaksi, error: null };
      if (table === "pengaturan_akun") return { data: { akun_id: "akun-bank-midtrans" }, error: null };
      if (table === "tagihan") { state.tagihanQueries.push(filters); return { data: null, error: null }; }
      return { data: null, error: null };
    };
    q.single = async () => ({
      data: { nama: "UANG PENDAFTARAN CALON SISWA TK", departemen_id: "dep-tk", akun_pendapatan_id: "akun-pendapatan" },
      error: null,
    });
    q.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      void updateValues;
      return resolve({ data: [], error: null });
    };
    return q;
  };
  return {
    readEnv: () => "SB-fixture",
    createAdminClient: () => ({
      from: builder,
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        return { data: { pembayaran_id: "pay-1", jurnal_id: "jur-1" }, error: null };
      },
    }),
  };
});
vi.mock("@/server/push", () => ({ kirimPushKeOrtu: async () => undefined }));
vi.mock("./midtransSessions", () => ({ closeOnlineSessionsForBills: async () => undefined }));

import { handleNotification } from "./midtransNotification";

async function signed(orderId: string, statusCode: string, gross: string) {
  const bytes = new TextEncoder().encode(`${orderId}${statusCode}${gross}SB-fixture`);
  const hash = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function settlement(orderId: string) {
  return handleNotification(new Request("https://internal/api/midtrans-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId,
      transaction_id: "mid-1",
      gross_amount: "100000.00",
      status_code: "200",
      transaction_status: "settlement",
      payment_type: "qris",
      signature_key: await signed(orderId, "200", "100000.00"),
    }),
  }));
}

function transaksi(orderId: string, source: string | undefined, itemOverrides: Row = {}) {
  return {
    id: "tx-1",
    order_id: orderId,
    user_id: null,
    status: "pending",
    paid_at: null,
    total_amount: 100000,
    metadata: source ? { source } : {},
    transaksi_midtrans_item: [{
      id: "item-1",
      siswa_id: "siswa-1",
      jenis_id: "jenis-1",
      bulan: 0,
      jumlah: 100000,
      departemen_id: "dep-tk",
      tahun_ajaran_id: null,
      tagihan_id: null,
      pembayaran_id: null,
      ...itemOverrides,
    }],
  };
}

beforeEach(() => {
  state.transaksi = null;
  state.tagihanQueries = [];
  state.rpcCalls = [];
  state.metadataWrites = [];
});

describe("pencatatan pembayaran biaya pendaftaran SPMB (tanpa tagihan)", () => {
  it("mencatat item pmb_public tanpa tagihan_id/tahun_ajaran_id lewat RPC, tanpa memvalidasi tagihan", async () => {
    state.transaksi = transaksi("HAT-PMB-20261104-TEST", "pmb_public");
    const response = await settlement("HAT-PMB-20261104-TEST");

    expect(response.status).toBe(200);
    expect(state.tagihanQueries).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe("proses_pembayaran_midtrans_dengan_kuitansi_atomik");
    expect(state.rpcCalls[0].args).toMatchObject({
      p_transaksi_item_id: "item-1",
      p_siswa_id: "siswa-1",
      p_jenis_id: "jenis-1",
      p_jumlah: 100000,
      p_tahun_ajaran_id: null,
      p_kas_akun_id: "akun-bank-midtrans",
      p_kredit_akun_id: "akun-pendapatan",
    });
  });

  it("tidak pernah mengirim eq(tahun_ajaran_id, null) ke tabel tagihan untuk item tanpa tahun ajaran", async () => {
    state.transaksi = transaksi("HAT-TEST-NONPMB", undefined);
    const response = await settlement("HAT-TEST-NONPMB");

    // Item non-PMB tanpa tagihan_id dan tanpa tahun ajaran tidak dapat
    // dicocokkan ke tagihan: ditolak dengan pesan jelas, bukan error uuid.
    expect(response.status).toBe(500);
    expect(state.tagihanQueries).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    const written = state.metadataWrites.find((w) => (w.metadata as Row | undefined)?.item_processing);
    const processing = (written?.metadata as { item_processing: Array<{ error?: string }> }).item_processing;
    expect(processing[0].error).toMatch(/tidak terkait tagihan/i);
    expect(processing[0].error).not.toMatch(/uuid/i);
  });

  it("perilaku lama tetap: item bertagihan divalidasi terhadap tagihan aktif", async () => {
    state.transaksi = transaksi("HAT-TEST-SPP", undefined, { tagihan_id: "tagihan-1", tahun_ajaran_id: "ta-1", bulan: 7 });
    await settlement("HAT-TEST-SPP");

    expect(state.tagihanQueries).toHaveLength(1);
    expect(state.tagihanQueries[0]).toContainEqual(["eq", "id", "tagihan-1"]);
    expect(state.rpcCalls).toHaveLength(0); // fixture: tagihan tidak ditemukan → tidak dibukukan
  });
});
