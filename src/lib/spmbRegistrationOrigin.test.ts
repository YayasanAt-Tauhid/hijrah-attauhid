import { describe, expect, it } from "vitest";
import { resolveSpmbOriginDepartmentId } from "./spmbRegistrationOrigin";

describe("resolveSpmbOriginDepartmentId", () => {
  it("uses SMP as the source when the current student row already points to SMA", () => {
    expect(resolveSpmbOriginDepartmentId({
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [
        { departemen_id: "smp", created_at: "2026-09-24T05:04:30Z" },
        { departemen_id: "sma", created_at: "2026-10-29T01:07:25Z" },
      ],
    })).toBe("smp");
  });

  it("chooses the latest prior department for a multi-level transition", () => {
    expect(resolveSpmbOriginDepartmentId({
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [
        { departemen_id: "sd", created_at: "2024-06-01T00:00:00Z" },
        { departemen_id: "smp", created_at: "2026-06-01T00:00:00Z" },
        { departemen_id: "sma", created_at: "2026-10-29T00:00:00Z" },
      ],
    })).toBe("smp");
  });

  it("uses the current department when it differs from the destination and history is empty", () => {
    expect(resolveSpmbOriginDepartmentId({
      currentDepartmentId: "smp",
      targetDepartmentId: "sma",
      history: [],
    })).toBe("smp");
  });

  it("does not label the destination as its own source without prior history", () => {
    expect(resolveSpmbOriginDepartmentId({
      currentDepartmentId: "sma",
      targetDepartmentId: "sma",
      history: [{ departemen_id: "sma", created_at: "2026-10-29T00:00:00Z" }],
    })).toBeNull();
  });
});
