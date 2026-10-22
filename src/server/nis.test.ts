import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn() }));
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
vi.mock("./supabase", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("./auth", () => ({ authMiddleware: {}, requireContext: () => ({ userId: "staff" }), requireAcademicDepartment: mocks.access }));
import { generateNis } from "./nis";
const input = {
  siswa_id: "11111111-1111-4111-8111-111111111111",
  departemen_id: "22222222-2222-4222-8222-222222222222",
  angkatan_id: "33333333-3333-4333-8333-333333333333",
};
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ role: "admin_tu" }); mocks.rpc.mockResolvedValue({ data: "2703001", error: null }); });
it("creates the active-school NIS without a class", async () => {
  expect(await generateNis({ data: input })).toEqual({ success: true, nis: "2703001" });
  expect(mocks.rpc).toHaveBeenCalledWith("akademik_generate_nis_current", {
    p_siswa_id: input.siswa_id, p_departemen_id: input.departemen_id, p_angkatan_id: input.angkatan_id,
  });
});
it("reserves destination NIS via a separate RPC and checks destination scope", async () => {
  await generateNis({ data: { ...input, tujuan: "spmb" } });
  expect(mocks.access).toHaveBeenCalledWith(expect.anything(), "staff", input.departemen_id);
  expect(mocks.rpc).toHaveBeenCalledWith("akademik_generate_nis_spmb", {
    p_siswa_id: input.siswa_id, p_departemen_id: input.departemen_id, p_angkatan_id: input.angkatan_id, p_nis: null,
  });
});
it("passes manual destination NIS to the same atomic routine", async () => {
  await generateNis({ data: { ...input, tujuan: "spmb", nis_manual: "2703001" } });
  expect(mocks.rpc.mock.calls[0][1].p_nis).toBe("2703001");
});
it("refuses out-of-scope staff before changing NIS", async () => {
  mocks.access.mockRejectedValue(new Error("Forbidden"));
  await expect(generateNis({ data: { ...input, tujuan: "spmb" } })).rejects.toThrow("Forbidden");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("passes database validation errors to the user", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "Angkatan tujuan tidak valid" } });
  await expect(generateNis({ data: { ...input, tujuan: "spmb" } })).rejects.toThrow("Angkatan tujuan tidak valid");
});
