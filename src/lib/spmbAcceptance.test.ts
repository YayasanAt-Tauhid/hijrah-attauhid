import { describe, expect, it } from "vitest";
import { needsNisSyncForExternalAcceptance } from "./spmbAcceptance";

describe("external SPMB NIS preparation", () => {
  it("generates a missing destination NIS", () => {
    expect(needsNisSyncForExternalAcceptance({ nis: null, _academicNis: null, departemen_id: "smp", _academicDepartemenId: "smp" })).toBe(true);
  });
  it("syncs an already issued destination NIS that is missing on the active student record", () => {
    expect(needsNisSyncForExternalAcceptance({ nis: "2703001", _academicNis: null, departemen_id: "smp", _academicDepartemenId: "smp" })).toBe(true);
  });
  it("does not generate another NIS when the destination and current NIS already exist", () => {
    expect(needsNisSyncForExternalAcceptance({ nis: "2703001", _academicNis: "2703001", departemen_id: "smp", _academicDepartemenId: "smp" })).toBe(false);
  });
  it("does not overwrite the NIS of a different source school", () => {
    expect(needsNisSyncForExternalAcceptance({ nis: "2703001", _academicNis: null, departemen_id: "smp", _academicDepartemenId: "sd" })).toBe(false);
  });
});