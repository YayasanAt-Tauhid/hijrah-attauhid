import { describe, expect, it } from "vitest";
import { fromJson, toJson } from "./rpcJson";

describe("rpcJson", () => {
  it("toJson meneruskan nilai apa adanya (hanya penanda tipe)", () => {
    const payload = { a: 1, b: ["x"], c: null };
    expect(toJson(payload)).toBe(payload);
    expect(toJson(null)).toBeNull();
  });

  it("fromJson meneruskan nilai apa adanya, termasuk null/undefined", () => {
    const data = { nis_baru: "2601001" };
    expect(fromJson<{ nis_baru?: string }>(data)).toBe(data);
    expect(fromJson<{ id?: string }>(null)).toBeNull();
    expect(fromJson<{ id?: string }>(undefined)).toBeUndefined();
  });

  it("hasil yang diserialisasi lalu dibaca kembali tetap utuh", () => {
    const sent = toJson({ rows: [{ siswa_id: "s1", nominal: 100000 }] });
    expect(fromJson<{ rows: Array<{ siswa_id: string; nominal: number }> }>(JSON.parse(JSON.stringify(sent))).rows[0].nominal).toBe(100000);
  });
});
