import { describe, expect, it } from "vitest";
import { isSpmbAccepted, isSpmbActivated, matchesSpmbStatus, summarizeSpmbAdmissions } from "./spmbAdmission";

describe("SPMB admission across activation", () => {
  it("keeps all ten accepted registrations when seven are activated", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ status: i < 7 ? "aktif" : "diterima", _spmbInternal: false, _academicStatus: i < 7 ? "aktif" : "diterima" }));
    expect(summarizeSpmbAdmissions(rows)).toEqual({ total: 10, accepted: 10, activated: 7, awaitingActivation: 3 });
    expect(rows.filter((row) => matchesSpmbStatus(row, "diterima"))).toHaveLength(10);
    expect(rows.filter((row) => matchesSpmbStatus(row, "belum_aktif"))).toHaveLength(3);
    expect(rows.filter((row) => matchesSpmbStatus(row, "selesai"))).toHaveLength(7);
  });
  it("does not mistake an internal student's active origin class for destination activation", () => {
    const candidate = { status: "calon", _spmbInternal: true, _academicStatus: "aktif" };
    const accepted = { ...candidate, status: "diterima" };
    expect(isSpmbAccepted(candidate)).toBe(false);
    expect(isSpmbActivated(candidate)).toBe(false);
    expect(isSpmbAccepted(accepted)).toBe(true);
    expect(isSpmbActivated(accepted)).toBe(false);
    expect(matchesSpmbStatus(accepted, "belum_aktif")).toBe(true);
  });
  it("preserves admission when an internal transfer finishes atomically", () => {
    const row = { status: "selesai", _spmbInternal: true, _academicStatus: "aktif", _spmbTanggalAktivasi: "2027-07-01T00:00:00Z" };
    expect(isSpmbAccepted(row)).toBe(true);
    expect(isSpmbActivated(row)).toBe(true);
    expect(matchesSpmbStatus(row, "diterima")).toBe(true);
    expect(matchesSpmbStatus(row, "belum_aktif")).toBe(false);
  });
  it("recognizes external activation when the registration still stores diterima", () => {
    expect(isSpmbActivated({ status: "diterima", _spmbInternal: false, _academicStatus: "aktif" })).toBe(true);
  });
  it("matches the production states without counting internal applicants as activated", () => {
    const rows = [
      ...Array.from({ length: 13 }, () => ({ status: "aktif", _spmbInternal: false, _academicStatus: "aktif" })),
      ...Array.from({ length: 53 }, () => ({ status: "calon", _spmbInternal: true, _academicStatus: "aktif" })),
      ...Array.from({ length: 55 }, () => ({ status: "calon", _spmbInternal: false, _academicStatus: "calon" })),
    ];
    expect(summarizeSpmbAdmissions(rows)).toEqual({ total: 121, accepted: 13, activated: 13, awaitingActivation: 0 });
  });
});
