import { describe, expect, it } from "vitest";
import { getKodeRombel } from "./nisRombel";

describe("getKodeRombel", () => {
  it.each([
    ["12A", 1],
    ["5C", 3],
    ["mta 1", 1],
    ["TK A2", 2],
  ])("membaca kode rombel dari kelas %s", (namaKelas, expected) => {
    expect(getKodeRombel(namaKelas)).toBe(expected);
  });

  it.each(["", "MTA 0", "Kelas -", "Kelas 10"])(
    "menolak format yang tidak muat dalam satu digit: %s",
    (namaKelas) => {
      expect(getKodeRombel(namaKelas)).toBeNull();
    }
  );
});
