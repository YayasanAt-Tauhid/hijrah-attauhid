import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cariSiswaTervalidasi } from "./portalChildIdentity";
const eq = vi.fn();
const maybeSingle = vi.fn();
const query = { select: vi.fn(), eq, maybeSingle };
const db = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
const child = { id: "child", nama: "Abdullah Hamiza Kamil", nis: null };
const input = { nis: "3147793996", jenis_identitas: "nisn" as const, nama: child.nama, tanggal_lahir: "2014-07-15" };
beforeEach(() => {
  vi.clearAllMocks();
  query.select.mockReturnValue(query); eq.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: child, error: null });
});
it("links a child without NIS using exact NISN plus full name and birth date", async () => {
  expect(await cariSiswaTervalidasi(db, input)).toEqual(child);
  expect(eq.mock.calls).toEqual([["nisn", "3147793996"], ["tanggal_lahir", "2014-07-15"]]);
});
it("preserves leading zeros in NISN", async () => {
  await cariSiswaTervalidasi(db, { ...input, nis: "0012345678" });
  expect(eq).toHaveBeenCalledWith("nisn", "0012345678");
});
it("keeps old clients using NIS and normalizes old hyphens", async () => {
  await cariSiswaTervalidasi(db, { ...input, jenis_identitas: undefined, nis: "27-03-001" });
  expect(eq).toHaveBeenCalledWith("nis", "2703001");
});
it.each(["314779399", "31477939960", "31477-3996"])("rejects invalid NISN %s before querying", async nis => {
  await expect(cariSiswaTervalidasi(db, { ...input, nis })).rejects.toThrow("Data siswa tidak ditemukan");
  expect(eq).not.toHaveBeenCalled();
});
it("does not disclose which identity field failed", async () => {
  await expect(cariSiswaTervalidasi(db, { ...input, nama: "Nama Salah" })).rejects.toThrow("Data siswa tidak ditemukan");
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(cariSiswaTervalidasi(db, input)).rejects.toThrow("Data siswa tidak ditemukan");
});
it("fails closed on duplicate NISN or query errors", async () => {
  maybeSingle.mockResolvedValue({ data: child, error: { message: "multiple rows" } });
  await expect(cariSiswaTervalidasi(db, input)).rejects.toThrow("Data siswa tidak ditemukan");
});
it("does not accept arbitrary filter column names", async () => {
  await expect(cariSiswaTervalidasi(db, { ...input, jenis_identitas: "id" as "nisn" })).rejects.toThrow("Data siswa tidak ditemukan");
  expect(eq).not.toHaveBeenCalled();
});

const idSantri = "23.01.007";
const idSantriInput = { ...input, jenis_identitas: "id_santri" as const, nis: idSantri };
it("links a child by ID Santri plus full name and birth date", async () => {
  expect(await cariSiswaTervalidasi(db, idSantriInput)).toEqual(child);
  expect(eq.mock.calls).toEqual([["id_santri_pihak3", idSantri], ["tanggal_lahir", "2014-07-15"]]);
});
it("trims whitespace around the ID Santri but keeps its dots", async () => {
  await cariSiswaTervalidasi(db, { ...idSantriInput, nis: `  ${idSantri} ` });
  expect(eq).toHaveBeenCalledWith("id_santri_pihak3", idSantri);
});
it.each(["23.01", "2301007", "23-01-007", "AB.01.007", "23.01.07", "23.01.007.1x", "23.01.007; drop table siswa"])(
  "rejects malformed ID Santri %s before querying", async nis => {
    await expect(cariSiswaTervalidasi(db, { ...idSantriInput, nis })).rejects.toThrow("Data siswa tidak ditemukan");
    expect(eq).not.toHaveBeenCalled();
  });
it("does not disclose which identity field failed for ID Santri", async () => {
  await expect(cariSiswaTervalidasi(db, { ...idSantriInput, nama: "Nama Salah" })).rejects.toThrow("Data siswa tidak ditemukan");
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(cariSiswaTervalidasi(db, idSantriInput)).rejects.toThrow("Data siswa tidak ditemukan");
});
it("fails closed on duplicate ID Santri or query errors", async () => {
  maybeSingle.mockResolvedValue({ data: child, error: { message: "multiple rows" } });
  await expect(cariSiswaTervalidasi(db, idSantriInput)).rejects.toThrow("Data siswa tidak ditemukan");
});
it("mentions ID Santri in the generic failure message", async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(cariSiswaTervalidasi(db, idSantriInput)).rejects.toThrow("NIS/NISN/ID Santri");
});
