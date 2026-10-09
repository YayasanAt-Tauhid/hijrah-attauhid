import { describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  status: "diterima",
  internal: false,
  activeClass: null as null | { siswa_id: string; kelas_id: string; tahun_ajaran_id: string; kelas: { id: string; nama: string; departemen_id: string } },
  activeAt: null as string | null,
}));
const id = "11111111-1111-4111-8111-111111111111";
const targetDept = "22222222-2222-4222-8222-222222222222";
const oldDept = "33333333-3333-4333-8333-333333333333";
const academicYear = "44444444-4444-4444-8444-444444444444";
const classId = "55555555-5555-4555-8555-555555555555";
const db = vi.hoisted(() => ({ from: vi.fn() }));

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
vi.mock("./supabase", () => ({ createAdminClient: () => db }));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "test" }),
  requireRole: async () => {},
}));

import { getSpmbBillingCandidates } from "./spmbBilling";

function records(table: string) {
  switch (table) {
    case "siswa_detail": return [{
      siswa_id: id, tahun_ajaran_id: academicYear,
      spmb_status_kelulusan: "lulus", spmb_status_pendaftaran: "diterima", spmb_departemen_tujuan_id: targetDept,
      spmb_kelas_tujuan_id: null, spmb_siswa_internal: data.internal,
      spmb_tanggal_aktivasi: data.activeAt, spmb_gelombang_id: "wave",
    }];
    case "siswa": return [{ id, nama: "Calon diterima", nis: null, status: data.status, departemen_id: data.internal ? oldDept : targetDept }];
    case "kelas_siswa": return data.activeClass ? [data.activeClass] : [];
    case "rencana_tagihan_siswa": return [];
    case "departemen": return [{ id: targetDept, nama: "SMP", kode: "SMP" }];
    case "tahun_ajaran": return [{ id: academicYear, nama: "2027/2028", tanggal_mulai: "2027-07-01", tanggal_selesai: "2028-06-30" }];
    case "kelas": return [];
    default: return [];
  }
}

describe("penagihan calon siswa lulus sebelum penempatan kelas", () => {
  it("mengizinkan tagihan awal untuk status diterima tanpa kelas dan menunda SPP", async () => {
    data.status = "diterima"; data.internal = false; data.activeClass = null; data.activeAt = null;
    db.from.mockImplementation((table: string) => {
      const q = {
        select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q, in: () => q,
        then: (resolve: (result: unknown) => unknown) => resolve({ data: records(table), error: null }),
      };
      return q;
    });
    const result = await (getSpmbBillingCandidates as any)({});
    expect(result.items[0]).toMatchObject({
      status: "diterima", kelas_id: null, kelas_nama: null,
      ready_for_billing: true, ready_for_spp: false,
      target_departemen_id: targetDept,
    });
  });

  it("tidak memakai kelas lama dari lembaga asal siswa internal", async () => {
    data.status = "aktif"; data.internal = true; data.activeAt = null;
    data.activeClass = { siswa_id: id, kelas_id: classId, tahun_ajaran_id: academicYear, kelas: { id: classId, nama: "6D", departemen_id: oldDept } };
    const result = await (getSpmbBillingCandidates as any)({});
    expect(result.items[0]).toMatchObject({ kelas_id: null, kelas_nama: null, ready_for_billing: true, ready_for_spp: false });
  });

  it("mengizinkan rencana SPP setelah aktivasi dengan kelas tujuan", async () => {
    data.status = "aktif"; data.internal = true; data.activeAt = "2027-07-01T00:00:00Z";
    data.activeClass = { siswa_id: id, kelas_id: classId, tahun_ajaran_id: academicYear, kelas: { id: classId, nama: "7A", departemen_id: targetDept } };
    const result = await (getSpmbBillingCandidates as any)({});
    expect(result.items[0]).toMatchObject({ kelas_id: classId, ready_for_billing: true, ready_for_spp: true });
  });
});
