import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
const state = vi.hoisted(() => ({ openBills: [] as Array<Record<string, unknown>> }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = { middleware: () => chain, inputValidator: () => chain, handler: (fn: unknown) => fn };
    return chain;
  },
}));
vi.mock("./auth", () => ({ authMiddleware: {}, requireContext: (context: unknown) => context }));
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

const NOMINAL = 4_200_000;
const bill = (id: string, nama: string, mulai: string) => ({
  id,
  siswa_id: "student",
  jenis_id: "fee",
  nominal: NOMINAL,
  status: "belum_bayar",
  bulan: null,
  jatuh_tempo: null,
  tahun_ajaran_id: `ta-${id}`,
  tahun_ajaran: { nama, tanggal_mulai: mulai },
  jenis: { nama: "UANG PANGKAL SD", departemen_id: "SD" },
});
const lama = bill("lama", "2025/2026", "2025-07-01");
const baru = bill("baru", "2026/2027", "2026-07-01");

beforeEach(() => {
  state.openBills = [lama, baru];
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: { id: "transaction", metadata: {} }, error: null });
  db.from.mockImplementation((table: string) => {
    let billId: string | null = null;
    let limited = false;
    const rowsFor = () => {
      if (table === "ortu_siswa") return [{ siswa_id: "student" }];
      if (table === "transaksi_midtrans") return [{ id: "transaction" }];
      if (table !== "tagihan") return [];
      // Validasi satu tagihan memakai eq(id) + limit; pemeriksaan urutan
      // mengambil seluruh tagihan sekali bayar yang masih terbuka.
      if (limited && billId) return [[lama, baru].find((row) => row.id === billId)];
      return state.openBills;
    };
    type Query = {
      select: () => Query;
      eq: (column: string, value: string) => Query;
      in: () => Query;
      is: () => Query;
      limit: () => Query;
      update: () => Query;
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => unknown;
    };
    const q: Query = {
      select: () => q,
      eq: (column: string, value: string) => {
        if (column === "id") billId = value;
        return q;
      },
      in: () => q,
      is: () => q,
      limit: () => {
        limited = true;
        return q;
      },
      update: () => q,
      then: (resolve) => resolve({ data: rowsFor(), error: null }),
    };
    return q;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    token: "fixture-token", redirect_url: "https://app.sandbox.midtrans.com/fixture",
  })));
});
afterEach(() => vi.unstubAllGlobals());

const item = (tagihanId: string, jumlah = NOMINAL) => ({
  tagihan_id: tagihanId,
  siswa_id: "student",
  nama_siswa: "Calon siswa",
  jenis_id: "fee",
  jenis_nama: "UANG PANGKAL SD",
  bulan: 0,
  jumlah,
  departemen_id: "SD",
});

const checkout = (items: ReturnType<typeof item>[]) =>
  buatTransaksiSnap({
    userId: "parent",
    input: {
      items,
      customer: { user_id: "client-supplied-owner", email: "qa@example.invalid", nama: "Orang tua" },
    },
    callbacks: () => ({
      finish: "https://example.invalid/finish",
      unfinish: "https://example.invalid/return",
      error: "https://example.invalid/error",
    }),
  });

describe("checkout orang tua: prasyarat tagihan sekali bayar tahun sebelumnya", () => {
  it("menolak tagihan tahun baru bila tahun lama belum lunas", async () => {
    await expect(checkout([item("baru")])).rejects.toThrow(
      "Selesaikan UANG PANGKAL SD tahun ajaran 2025/2026 terlebih dahulu sebelum membayar tahun ajaran 2026/2027",
    );
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mengarahkan orang tua ke bagian keuangan, bukan menawarkan dispensasi", async () => {
    await expect(checkout([item("baru")])).rejects.toThrow(/hubungi bagian keuangan/i);
    await expect(checkout([item("baru")])).rejects.not.toThrow(/dispensasi/i);
  });

  it("menerima tahun baru bila tahun lama ikut dibayar penuh pada transaksi yang sama", async () => {
    const result = await checkout([item("baru"), item("lama")]);
    expect(result.total_amount).toBe(NOMINAL * 2);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("menolak bila tahun lama hanya dicicil walau ikut dipilih", async () => {
    await expect(checkout([item("baru"), item("lama", 1_000_000)])).rejects.toThrow(
      "Selesaikan UANG PANGKAL SD tahun ajaran 2025/2026",
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("menerima tahun baru bila tahun lama sudah lunas (tidak ada di daftar terbuka)", async () => {
    state.openBills = [baru];
    const result = await checkout([item("baru")]);
    expect(result.total_amount).toBe(NOMINAL);
  });

  it("tahun ajaran tertua selalu boleh dibayar duluan", async () => {
    const result = await checkout([item("lama", 1_000_000)]);
    expect(result.total_amount).toBe(1_000_000);
  });
});
