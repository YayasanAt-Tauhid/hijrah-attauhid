import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn(), placements: [] as ReturnType<typeof placement>[], paid: 0, legacy: false, future: false }));
vi.mock("./supabase", () => ({ createAdminClient: () => db }));
vi.mock("./auth", () => ({ authMiddleware: {}, requireContext: () => ({ userId: "finance" }), requireRole: async () => {} }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const q = { middleware: () => q, inputValidator: () => q, handler: (fn: (args: unknown) => unknown) => (args: unknown) => fn(args) };
  return q;
} }));
import type { RekapTunggakanBatchInput, RekapTunggakanBatchResult } from "./tunggakan";
import { rekapTunggakanBatch } from "./tunggakan";

const placement = (year = "academic2027", id = "7A", dept = "SMP", aktif = true) => ({
  siswa_id: "student", kelas_id: id, tahun_ajaran_id: year, aktif,
  kelas: { nama: id, departemen_id: dept },
});
const report = (extra: Record<string, unknown> = {}) => (rekapTunggakanBatch as unknown as (args: { data: RekapTunggakanBatchInput }) => Promise<RekapTunggakanBatchResult>)({ data: {
  jenis_id: "spp", tahun_ajaran_id: "book2027", bulan_list: [7], per_tanggal: "2027-09-01", ...extra,
} });

beforeEach(() => {
  db.placements = []; db.paid = 0; db.legacy = false; db.future = false;
  db.from.mockImplementation((table: string) => {
    let linked = false;
    const records = () => {
      if (table === "tagihan") return [{ id: "july", siswa_id: "student", bulan: 7, nominal: 500000,
        jatuh_tempo: db.future ? "2027-10-10" : "2027-07-10", tanggal_pengakuan: "2027-07-01",
        tahun_akademik_id: db.legacy ? null : "academic2027", kelas_id: null,
        jenis_pembayaran: { departemen_id: "SMP" } }];
      if (table === "siswa") return [{ id: "student", nama: "Siswa SPMB", nis: "2703001", status: "aktif" }];
      if (table === "siswa_detail") return [{ siswa_id: "student", spmb_siswa_internal: true,
        spmb_status_pendaftaran: "diterima", spmb_tanggal_aktivasi: null, spmb_departemen_tujuan_id: "SMP" }];
      if (table === "kelas_siswa") return db.placements;
      if (table === "tahun_ajaran") return [
        { id: "academic2026", tanggal_mulai: "2026-07-01", tanggal_selesai: "2027-06-30" },
        { id: "academic2027", tanggal_mulai: "2027-07-01", tanggal_selesai: "2028-06-30" },
      ];
      if (table === "pembayaran" && linked && db.paid) return [{ tagihan_id: "july", siswa_id: "student", bulan: 7, jumlah: db.paid }];
      return [];
    };
    const q = { select: () => q, eq: () => q, not: () => q, order: () => q, is: () => q,
      in: (field: string) => { if (field === "tagihan_id") linked = true; return q; },
      range: async () => ({ data: records(), error: null }),
      then: (resolve: (result: { data: unknown[]; error: null }) => unknown) => resolve({ data: records(), error: null }),
    };
    return q;
  });
});

describe("SPP Juli mengikuti penempatan tahun akademik tagihan", () => {
  it("berpindah dari belum ditempatkan ke 7A walau kelas baru ditetapkan September", async () => {
    expect((await report({ tanpa_kelas: true })).rows).toMatchObject([{ kelas: "Belum ditempatkan", total: 500000 }]);
    expect((await report({ kelas_id: "7A" })).rows).toEqual([]);
    db.placements = [placement("academic2026", "6A", "SD"), placement()];
    expect((await report({ kelas_id: "7A" })).rows).toMatchObject([{ kelas: "7A", bulan_tunggak: [7], total: 500000 }]);
    expect((await report({ tanpa_kelas: true })).rows).toEqual([]);
    expect((await report({ kelas_id: "6A" })).rows).toEqual([]);
  });
  it("tidak memakai kelas dari tahun lain meskipun jenjangnya sama", async () => {
    db.placements = [placement("academic2026", "7A")];
    expect((await report({ kelas_id: "7A" })).rows).toEqual([]);
    expect((await report({ tanpa_kelas: true })).rows).toHaveLength(1);
  });
  it("tetap memakai penempatan TA 2027/2028 setelah siswa naik kelas tahun berikutnya", async () => {
    db.placements = [placement("academic2028", "8A"), placement("academic2027", "7A", "SMP", false)];
    expect((await report({ kelas_id: "7A" })).rows).toMatchObject([{ kelas: "7A" }]);
    expect((await report({ kelas_id: "8A" })).rows).toEqual([]);
  });
  it("mengurangi pembayaran sebelum kelas tersedia tanpa bergantung tahun buku penerimaan", async () => {
    db.placements = [placement()]; db.paid = 200000;
    expect((await report({ kelas_id: "7A" })).rows).toMatchObject([{ total: 300000 }]);
    db.paid = 500000;
    expect((await report({ kelas_id: "7A" })).rows).toEqual([]);
  });
  it("tidak menghitung SPP sebelum jatuh tempo", async () => {
    db.placements = [placement()]; db.future = true;
    expect((await report({ kelas_id: "7A" })).rows).toEqual([]);
  });
  it("memetakan tagihan lama tanpa TA eksplisit berdasarkan periode layanan", async () => {
    db.placements = [placement()]; db.legacy = true;
    expect((await report({ kelas_id: "7A" })).rows).toMatchObject([{ kelas: "7A" }]);
  });
});
