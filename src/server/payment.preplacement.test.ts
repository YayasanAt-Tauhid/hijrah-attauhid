import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
const state = vi.hoisted(() => ({ ownsStudent: true, kindName: "UANG PANGKAL SMP" }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: any) => fn };
    return chain;
  },
}));
vi.mock("./auth", () => ({ authMiddleware: {}, requireContext: (context: any) => context }));
vi.mock("./supabase", () => ({
  createAdminClient: () => db,
  readEnv: (name: string) => name === "MIDTRANS_SERVER_KEY" ? "SB-test-fixture" : undefined,
}));
vi.mock("./pendingMidtrans", () => ({
  findReusablePaymentForBills: async () => null,
  resumeOwnedMidtransPayment: vi.fn(),
  cancelOwnedMidtransPayment: vi.fn(),
}));
import { buatTransaksiSnap } from "./payment";

beforeEach(() => {
  state.ownsStudent = true;
  state.kindName = "UANG PANGKAL SMP";
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: { id: "transaction", metadata: {} }, error: null });
  db.from.mockImplementation((table: string) => {
    const rows = table === "ortu_siswa"
      ? (state.ownsStudent ? [{ siswa_id: "student" }] : [])
      : table === "tagihan"
        ? [{ id: "bill", nominal: 4_200_000, status: "terjadwal", bulan: null,
          tahun_ajaran_id: "book-2027", jenis: { nama: state.kindName, departemen_id: "SMP" } }]
        : table === "transaksi_midtrans" ? [{ id: "transaction" }] : [];
    const q = {
      select: () => q, eq: () => q, in: () => q, is: () => q, limit: () => q, update: () => q,
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return q;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    token: "fixture-token", redirect_url: "https://app.sandbox.midtrans.com/fixture",
  })));
});
afterEach(() => vi.unstubAllGlobals());

const checkout = () => buatTransaksiSnap({
  userId: "parent",
  input: {
    items: [{
      tagihan_id: "bill", siswa_id: "student", nama_siswa: "Calon diterima", jenis_id: "fee",
      jenis_nama: "UANG PANGKAL SD", bulan: 0, jumlah: 1_000_000,
      departemen_id: "SD", tahun_ajaran_id: "wrong-book",
    }],
    customer: { user_id: "client-supplied-owner", email: "qa@example.invalid", nama: "Orang tua" },
  },
  callbacks: () => ({
    finish: "https://example.invalid/finish", unfinish: "https://example.invalid/return",
    error: "https://example.invalid/error",
  }),
});

describe("checkout biaya awal sebelum penempatan kelas", () => {
  it("memakai nama, lembaga, dan tahun buku tagihan untuk siswa internal", async () => {
    const result = await checkout();
    expect(result.total_amount).toBe(1_000_000);
    const payload = db.rpc.mock.calls[0][1];
    expect(payload.p_user_id).toBe("parent");
    expect(payload.p_items[0]).toMatchObject({
      departemen_id: "SMP", tahun_ajaran_id: "book-2027", jumlah: 1_000_000,
    });
    const request = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(request.item_details[0].name).toContain("UANG PANGKAL SMP");
  });
  it("nama dari klien tidak dapat membuka cicilan untuk biaya terjadwal lain", async () => {
    state.kindName = "BIAYA PERLENGKAPAN SMP";
    await expect(checkout()).rejects.toThrow("Tagihan yang belum jatuh tempo harus dibayar penuh");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("menolak tagihan siswa yang bukan anak pemanggil", async () => {
    state.ownsStudent = false;
    await expect(checkout()).rejects.toThrow("bukan anak Anda");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
