import { describe, expect, it, vi } from "vitest";
import { runReconciliationBatch } from "./reconciliationBatch";

describe("reconciliation batch", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ order_id: `TEST-${i}` }));
  it("visits later orders even when initial orders fail", async () => {
    let active = 0;
    let maxActive = 0;
    const inspected: string[] = [];
    const persist = vi.fn(async () => {});
    const result = await runReconciliationBatch(rows, async (row) => {
      active++;
      maxActive = Math.max(active, maxActive);
      inspected.push(row.order_id);
      await Promise.resolve();
      active--;
      if (row.order_id === "TEST-0" || row.order_id === "TEST-1") {
        throw new Error("Gateway unavailable");
      }
      return "checked";
    }, persist);
    expect(result).toMatchObject({ checked: 10, closed: 0, failed: 2 });
    expect(result.failures.map(f => f.order_id).sort()).toEqual(["TEST-0", "TEST-1"]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(inspected).toHaveLength(10);
    expect(persist).toHaveBeenCalledTimes(10);
  });
  it("reports failure to save diagnostics instead of silently suppressing it", async () => {
    const result = await runReconciliationBatch([{ order_id: "TEST-ERR" }], async () => {
      throw new Error("Snap cancel rejected");
    }, async () => { throw new Error("PostgREST timeout"); });
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{
      order_id: "TEST-ERR",
      reason: "Snap cancel rejected",
      persistence_error: "PostgREST timeout",
    }]);
  });
  it("preserves a closed outcome even when saving a check fails", async () => {
    let attempts = 0;
    const result = await runReconciliationBatch([{ order_id: "TEST-CLOSE" }], async () => "closed", async () => {
      attempts++;
      if (attempts === 1) throw new Error("Update failed");
    });
    expect(result).toMatchObject({ checked: 1, closed: 1, failed: 1 });
    expect(attempts).toBe(2);
  });
});
