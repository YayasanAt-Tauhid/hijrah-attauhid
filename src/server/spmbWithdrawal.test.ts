import { beforeEach, describe, expect, it, vi } from "vitest";

// Pengunduran diri pendaftar SPMB (calon/diterima). Server function memegang
// otorisasi lembaga; perubahan data dilakukan atomik oleh RPC database.
type Row = Record<string, unknown> | null;
const state = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null,
  siswa: null as Record<string, unknown> | null,
  items: [] as Array<Record<string, unknown>>,
  access: vi.fn(),
  rpc: vi.fn(),
  closeSession: vi.fn(),
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
      maybeSingle: async () => ({
        data: (table === "siswa_detail" ? state.detail : state.siswa) as Row,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: state.items, error: null }),
    };
    return q;
  };
  return {
    createAdminClient: () => ({
      from: builder,
      rpc: (...args: unknown[]) => { state.order.push("rpc"); return state.rpc(...args); },
    }),
  };
});
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "staff" }),
  requireAcademicDepartment: (...args: unknown[]) => { state.order.push("access"); return state.access(...args); },
}));
vi.mock("./midtransSessions", () => ({
  closeStoredSession: (...args: unknown[]) => { state.order.push("close"); return state.closeSession(...args); },
}));

import { spmbWithdrawRegistration } from "./spmbWithdrawal";

const DETAIL_ID = "11111111-1111-4111-8111-111111111111";
const SISWA_ID = "22222222-2222-4222-8222-222222222222";
const DEPT_ID = "33333333-3333-4333-8333-333333333333";
const INPUT = { detail_id: DETAIL_ID, alasan: "Orang tua memilih sekolah lain", tanggal_efektif: "2026-11-04" };
const RPC_RESULT = {
  tagihan_dibatalkan: 3,
  total_dibayar: 500000,
  rincian_dibayar: [{ jenis: "Biaya Pendaftaran", jumlah: 500000 }],
  perlu_tindak_lanjut_keuangan: true,
  siswa_internal: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.order = [];
  state.items = [];
  state.access.mockResolvedValue({ role: "admin_tu", departemen_id: DEPT_ID });
  state.rpc.mockResolvedValue({ data: RPC_RESULT, error: null });
  state.closeSession.mockResolvedValue(undefined);
  state.detail = {
    id: DETAIL_ID,
    siswa_id: SISWA_ID,
    spmb_departemen_tujuan_id: DEPT_ID,
    spmb_status_pendaftaran: "diterima",
    spmb_tanggal_aktivasi: null,
  };
  state.siswa = { departemen_id: "dept-siswa", status: "diterima" };
});

describe("spmbWithdrawRegistration", () => {
  it("memanggil RPC atomik dengan data yang sudah dibersihkan dan meneruskan ringkasan pembayaran", async () => {
    const result = await spmbWithdrawRegistration({ data: { ...INPUT, alasan: "  Orang tua memilih sekolah lain  " } });
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", DEPT_ID, ["admin", "admin_tu"]);
    expect(state.rpc).toHaveBeenCalledWith("spmb_withdraw_registration", {
      p_siswa_id: SISWA_ID,
      p_alasan: "Orang tua memilih sekolah lain",
      p_tanggal_efektif: "2026-11-04",
      p_actor_id: "staff",
    });
    expect(result).toEqual({ success: true, ...RPC_RESULT, peringatan: [] });
  });

  it("menolak staf di luar kewenangan lembaga tanpa mengubah data", async () => {
    state.access.mockRejectedValue(new Error("Forbidden: lembaga di luar kewenangan Admin TU"));
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("Forbidden");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.closeSession).not.toHaveBeenCalled();
  });

  it("mengecek kewenangan lebih dulu sebelum membahas status pendaftaran", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: "aktif" };
    state.access.mockRejectedValue(new Error("Forbidden"));
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("Forbidden");
  });

  it("hanya untuk calon atau diterima dan mengarahkan murid aktif ke Pindah Keluar", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: "aktif" };
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("Pindah Keluar");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("menolak pendaftar yang sudah diaktivasi walau statusnya masih diterima", async () => {
    state.detail = { ...state.detail, spmb_tanggal_aktivasi: "2026-07-01T00:00:00Z" };
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("Pindah Keluar");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("menolak pendaftar yang sudah mengundurkan diri (tidak dua kali)", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: "mengundurkan_diri" };
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("calon atau diterima");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("memakai status siswa bila status pendaftaran kosong", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: null };
    state.siswa = { departemen_id: "dept-siswa", status: "calon" };
    await spmbWithdrawRegistration({ data: INPUT });
    expect(state.rpc).toHaveBeenCalled();
  });

  it("memakai lembaga siswa bila lembaga tujuan SPMB kosong", async () => {
    state.detail = { ...state.detail, spmb_departemen_tujuan_id: null };
    await spmbWithdrawRegistration({ data: INPUT });
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", "dept-siswa", ["admin", "admin_tu"]);
  });

  it("mewajibkan alasan minimal 5 karakter sebelum menyentuh database", async () => {
    await expect(spmbWithdrawRegistration({ data: { ...INPUT, alasan: "  ok " } })).rejects.toThrow("Alasan");
    expect(state.access).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("menolak tanggal efektif yang bukan tanggal valid", async () => {
    await expect(spmbWithdrawRegistration({ data: { ...INPUT, tanggal_efektif: "04/11/2026" } })).rejects.toThrow("Tanggal");
    await expect(spmbWithdrawRegistration({ data: { ...INPUT, tanggal_efektif: "2026-02-31" } })).rejects.toThrow("Tanggal");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("galat bila pendaftaran tidak ditemukan dan tidak memeriksa kewenangan", async () => {
    state.detail = null;
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("Pendaftaran SPMB tidak ditemukan");
    expect(state.access).not.toHaveBeenCalled();
  });

  it("menolak selama pembayaran online sudah berhasil tetapi belum tercatat", async () => {
    state.items = [{ pembayaran_id: null, transaksi: { id: "t1", status: "paid", gateway_closed_at: null } }];
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("sedang dicatat");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("menutup sesi pembayaran online yang masih terbuka SEBELUM mengubah data", async () => {
    state.items = [
      { pembayaran_id: null, transaksi: { id: "t1", status: "pending", snap_token: "x", gateway_closed_at: null } },
      { pembayaran_id: null, transaksi: { id: "t1", status: "pending", snap_token: "x", gateway_closed_at: null } },
      { pembayaran_id: "p1", transaksi: { id: "t2", status: "paid", gateway_closed_at: null } },
      { pembayaran_id: null, transaksi: { id: "t3", status: "expired", snap_token: "y", gateway_closed_at: "2026-11-01T00:00:00Z" } },
    ];
    await spmbWithdrawRegistration({ data: INPUT });
    expect(state.closeSession).toHaveBeenCalledTimes(1);
    expect(state.closeSession).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "pendaftar_mengundurkan_diri");
    expect(state.order.indexOf("close")).toBeLessThan(state.order.indexOf("rpc"));
  });

  it("tetap memproses pengunduran diri bila penutupan sesi gagal, dengan peringatan", async () => {
    state.items = [{ pembayaran_id: null, transaksi: { id: "t1", status: "pending", snap_token: "x", gateway_closed_at: null } }];
    state.closeSession.mockRejectedValue(new Error("Midtrans timeout"));
    const result = await spmbWithdrawRegistration({ data: INPUT });
    expect(state.rpc).toHaveBeenCalled();
    expect(result.peringatan).toHaveLength(1);
    expect(result.peringatan[0]).toContain("Midtrans timeout");
  });

  it("meneruskan galat RPC (mis. periode sudah tutup buku) apa adanya", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'Transaksi ditolak: periode "2026" sudah ditutup buku.' } });
    await expect(spmbWithdrawRegistration({ data: INPUT })).rejects.toThrow("ditutup buku");
  });
});
