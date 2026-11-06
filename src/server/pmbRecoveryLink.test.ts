import { beforeEach, describe, expect, it, vi } from "vitest";

// Tautan pemulihan pembayaran SPMB untuk admin/admin TU. Token pendaftaran
// adalah kunci akses ke satu pendaftaran, jadi otorisasi lembaga harus lolos
// sebelum token dikembalikan.
type Row = Record<string, unknown> | null;
const state = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null,
  siswa: null as Record<string, unknown> | null,
  access: vi.fn(),
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
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ url: "https://app.hijrah-attauhid.or.id/akademik/spmb/abc" }),
}));
vi.mock("./supabase", () => {
  const builder = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: (table === "siswa_detail" ? state.detail : state.siswa) as Row, error: null }),
    };
    return q;
  };
  return { createAdminClient: () => ({ from: builder }) };
});
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "staff" }),
  requireAcademicDepartment: state.access,
}));

import { spmbAdminGetRecoveryLink } from "./pmb";

const DETAIL_ID = "11111111-1111-4111-8111-111111111111";
const DEPT_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ role: "admin_tu", departemen_id: DEPT_ID });
  state.detail = {
    id: DETAIL_ID,
    siswa_id: "s1",
    pmb_payment_token: TOKEN,
    spmb_departemen_tujuan_id: DEPT_ID,
    spmb_status_pendaftaran: "calon",
  };
  state.siswa = { departemen_id: "dept-siswa", status: "calon" };
});

describe("spmbAdminGetRecoveryLink", () => {
  it("mengembalikan tautan pemulihan /spmb#registration=<token> untuk staf yang berhak", async () => {
    const result = await spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } });
    expect(result).toEqual({
      success: true,
      url: `https://app.hijrah-attauhid.or.id/spmb#registration=${TOKEN}`,
    });
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", DEPT_ID, ["admin", "admin_tu"]);
  });

  it("menolak staf di luar kewenangan lembaga dan tidak membocorkan token", async () => {
    state.access.mockRejectedValue(new Error("Forbidden: lembaga di luar kewenangan Admin TU"));
    await expect(spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } })).rejects.toThrow("Forbidden");
  });

  it("mengecek kewenangan sebelum membahas status pendaftaran", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: "diterima" };
    state.access.mockRejectedValue(new Error("Forbidden"));
    await expect(spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } })).rejects.toThrow("Forbidden");
  });

  it("hanya untuk pendaftar berstatus calon", async () => {
    state.detail = { ...state.detail, spmb_status_pendaftaran: "diterima" };
    await expect(spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } }))
      .rejects.toThrow("berstatus calon");
  });

  it("galat bila pendaftaran tidak ditemukan dan tidak memeriksa kewenangan", async () => {
    state.detail = null;
    await expect(spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } }))
      .rejects.toThrow("Pendaftaran SPMB tidak ditemukan");
    expect(state.access).not.toHaveBeenCalled();
  });

  it("galat bila pendaftaran belum memiliki token pembayaran", async () => {
    state.detail = { ...state.detail, pmb_payment_token: null };
    await expect(spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } }))
      .rejects.toThrow("belum memiliki token");
  });

  it("memakai lembaga siswa bila lembaga tujuan SPMB kosong", async () => {
    state.detail = { ...state.detail, spmb_departemen_tujuan_id: null };
    await spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } });
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", "dept-siswa", ["admin", "admin_tu"]);
  });

  it("meng-encode token di fragment URL", async () => {
    state.detail = { ...state.detail, pmb_payment_token: "a b" };
    const result = await spmbAdminGetRecoveryLink({ data: { detail_id: DETAIL_ID } });
    expect(result.url).toBe("https://app.hijrah-attauhid.or.id/spmb#registration=a%20b");
  });
});
