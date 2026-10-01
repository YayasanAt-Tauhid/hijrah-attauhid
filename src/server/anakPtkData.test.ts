import { describe, expect, it, vi } from "vitest";
import { loadAnakPtkData, readAllRows } from "./anakPtkData";

describe("akses data kandidat anak PTK", () => {
  it.each(["guru", "keuangan", "admin_tu", "siswa"])("menolak role %s sebelum membaca identitas", async (role) => {
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role, aktif: true }, error: null }) }) }) }));
    await expect(loadAnakPtkData({ from } as never, "user", {})).rejects.toThrow("Akses hanya untuk admin aktif");
    expect(from.mock.calls).toHaveLength(1);
    expect(from.mock.calls[0][0]).toBe("users_profile");
  });
  it("menolak admin nonaktif dan gagal baca profil", async () => {
    const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "admin", aktif: false }, error: null }) }) }) }));
    await expect(loadAnakPtkData({ from } as never, "user", {})).rejects.toThrow("Akses hanya untuk admin aktif");
  });
  it("pagination mengambil semua baris, termasuk lewat batas 1000", async () => {
    const records = Array.from({ length: 1078 }, (_, id) => ({ id }));
    const rows = await readAllRows<{ id: number }>(async (from, to) => ({ data: records.slice(from, to + 1), error: null }));
    expect(rows).toHaveLength(1078);
  });
  it("gagal satu halaman tidak menghasilkan laporan sebagian", async () => {
    await expect(readAllRows(async () => ({ data: [], error: { message: "fixture" } }))).rejects.toThrow("Gagal membaca");
  });
});
