import { describe, expect, it } from "vitest";
import {
  billingPeriodLabel,
  findBillingPrerequisite,
  sortBillingSequence,
  type BillingSequenceBill,
} from "./billingSequence";

const bill = (
  id: string,
  month: number,
  start: string,
  jenis = "spp",
): BillingSequenceBill => ({
  id,
  siswa_id: "siswa-1",
  jenis_id: jenis,
  bulan: month,
  tahun_ajaran_mulai: start,
});

describe("billing sequence", () => {
  it("mengurutkan periode lintas tahun ajaran Juli-Juni secara kronologis", () => {
    const rows = [
      bill("jan", 1, "2025-07-01"),
      bill("nov", 11, "2025-07-01"),
      bill("jul", 7, "2025-07-01"),
    ];

    expect(sortBillingSequence(rows).map((row) => row.id)).toEqual([
      "jul",
      "nov",
      "jan",
    ]);
  });

  it("memblokir lompatan bulan bila ada tagihan lebih lama yang belum dipilih", () => {
    const july = bill("jul", 7, "2026-07-01");
    const august = bill("aug", 8, "2026-07-01");
    const september = bill("sep", 9, "2026-07-01");

    expect(
      findBillingPrerequisite(
        september,
        [july, august, september],
        new Set(["jul"]),
      )?.id,
    ).toBe("aug");
  });

  it("mengizinkan beberapa bulan sekaligus bila semuanya merupakan prefix dari yang paling lama", () => {
    const july = bill("jul", 7, "2026-07-01");
    const august = bill("aug", 8, "2026-07-01");
    const september = bill("sep", 9, "2026-07-01");

    expect(
      findBillingPrerequisite(
        september,
        [july, august, september],
        new Set(["jul", "aug", "sep"]),
      ),
    ).toBeNull();
  });

  it("tidak mencampur urutan antar jenis tagihan", () => {
    const sppJuly = bill("spp-jul", 7, "2026-07-01", "spp");
    const bukuAugust = bill("buku-aug", 8, "2026-07-01", "buku");

    expect(
      findBillingPrerequisite(
        bukuAugust,
        [sppJuly, bukuAugust],
        new Set<string>(),
      ),
    ).toBeNull();
  });

  it("membuat label bulan dengan tahun kalender yang benar", () => {
    expect(billingPeriodLabel(bill("jan", 1, "2026-07-01"))).toBe("Januari 2027");
  });
});
