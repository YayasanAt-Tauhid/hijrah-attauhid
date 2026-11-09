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

  it("stops when the server ignores the range and returns every row on each call", async () => {
    const rows = Array.from({ length: 548 }, (_, id) => ({ id }));
    let calls = 0;
    const loaded = await fetchAllFamilySuggestions(async () => {
      calls += 1;
      if (calls > 5) throw new Error("loop tidak berhenti");
      return rows;
    });
    expect(loaded).toEqual(rows);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("does not duplicate rows when an ignored range returns exactly one full page", async () => {
    const rows = Array.from({ length: 500 }, (_, id) => ({ id }));
    let calls = 0;
    const loaded = await fetchAllFamilySuggestions(async () => {
      calls += 1;
      if (calls > 5) throw new Error("loop tidak berhenti");
      return rows;
    });
    expect(loaded).toEqual(rows);
  });

  it("fails loudly instead of exhausting the Worker subrequest limit", async () => {
    let calls = 0;
    await expect(fetchAllFamilySuggestions(async (from) => {
      calls += 1;
      if (calls > 25) throw new Error("loop tidak berhenti");
      return Array.from({ length: 500 }, (_, i) => ({ id: from + i }));
    })).rejects.toThrow("terlalu banyak");
    expect(calls).toBeLessThanOrEqual(20);
  });

  it("deduplicates by the provided key", async () => {
    const rows = Array.from({ length: 548 }, (_, id) => ({ sumber: "no_kk", kunci: `k${id}`, extra: Math.random() }));
    let calls = 0;
    const loaded = await fetchAllFamilySuggestions(
      async () => {
        calls += 1;
        if (calls > 5) throw new Error("loop tidak berhenti");
        return rows;
      },
      (r) => `${r.sumber}:${r.kunci}`,
    );
    expect(loaded).toHaveLength(548);
  });
});
