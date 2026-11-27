import { describe, expect, it } from "vitest";
import { formatRataRata, rataRataNilai, ringkasPresensi } from "./portalAkademik";

describe("ringkasPresensi", () => {
  it("menghitung tiap status dan persentase hadir dibulatkan", () => {
    const rows = [
      ...Array(18).fill({ status: "H" }),
      ...Array(2).fill({ status: "I" }),
      { status: "S" },
      { status: "A" },
    ];
    expect(ringkasPresensi(rows)).toEqual({
      counts: { H: 18, I: 2, S: 1, A: 1 },
      total: 22,
      persenHadir: 82,
    });
  });

  it("mengabaikan status tak dikenal atau kosong dan tidak membagi nol", () => {
    expect(ringkasPresensi([])).toEqual({
      counts: { H: 0, I: 0, S: 0, A: 0 },
      total: 0,
      persenHadir: 0,
    });
    const hasil = ringkasPresensi([{ status: "H" }, { status: null }, { status: "X" }, {}]);
    expect(hasil.total).toBe(1);
    expect(hasil.persenHadir).toBe(100);
  });
});

describe("rataRataNilai dan formatRataRata", () => {
  it("rata-rata memperlakukan nilai kosong sebagai 0, sama seperti sebelumnya", () => {
    expect(rataRataNilai([88, 82, 76, 91, 65])).toBeCloseTo(80.4, 5);
    expect(rataRataNilai([80, null, undefined, 100])).toBe(45);
    expect(rataRataNilai([])).toBe(0);
  });

  it("memformat satu desimal dengan koma", () => {
    expect(formatRataRata(80.4)).toBe("80,4");
    expect(formatRataRata(86)).toBe("86,0");
    expect(formatRataRata(0)).toBe("0,0");
  });
});
