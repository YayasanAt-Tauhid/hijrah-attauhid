import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("./supabase", () => ({ createAdminClient: () => db }));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "finance" }),
  requireRole: async () => {},
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: (fn: (args: any) => unknown) => (args: any) => fn(args),
    };
    return chain;
  },
}));
import { rekapTunggakan } from "./tunggakan";

describe("tunggakan per siswa lintas Tahun Buku", () => {
  it("menghitung pembayaran yang ditautkan ke tagihan 2027 meski dibayar pada 2026", async () => {
    db.from.mockImplementation((table: string) => {
      const result = table === "users_profile"
        ? { data: { role: "keuangan" }, error: null }
        : table === "tagihan"
          ? { data: [{
              id: "bill-2027", siswa_id: "student", jenis_id: "fee", tahun_ajaran_id: "book2027",
              bulan: null, nominal: 3_000_000, jatuh_tempo: "2026-09-01",
              status: "sebagian", jenis: { nama: "UANG PANGKAL SD", tipe: "sekali" },
            }], error: null }
          : { data: [{
              tagihan_id: "bill-2027", siswa_id: "student", jenis_id: "fee",
              bulan: null, tahun_ajaran_id: "book2026", jumlah: 1_000_000,
            }], error: null };
      const q = {
        select: () => q, eq: () => q, not: () => q,
        single: async () => result,
        then: (resolve: (value: unknown) => unknown) => resolve(result),
      };
      return q;
    });
    const result = await (rekapTunggakan as any)({
      data: { siswa_id: "student", tahun_ajaran_id: "book2027", per_tanggal: "2026-10-09" },
    });
    expect(result.total).toBe(2_000_000);
    expect(result.tunggakan).toMatchObject([{
      tagihan_id: "bill-2027", nominal: 3_000_000, terbayar: 1_000_000, sisa: 2_000_000,
    }]);
  });
});
