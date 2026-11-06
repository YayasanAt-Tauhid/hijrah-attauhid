import { beforeEach, describe, expect, it, vi } from "vitest";

// Hapus siswa: server function memegang otorisasi lembaga; pemeriksaan riwayat dan
// penghapusan dilakukan atomik oleh RPC database `hapus_siswa`.
const state = vi.hoisted(() => ({
  siswa: null as Record<string, unknown> | null,
  access: vi.fn(),
  rpc: vi.fn(),
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
vi.mock("./supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "siswa" ? state.siswa : null, error: null }),
      };
      return q;
    },
    rpc: (...args: unknown[]) => { state.order.push("rpc"); return state.rpc(...args); },
  }),
}));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: () => ({ userId: "staff" }),
  requireAcademicDepartment: (...args: unknown[]) => { state.order.push("access"); return state.access(...args); },
}));

import { hapusSiswa } from "./siswaDeletion";

const SISWA_ID = "22222222-2222-4222-8222-222222222222";
const DEPT_ID = "33333333-3333-4333-8333-333333333333";
const INPUT = { siswa_id: SISWA_ID };

beforeEach(() => {
  vi.clearAllMocks();
  state.order = [];
  state.siswa = { id: SISWA_ID, departemen_id: DEPT_ID, nama: "Budi" };
  state.access.mockResolvedValue({});
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("hapusSiswa (server function)", () => {
  it("memeriksa akses departemen siswa (admin/admin_tu) sebelum memanggil RPC", async () => {
    await hapusSiswa({ data: INPUT });
    expect(state.order).toEqual(["access", "rpc"]);
    expect(state.access).toHaveBeenCalledWith(expect.anything(), "staff", DEPT_ID, ["admin", "admin_tu"]);
  });

  it("memanggil RPC hapus_siswa dengan id siswa dan id pelaku", async () => {
    await hapusSiswa({ data: INPUT });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("hapus_siswa", { p_siswa_id: SISWA_ID, p_actor_id: "staff" });
  });

  it("mengembalikan { ok: true } bila siswa terhapus", async () => {
    await expect(hapusSiswa({ data: INPUT })).resolves.toEqual({ ok: true });
  });

  it("mengembalikan daftar riwayat (bukan melempar galat) bila siswa punya riwayat", async () => {
    state.rpc.mockResolvedValue({
      data: {
        ok: false,
        alasan: "punya_riwayat",
        riwayat: [
          { tabel: "pembayaran", jumlah: 2 },
          { tabel: "tagihan", jumlah: 3 },
        ],
      },
      error: null,
    });
    await expect(hapusSiswa({ data: INPUT })).resolves.toEqual({
      ok: false,
      alasan: "punya_riwayat",
      riwayat: [
        { tabel: "tagihan", jumlah: 3 },
        { tabel: "pembayaran", jumlah: 2 },
      ],
    });
  });

  it("menolak tanpa memanggil RPC bila akses departemen ditolak", async () => {
    state.access.mockRejectedValue(new Error("Akses ditolak"));
    await expect(hapusSiswa({ data: INPUT })).rejects.toThrow("Akses ditolak");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("melaporkan siswa tidak ditemukan tanpa memeriksa akses maupun memanggil RPC", async () => {
    state.siswa = null;
    await expect(hapusSiswa({ data: INPUT })).rejects.toThrow("Siswa tidak ditemukan");
    expect(state.access).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("menolak id siswa tidak valid (%j) sebelum menyentuh database", async (id) => {
    await expect(hapusSiswa({ data: { siswa_id: id } })).rejects.toThrow("Data siswa tidak valid");
    expect(state.access).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("meneruskan galat RPC", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "koneksi putus" } });
    await expect(hapusSiswa({ data: INPUT })).rejects.toThrow("koneksi putus");
  });

  it("menjelaskan dengan ramah bila database menolak karena foreign key (balapan antar pengguna)", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23503",
        message: 'update or delete on table "siswa" violates foreign key constraint "pembayaran_siswa_id_fkey"',
      },
    });
    await expect(hapusSiswa({ data: INPUT })).rejects.toThrow("Siswa ini punya riwayat data sehingga tidak dapat dihapus");
  });

  it("melaporkan bila pemeriksaan ulang peran di database menolak pelaku", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, alasan: "tidak_berwenang" }, error: null });
    await expect(hapusSiswa({ data: INPUT })).rejects.toThrow("Anda tidak berwenang menghapus siswa ini");
  });
});
