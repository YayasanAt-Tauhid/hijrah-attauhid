import { describe, expect, it } from "vitest";
import { resolveSpmbOriginDepartmentId, resolveSpmbOriginNis } from "./spmbRegistrationOrigin";

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


describe("resolveSpmbOriginNis", () => {
  it("uses the source department NIS when the master row already holds destination NIS", () => {
    expect(resolveSpmbOriginNis({
      originDepartmentId: "smp",
      currentDepartmentId: "sma",
      currentNis: "2704018",
      history: [
        { departemen_id: "smp", nis: "2470012126014", created_at: "2026-09-24T05:04:30Z" },
        { departemen_id: "sma", nis: "2704018", created_at: "2026-10-29T01:07:25Z" },
      ],
    })).toBe("2470012126014");
  });

  it("prefers the most recent non-empty NIS in the resolved source department", () => {
    expect(resolveSpmbOriginNis({
      originDepartmentId: "smp",
      currentDepartmentId: "sma",
      currentNis: "2704018",
      history: [
        { departemen_id: "smp", nis: "2470012126001", created_at: "2025-01-01T00:00:00Z" },
        { departemen_id: "smp", nis: "2470012126014", created_at: "2026-09-24T05:04:30Z" },
      ],
    })).toBe("2470012126014");
  });

  it("does not fall back to destination NIS when the source history has no NIS", () => {
    expect(resolveSpmbOriginNis({
      originDepartmentId: "smp",
      currentDepartmentId: "sma",
      currentNis: "2704018",
      history: [{ departemen_id: "sma", nis: "2704018" }],
    })).toBeNull();
  });

  it("falls back to current NIS only while the master row belongs to source", () => {
    expect(resolveSpmbOriginNis({
      originDepartmentId: "smp",
      currentDepartmentId: "smp",
      currentNis: "2470012126014",
      history: [],
    })).toBe("2470012126014");
  });
});
