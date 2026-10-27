import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPMB_ADMIN_DRAFT_TTL_MS,
  clearAllSpmbAdminDrafts,
  clearSpmbAdminDraft,
  isSpmbAdminFormDirty,
  loadSpmbAdminDraft,
  restoreSpmbAdminForm,
  saveSpmbAdminDraft,
  spmbAdminDraftKey,
} from "./spmbAdminDraft";

const baseline = { nama: "", telepon: "", kategori: "MURID BARU", tahun_ajaran_id: "", angkatan_id: "" };
const NOW = 1_800_000_000_000;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("draf pendaftaran SPMB admin (localStorage)", () => {
  it("menyimpan lalu memuat draf milik akun yang sama", () => {
    expect(saveSpmbAdminDraft("u1", { ...baseline, nama: "Aisyah" }, NOW)).toBe(true);
    const draft = loadSpmbAdminDraft("u1", NOW + 1000);
    expect(draft?.form.nama).toBe("Aisyah");
    expect(draft?.savedAt).toBe(NOW);
  });

  it("tidak menyimpan tahun ajaran dan angkatan karena dihitung ulang dari konfigurasi", () => {
    saveSpmbAdminDraft("u1", { ...baseline, nama: "Aisyah", tahun_ajaran_id: "th-1", angkatan_id: "ang-1" }, NOW);
    const raw = JSON.parse(localStorage.getItem(spmbAdminDraftKey("u1"))!);
    expect(raw.form).not.toHaveProperty("tahun_ajaran_id");
    expect(raw.form).not.toHaveProperty("angkatan_id");
  });

  it("memisahkan draf antar akun admin", () => {
    saveSpmbAdminDraft("u1", { ...baseline, nama: "Milik u1" }, NOW);
    expect(loadSpmbAdminDraft("u2", NOW)).toBeNull();
    expect(loadSpmbAdminDraft(null, NOW)).toBeNull();
    expect(saveSpmbAdminDraft(null, { ...baseline, nama: "x" }, NOW)).toBe(false);
  });

  it("kedaluwarsa setelah 24 jam dan dihapus dari penyimpanan", () => {
    saveSpmbAdminDraft("u1", { ...baseline, nama: "Aisyah" }, NOW);
    expect(loadSpmbAdminDraft("u1", NOW + SPMB_ADMIN_DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(loadSpmbAdminDraft("u1", NOW + SPMB_ADMIN_DRAFT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(spmbAdminDraftKey("u1"))).toBeNull();
  });

  it("mengabaikan draf rusak tanpa error", () => {
    localStorage.setItem(spmbAdminDraftKey("u1"), "{bukan json");
    expect(loadSpmbAdminDraft("u1", NOW)).toBeNull();
    localStorage.setItem(spmbAdminDraftKey("u1"), JSON.stringify({ savedAt: NOW, form: "salah" }));
    expect(loadSpmbAdminDraft("u1", NOW)).toBeNull();
  });

  it("clear menghapus draf satu akun; clearAll hanya menghapus kunci draf SPMB", () => {
    saveSpmbAdminDraft("u1", { ...baseline, nama: "A" }, NOW);
    saveSpmbAdminDraft("u2", { ...baseline, nama: "B" }, NOW);
    localStorage.setItem("kunci-lain", "tetap");
    clearSpmbAdminDraft("u1");
    expect(loadSpmbAdminDraft("u1", NOW)).toBeNull();
    expect(loadSpmbAdminDraft("u2", NOW)).not.toBeNull();
    clearAllSpmbAdminDrafts();
    expect(loadSpmbAdminDraft("u2", NOW)).toBeNull();
    expect(localStorage.getItem("kunci-lain")).toBe("tetap");
  });

  it("tidak melempar error bila localStorage menolak menulis (penuh / mode privat)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(saveSpmbAdminDraft("u1", { ...baseline, nama: "A" }, NOW)).toBe(false);
  });

  it("mendeteksi form terisi dengan mengabaikan isian otomatis tahun ajaran dan angkatan", () => {
    expect(isSpmbAdminFormDirty(baseline, baseline)).toBe(false);
    expect(isSpmbAdminFormDirty({ ...baseline, tahun_ajaran_id: "th-1", angkatan_id: "ang-1" }, baseline)).toBe(false);
    expect(isSpmbAdminFormDirty({ ...baseline, nama: "A" }, baseline)).toBe(true);
    expect(isSpmbAdminFormDirty({ ...baseline, kategori: "MURID PINDAHAN" }, baseline)).toBe(true);
  });

  it("memulihkan hanya kunci form yang dikenal bertipe string", () => {
    const restored = restoreSpmbAdminForm(baseline, { nama: "Aisyah", telepon: 123, asing: "x", tahun_ajaran_id: "th-lama" });
    expect(restored).toEqual({ ...baseline, nama: "Aisyah" });
  });
});
