import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { from: vi.fn() } }));
vi.mock("./supabase", () => ({ createAdminClient: () => db }));
vi.mock("./auth", () => ({
  authMiddleware: {},
  requireContext: (context: { userId: string } | undefined) => {
    if (!context?.userId) throw new Error("Unauthorized"); return context;
  },
  ForbiddenError: class extends Error { constructor() { super("Forbidden"); } },
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator = (data: unknown) => data;
    const chain = {
      middleware: () => chain,
      inputValidator: (fn: typeof validator) => { validator = fn; return chain; },
      handler: (fn: (args: unknown) => unknown) => (args: { data?: unknown }) => fn({ ...args, data: validator(args.data) }),
    };
    return chain;
  },
}));
import { getSpmbPaymentMonitor, saveSpmbMonitorEvent, monitorEventSchema } from "./spmbPaymentMonitor";
const id = "00000000-0000-4000-8000-000000000001";
const detail = {
  id, siswa_id: id, tahun_ajaran_id: id, spmb_departemen_tujuan_id: id,
  spmb_gelombang_id: id, spmb_registered_at: "2026-09-25T00:00:00+00:00",
  spmb_tanggal_lulus: "2026-10-01T00:00:00+00:00", spmb_status_kelulusan: "lulus",
};
const input = {
  detail_id: id, tahun_ajaran_id: id, departemen_id: id, gelombang_id: id,
  registered_at: detail.spmb_registered_at, jenis: "tindak_lanjut", catatan: "Orang tua dihubungi",
};
type Handler = (args: { context?: { userId: string }; data?: unknown }) => Promise<unknown>;
const get = getSpmbPaymentMonitor as unknown as Handler;
const save = saveSpmbMonitorEvent as unknown as Handler;
let role = "admin", active = true;
let detailError: { code: string; message: string } | null = null;
let eventError: { code: string; message: string } | null = null;
const insert = vi.fn();
beforeEach(() => {
  role = "admin"; active = true; detailError = eventError = null; insert.mockReset();
  db.from.mockReset();
  db.from.mockImplementation((table: string) => {
    const records = table === "siswa_detail" ? [detail]
      : table === "siswa" ? [{ id, nama: "Calon siswa", nis: null, status: "diterima" }]
      : [];
    const q = {
      select: () => q, eq: () => q, not: () => q, in: () => q, order: () => q, limit: () => q,
      single: async () => table === "users_profile"
        ? { data: { role, aktif: active }, error: null } : { data: detail, error: detailError },
      range: async () => ({ data: records, error: table === "siswa_detail" ? detailError : null }),
      insert: async (data: unknown) => { insert(data); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: table === "spmb_payment_monitor_events" ? eventError : null }),
    };
    return q;
  });
});
describe("otorisasi dan data monitoring SPMB", () => {
  it("menolak sesi kosong sebelum mengakses database", async () => {
    await expect(get({})).rejects.toThrow("Unauthorized");
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(["ortu","siswa","admin_tu","kepala_sekolah","guru"])("menolak role %s sebelum membaca calon siswa", async roleName => {
    role = roleName;
    await expect(get({ context: { userId: id } })).rejects.toThrow("Forbidden");
    expect(db.from.mock.calls).toEqual([["users_profile"]]);
  });
  it("menolak pengguna keuangan nonaktif", async () => {
    role = "keuangan"; active = false;
    await expect(get({ context: { userId: id } })).rejects.toThrow("Forbidden");
    expect(db.from.mock.calls).toEqual([["users_profile"]]);
  });
  it.each(["admin","keuangan","kasir"])("mengizinkan role %s membaca monitoring", async roleName => {
    role = roleName;
    expect(await get({ context: { userId: id } })).toMatchObject({ items: [{ nama: "Calon siswa" }] });
  });
  it("tidak mengubah kegagalan baca data menjadi laporan kosong", async () => {
    detailError = { code: "42501", message: "read denied" };
    await expect(get({ context: { userId: id } })).rejects.toThrow("read denied");
  });
  it("mendeteksi migration belum tersedia tanpa menganggap skema sudah dicatat", async () => {
    eventError = { code: "PGRST205", message: "table missing" };
    expect(await get({ context: { userId: id } })).toMatchObject({ historyAvailable: false, items: [{ skema: null }] });
  });
  it("error riwayat selain migration hilang tetap ditampilkan", async () => {
    eventError = { code: "XX000", message: "database unavailable" };
    await expect(get({ context: { userId: id } })).rejects.toThrow("database unavailable");
  });
  it("kasir dapat mencatat tindak lanjut", async () => {
    role = "kasir";
    await save({ context: { userId: id }, data: input });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ jenis: "tindak_lanjut", created_by: id }));
  });
  it.each(["skema","perpanjangan"])("kasir tidak dapat menetapkan %s", async jenis => {
    role = "kasir";
    const data = jenis === "skema" ? { ...input, jenis, skema: "cicilan" }
      : { ...input, jenis, tahap: 1, tenggat: "2026-10-30" };
    await expect(save({ context: { userId: id }, data })).rejects.toThrow("Forbidden");
    expect(insert).not.toHaveBeenCalled();
  });
  it("menolak penyimpanan jika siklus pendaftaran sudah berubah", async () => {
    await expect(save({ context: { userId: id }, data: { ...input, tahun_ajaran_id: "00000000-0000-4000-8000-000000000002" } })).rejects.toThrow("Pendaftaran telah berubah");
    expect(insert).not.toHaveBeenCalled();
  });
  it("menolak tanggal kalender tidak valid, metadata tambahan pada catatan dan skema kosong", () => {
    expect(monitorEventSchema.safeParse({ ...input, jenis: "perpanjangan", tahap: 1, tenggat: "2026-02-30" }).success).toBe(false);
    expect(monitorEventSchema.safeParse({ ...input, skema: "lunas" }).success).toBe(false);
    expect(monitorEventSchema.safeParse({ ...input, jenis: "skema" }).success).toBe(false);
  });
  it("skema disimpan sebagai baris riwayat baru dengan identitas siklus dari server", async () => {
    await save({ context: { userId: id }, data: { ...input, jenis: "skema", skema: "cicilan" } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      jenis: "skema", skema: "cicilan", siswa_detail_id: id,
      tahun_ajaran_id: id, departemen_id: id, gelombang_id: id, created_by: id,
    }));
  });
});
