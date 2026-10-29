import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { from: vi.fn(), rpc: vi.fn() } }));
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
const otherId = "00000000-0000-4000-8000-000000000002";
const thirdId = "00000000-0000-4000-8000-000000000003";
let role = "admin", active = true;
let allowedDepartments: string[] = [];
let scopeError = false;
let details = [detail];
let detailError: { code: string; message: string } | null = null;
let eventError: { code: string; message: string } | null = null;
let kelasRows: unknown[] = [];
let tingkatRows: unknown[] = [];
let activeClasses: unknown[] = [];
const selects: [string, string][] = [];
const insert = vi.fn();
beforeEach(() => {
  role = "admin"; active = true; detailError = eventError = null; insert.mockReset();
  db.from.mockReset(); db.rpc.mockReset();
  details = [detail]; allowedDepartments = [id]; scopeError = false;
  kelasRows = []; tingkatRows = []; activeClasses = []; selects.length = 0;
  db.rpc.mockImplementation(async (_name: string, args: { _departemen_id: string }) => ({
    data: allowedDepartments.includes(args._departemen_id),
    error: scopeError ? { message: "scope unavailable" } : null,
  }));
  db.from.mockImplementation((table: string) => {
    let records: unknown[] = table === "siswa_detail" ? details
      : table === "departemen" ? [{ id }, { id: otherId }, { id: thirdId }]
      : table === "siswa" ? [{ id, nama: "Calon siswa", nis: null, status: "diterima" }]
      : table === "kelas_siswa" ? activeClasses
      : table === "kelas" ? kelasRows
      : table === "tingkat" ? tingkatRows
      : [];
    const q = {
      select: (columns?: string) => { selects.push([table, String(columns)]); return q; },
      eq: (column: string, value: unknown) => {
        if (column === "aktif") records = records.filter(record => (record as { aktif?: boolean }).aktif === value);
        return q;
      }, not: () => q,
      in: (column: string, values: string[]) => {
        if (column === "spmb_departemen_tujuan_id") {
          records = records.filter(record => values.includes((record as typeof detail).spmb_departemen_tujuan_id));
        }
        return q;
      }, order: () => q, limit: () => q,
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
  it.each(["ortu","siswa","kepala_sekolah","guru"])("menolak role %s sebelum membaca calon siswa", async roleName => {
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
  it("Admin TU membaca hanya pendaftaran lembaga tujuan dalam scope multi-lembaga", async () => {
    role = "admin_tu"; allowedDepartments = [id, otherId];
    details = [detail, { ...detail, id: otherId, spmb_departemen_tujuan_id: otherId },
      { ...detail, id: thirdId, spmb_departemen_tujuan_id: thirdId }];
    const result = await get({ context: { userId: id } }) as { items: { id: string }[] };
    expect(result.items.map(row => row.id).sort()).toEqual([id, otherId]);
    expect(db.rpc).toHaveBeenCalledWith("can_manage_akademik_departemen", { _user_id: id, _departemen_id: otherId });
  });
  it("Admin TU tanpa scope tidak membaca pendaftaran atau transaksi", async () => {
    role = "admin_tu"; allowedDepartments = [];
    expect(await get({ context: { userId: id } })).toMatchObject({ items: [] });
    expect(db.from.mock.calls.map(call => call[0])).toEqual(["users_profile", "departemen"]);
  });
  it("gagal tertutup jika pemeriksaan scope Admin TU error", async () => {
    role = "admin_tu"; scopeError = true;
    await expect(get({ context: { userId: id } })).rejects.toThrow("Forbidden");
    expect(db.from.mock.calls.map(call => call[0])).toEqual(["users_profile", "departemen"]);
  });
  it("Admin TU nonaktif ditolak sebelum membaca data", async () => {
    role = "admin_tu"; active = false;
    await expect(get({ context: { userId: id } })).rejects.toThrow("Forbidden");
    expect(db.from.mock.calls).toEqual([["users_profile"]]);
  });
  it.each(["skema","tindak_lanjut","perpanjangan"])("Admin TU tidak dapat menulis %s meski memanggil server langsung", async jenis => {
    role = "admin_tu";
    const data = jenis === "skema" ? { ...input, jenis, skema: "cicilan" }
      : jenis === "perpanjangan" ? { ...input, jenis, tahap: 1, tenggat: "2026-10-30" } : input;
    await expect(save({ context: { userId: id }, data })).rejects.toThrow("Forbidden");
    expect(insert).not.toHaveBeenCalled();
    expect(db.from.mock.calls).toEqual([["users_profile"]]);
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
describe("identitas pembeda calon siswa", () => {
  const kelasA = "00000000-0000-4000-8000-0000000000a1";
  const kelasB = "00000000-0000-4000-8000-0000000000b1";
  const tingkat7 = "00000000-0000-4000-8000-0000000000c7";
  const tingkat6 = "00000000-0000-4000-8000-0000000000c6";
  type Item = { nama_ayah: string | null; nama_ibu: string | null; kelas_tujuan: string | null; kelas_asal: string | null };
  const first = async () => ((await get({ context: { userId: id } })) as { items: Item[] }).items[0];
  beforeEach(() => {
    kelasRows = [{ id: kelasA, nama: "7A", tingkat_id: tingkat7 }, { id: kelasB, nama: "6B", tingkat_id: tingkat6 }];
    tingkatRows = [{ id: tingkat7, nama: "7" }, { id: tingkat6, nama: "6" }];
  });
  it("meminta nama orang tua dan kelas tujuan dari siswa_detail", async () => {
    await get({ context: { userId: id } });
    const columns = selects.find(([table]) => table === "siswa_detail")?.[1] || "";
    for (const column of ["nama_ayah", "nama_ibu", "spmb_kelas_tujuan_id"]) expect(columns).toContain(column);
  });
  it("mengembalikan nama ayah, ibu, dan kelas tujuan lengkap dengan tingkat", async () => {
    details = [{ ...detail, nama_ayah: "Abdullah", nama_ibu: "Aisyah", spmb_kelas_tujuan_id: kelasA } as typeof detail];
    expect(await first()).toMatchObject({ nama_ayah: "Abdullah", nama_ibu: "Aisyah", kelas_tujuan: "Tingkat 7 · 7A", kelas_asal: null });
  });
  it("memakai null, bukan teks kosong, saat nama orang tua dan kelas belum diisi", async () => {
    details = [{ ...detail, nama_ayah: "  ", nama_ibu: null, spmb_kelas_tujuan_id: null } as typeof detail];
    expect(await first()).toMatchObject({ nama_ayah: null, nama_ibu: null, kelas_tujuan: null, kelas_asal: null });
  });
  it("menampilkan kelas asal hanya untuk siswa internal", async () => {
    activeClasses = [{ siswa_id: id, kelas_id: kelasB, aktif: true }];
    details = [{ ...detail, spmb_siswa_internal: true } as typeof detail];
    expect(await first()).toMatchObject({ kelas_asal: "Tingkat 6 · 6B" });
    details = [{ ...detail, spmb_siswa_internal: false } as typeof detail];
    expect((await first()).kelas_asal).toBeNull();
  });
  it("tidak menampilkan kelas asal dari keanggotaan kelas yang tidak aktif", async () => {
    activeClasses = [{ siswa_id: id, kelas_id: kelasB, aktif: false }];
    details = [{ ...detail, spmb_siswa_internal: true } as typeof detail];
    expect((await first()).kelas_asal).toBeNull();
  });
  it("tidak mengulang kelas asal bila sama dengan kelas tujuan", async () => {
    activeClasses = [{ siswa_id: id, kelas_id: kelasA, aktif: true }];
    details = [{ ...detail, spmb_siswa_internal: true, spmb_kelas_tujuan_id: kelasA } as typeof detail];
    expect(await first()).toMatchObject({ kelas_tujuan: "Tingkat 7 · 7A", kelas_asal: null });
  });
});
