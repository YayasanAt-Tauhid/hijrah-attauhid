import { describe, expect, it, vi } from "vitest";
import { fetchSpmbReadinessInBatches } from "./spmbReadiness";

describe("fetchSpmbReadinessInBatches", () => {
  it("avoids a query for an empty list", async () => {
    const fn = vi.fn();
    expect(await fetchSpmbReadinessInBatches([], fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("limits each RPC batch and preserves input order", async () => {
    const ids = Array.from({ length: 31 }, (_, i) => String(i));
    const fn = vi.fn(async (batch: string[]) => batch.map((id) => ({ id })));
    const rows = await fetchSpmbReadinessInBatches(ids, fn, 12, 3);
    expect(fn.mock.calls.map(([batch]) => batch.length).sort((a, b) => a - b)).toEqual([7, 12, 12]);
    expect(rows.map((row) => row.id)).toEqual(ids);
  });

  it("limits concurrent requests", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(i));
    let active = 0;
    let maxActive = 0;
    await fetchSpmbReadinessInBatches(ids, async (batch) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return batch;
    }, 2, 3);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("propagates an error rather than accepting incomplete readiness as complete", async () => {
    await expect(fetchSpmbReadinessInBatches(["1", "2"], async () => {
      throw new Error("database timeout");
    }, 1, 2)).rejects.toThrow("database timeout");
  });
});
