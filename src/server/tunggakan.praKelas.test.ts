import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), passed: true }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      middleware: () => chain, inputValidator: () => chain,
      handler: (fn: (args: any) => unknown) => (args: any) => fn(args),
    };
    return chain;
  },
}));
vi.mock("./supabase", () => ({ createAdminClient: () => db }));
vi.mock("./auth", () => ({
  authMiddleware: {}, requireContext: () => ({ userId: "staff" }),
  requireRole: async () => {}, ForbiddenError: class extends Error {},
}));

import { rekapTunggakanBatch } from "./tunggakan";

function rows(table: string): any[] {
  if (table === "tagihan") return [{ id: "bill", siswa_id: "student", bulan: null, nominal: 3000000, jatuh_tempo: "2026-09-01" }];
  if (table === "siswa") return [{ id: "student", nama: "Calon diterima", nis: null, status: "diterima" }];
  if (table === "siswa_detail") return db.passed ? [{ siswa_id: "student" }] : [];
  return [];
}
db.from.mockImplementation((table: string) => {
  const q = {
    select: () => q, eq: () => q, not: () => q, order: () => q, in: () => q,
    range: async () => ({ data: rows(table), error: null }),
    then: (resolve: (result: unknown) => unknown) => resolve({ data: rows(table), error: null }),
  };
  return q;
});
const run = (data: any) => (rekapTunggakanBatch as any)({ data });

describe("tunggakan calon diterima tanpa kelas", () => {
  it("menampilkan tunggakan berdasarkan tagihan meskipun kelas_siswa kosong", async () => {
    db.passed = true;
    const result = await run({ jenis_id: "fee", tahun_ajaran_id: "book", per_tanggal: "2026-10-09", tanpa_kelas: true });
    expect(result.rows).toMatchObject([{ siswa_id: "student", kelas: "Belum ditempatkan", total: 3000000 }]);
  });
  it("tidak memasukkan calon yang belum lulus", async () => {
    db.passed = false;
    const result = await run({ jenis_id: "fee", tahun_ajaran_id: "book", per_tanggal: "2026-10-09" });
    expect(result.rows).toEqual([]);
  });
  it("menolak filter kelas dan tanpa kelas pada waktu bersamaan", async () => {
    await expect(run({ jenis_id: "fee", tahun_ajaran_id: "book", kelas_id: "class", tanpa_kelas: true })).rejects.toThrow("Filter kelas tidak valid");
  });
});
