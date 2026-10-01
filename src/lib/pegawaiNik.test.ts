import { describe, expect, it, vi } from "vitest";
import { normalizePegawaiNik, maskPegawaiNik, validatePegawaiNik, validateImportNiks, savePegawaiWithNik } from "./pegawaiNik";

// Synthetic fixtures only; never use identity data from production.
const nikA = "1".repeat(16);
const nikB = "2".repeat(16);

describe("validasi NIK pegawai", () => {
  it("membersihkan spasi dan titik tanpa mengubah digit", () => {
    expect(normalizePegawaiNik(" 1111.1111 1111.1111 ")).toBe(nikA);
  });
  it("kosong berarti tidak mengubah NIK", () => {
    expect(validatePegawaiNik("")).toEqual({ nik: "", error: undefined });
  });
  it.each(["1".repeat(15), "1".repeat(17), "1".repeat(15) + "a", "1".repeat(8) + "-" + "1".repeat(8), "1e15"])("menolak format tidak valid", (value) => {
    expect(validatePegawaiNik(value).error).toBeTruthy();
  });
  it("menolak sel numerik Excel karena presisi identitas bisa hilang", () => {
    expect(validatePegawaiNik(Number(nikA)).error).toContain("teks");
  });
  it("daftar hanya menampilkan empat digit terakhir", () => {
    expect(maskPegawaiNik(nikA)).toBe("•••• •••• •••• 1111");
    expect(maskPegawaiNik("")).toBe("—");
  });
});

describe("validasi NIK import per baris", () => {
  it("semua baris duplikat ditandai; baris valid lain tetap lolos", () => {
    const rows = validateImportNiks([{ nik: nikA }, { nik: nikA }, { nik: nikB }, { nik: "123" }], []);
    expect(rows.map(r => Boolean(r.error))).toEqual([true, true, false, true]);
  });
  it("mendeteksi NIK milik pegawai lain dan mengizinkan milik pegawai sendiri", () => {
    const rows = validateImportNiks([{ nik: nikA, existingId: "other" }, { nik: nikB, existingId: "owner" }], [
      { nik: nikA, pegawai_id: "first" }, { nik: nikB, pegawai_id: "owner" },
    ]);
    expect(rows[0].error).toBeTruthy();
    expect(rows[1].error).toBeUndefined();
  });
  it("format bertitik ikut deteksi duplikat", () => {
    expect(validateImportNiks([{ nik: nikA }, { nik: "1111.1111.1111.1111" }], []).every(r => r.error)).toBe(true);
  });
  it("sel kosong tidak menghapus dan tidak dihitung duplikat", () => {
    expect(validateImportNiks([{ nik: "" }, { nik: null }], []).every(r => !r.error)).toBe(true);
  });
});

describe("penyimpanan pegawai dan NIK", () => {
  it("retry setelah gagal NIK menggunakan ID tersimpan, tidak insert ulang", async () => {
    let persistedId: string | undefined;
    const writeEmployee = vi.fn(async (id?: string) => id || "created");
    const writeNik = vi.fn().mockRejectedValueOnce(new Error("gagal")).mockResolvedValue(undefined);
    const callbacks = { writeEmployee, writeNik, onEmployeeSaved: (id: string) => { persistedId = id; } };
    await expect(savePegawaiWithNik(undefined, nikA, callbacks)).rejects.toThrow("Data pegawai tersimpan");
    expect(persistedId).toBe("created");
    await savePegawaiWithNik(persistedId, nikA, callbacks);
    expect(writeEmployee.mock.calls).toEqual([[undefined], ["created"]]);
  });
  it("NIK kosong tidak memanggil penulisan NIK", async () => {
    const writeNik = vi.fn();
    await savePegawaiWithNik("id", "", { writeEmployee: async () => "id", writeNik, onEmployeeSaved: vi.fn() });
    expect(writeNik).not.toHaveBeenCalled();
  });
  it("kegagalan pegawai tidak melanjutkan penulisan NIK", async () => {
    const writeNik = vi.fn();
    await expect(savePegawaiWithNik(undefined, nikA, { writeEmployee: async () => { throw new Error("profil gagal"); }, writeNik, onEmployeeSaved: vi.fn() })).rejects.toThrow("profil gagal");
    expect(writeNik).not.toHaveBeenCalled();
  });
});
