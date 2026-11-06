import { describe, expect, it } from "vitest";
import { resolveSpmbTargetNis } from "./spmbTargetNis";

describe("resolveSpmbTargetNis", () => {
  it("uses the target department history when it exists", () => {
    expect(resolveSpmbTargetNis({
      currentNis: "2603001",
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [
        { departemen_id: "smp", nis: "2603001" },
        { departemen_id: "sma", nis: "2704018" },
      ],
    })).toBe("2704018");
  });

  it("does not present a source-school NIS as the destination NIS", () => {
    expect(resolveSpmbTargetNis({
      currentNis: "2603001",
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [{ departemen_id: "smp", nis: "2603001" }],
    })).toBeNull();
  });

  it("allows the current NIS as fallback when no history assigns it elsewhere", () => {
    expect(resolveSpmbTargetNis({
      currentNis: "2704018",
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [],
    })).toBe("2704018");
  });

  it("returns null when the target department differs and has no history NIS", () => {
    expect(resolveSpmbTargetNis({
      currentNis: "2603001",
      currentDepartmentId: "smp",
      targetDepartmentId: "sma",
      history: [{ departemen_id: "smp", nis: "2603001" }],
    })).toBeNull();
  });

  it("normalizes legacy hyphens when comparing history", () => {
    expect(resolveSpmbTargetNis({
      currentNis: "26-03-001",
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [{ departemen_id: "smp", nis: "2603001" }],
    })).toBeNull();
  });
});
