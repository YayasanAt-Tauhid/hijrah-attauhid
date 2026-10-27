import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
const reuse = vi.hoisted(() => ({ find: vi.fn() }));
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
  findReusablePaymentForBills: reuse.find,
  resumeOwnedMidtransPayment: vi.fn(),
  cancelOwnedMidtransPayment: vi.fn(),
}));
import { buatTransaksiSnap } from "./payment";

const touchedTables: string[] = [];
beforeEach(() => {
  touchedTables.length = 0;
  reuse.find.mockReset();
  reuse.find.mockResolvedValue(null);
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: { id: "transaction", metadata: {} }, error: null });
  db.from.mockImplementation((table: string) => {
    touchedTables.push(table);
    const rows = table === "tagihan"
      ? [{ id: "bill", nominal: 250_000, status: "belum_bayar", bulan: null,
        tahun_ajaran_id: "ta", jenis: { nama: "INFAQ GEDUNG", departemen_id: "SD" } }]
      : table === "transaksi_midtrans" ? [{ id: "transaction" }] : [];
    const q = {
      select: () => q, eq: () => q, in: () => q, is: () => q, not: () => q, limit: () => q, update: () => q,
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return q;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    token: "fixture-token", redirect_url: "https://app.sandbox.midtrans.com/fixture",
  })));
});
afterEach(() => vi.unstubAllGlobals());

const item = (overrides: Record<string, unknown> = {}) => ({
  tagihan_id: "bill", siswa_id: "student", nama_siswa: "Ahmad", jenis_id: "fee",
  jenis_nama: "INFAQ GEDUNG", bulan: 0, jumlah: 250_000, ...overrides,
});

const checkoutViaLink = (items = [item()], scope = ["bill"], siswaId = "student") => buatTransaksiSnap({
  paymentLink: { id: "link-1", siswaId, tagihanIds: scope },
  input: { items, customer: { user_id: "", email: "", nama: "Wali Ahmad" } },
  callbacks: () => ({
    finish: "https://example.invalid/finish", unfinish: "https://example.invalid/return",
    error: "https://example.invalid/error",
  }),
});

describe("checkout melalui link pembayaran kasir/admin", () => {
  it("tidak memerlukan relasi akun orang tua dan memakai RPC khusus link", async () => {
    const result = await checkoutViaLink();
    expect(result.total_amount).toBe(250_000);
    expect(touchedTables).not.toContain("ortu_siswa");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [name, payload] = db.rpc.mock.calls[0];
    expect(name).toBe("create_midtrans_link_checkout_atomik");
    expect(payload.p_link_id).toBe("link-1");
    expect(payload).not.toHaveProperty("p_user_id");
    expect(reuse.find).toHaveBeenCalledWith({ paymentLinkId: "link-1" }, [{ tagihan_id: "bill", jumlah: 250_000 }]);
  });

  it("tidak mengirim email kosong ke Midtrans", async () => {
    await checkoutViaLink();
    const request = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(request.customer_details).toEqual({ first_name: "Wali Ahmad" });
  });

  it("menolak tagihan siswa lain walau tagihannya ada", async () => {
    await expect(checkoutViaLink([item({ siswa_id: "other-student" })])).rejects.toThrow("tidak termasuk dalam link");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("menolak tagihan di luar daftar yang dipilih kasir", async () => {
    await expect(checkoutViaLink([item({ tagihan_id: "bill-lain" })])).rejects.toThrow("tidak termasuk dalam link");
    await expect(checkoutViaLink([item({ tagihan_id: undefined })])).rejects.toThrow("tidak termasuk dalam link");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("tetap memvalidasi nominal dari database, bukan dari klien", async () => {
    await expect(checkoutViaLink([item({ jumlah: 999_999 })])).rejects.toThrow("melebihi sisa tagihan");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("menolak pemanggilan tanpa pemilik sama sekali", async () => {
    await expect(buatTransaksiSnap({
      input: { items: [item()], customer: { user_id: "", email: "", nama: "x" } },
      callbacks: () => ({ finish: "", unfinish: "", error: "" }),
    } as any)).rejects.toThrow("Pemilik checkout tidak valid");
  });
});
