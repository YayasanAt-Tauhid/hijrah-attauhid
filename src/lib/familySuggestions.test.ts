import { describe, expect, it } from "vitest";
import { fetchAllFamilySuggestions, filterFamilySuggestions } from "./familySuggestions";

describe("family suggestions", () => {
  it("finds siblings beyond both the old 200-group limit and the API row cap", async () => {
    const groups = Array.from({ length: 1203 }, (_, index) => ({
      id: index,
      siswa: [{ nama: `Siswa ${index}`, nis: String(index) }],
    }));
    groups[1100].siswa = [
      { nama: "Syakila Adira Falisha", nis: "2538125424" },
      { nama: "Atsilah Khanza Nazifa", nis: "757-26" },
    ];
    const loaded = await fetchAllFamilySuggestions(async (from, to) =>
      groups.slice(from, to + 1),
    );
    expect(loaded).toHaveLength(1203);
    expect(filterFamilySuggestions(loaded, "  SYAKILA   adira ")).toEqual([groups[1100]]);
    expect(filterFamilySuggestions(loaded, "757-26")).toEqual([groups[1100]]);
    expect(filterFamilySuggestions(loaded, "2538125424")).toEqual([groups[1100]]);
    expect(filterFamilySuggestions(loaded, "")).toHaveLength(1203);
    expect(filterFamilySuggestions(loaded, "tidak ditemukan")).toEqual([]);
  });

  it("does not present a partial list as complete when a later page fails", async () => {
    await expect(fetchAllFamilySuggestions(async (from) => {
      if (from > 0) throw new Error("Gagal mengambil saran keluarga");
      return Array.from({ length: 500 }, (_, id) => ({ id }));
    })).rejects.toThrow("Gagal mengambil saran keluarga");
  });

  it("finishes an exact full page with an empty next page", async () => {
    const rows = Array.from({ length: 500 }, (_, id) => ({ id }));
    const loaded = await fetchAllFamilySuggestions(async (from, to) => rows.slice(from, to + 1));
    expect(loaded).toEqual(rows);
  });
});
