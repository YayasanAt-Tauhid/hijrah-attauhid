/**
 * Keep one stuck gateway order from blocking other orders.
 * Used only by the authenticated, scheduled reconciliation endpoint.
 */
export type ReconciliationOutcome = "skipped" | "checked" | "closed";

// Keep the total number of Midtrans + Supabase fetches inside the Worker limit.
export const RECONCILIATION_BATCH_LIMIT = 2;
export function limitReconciliationCandidates<T>(candidates: T[]): T[] {
  return candidates.slice(0, RECONCILIATION_BATCH_LIMIT);
}
export interface ReconciliationFailure {
  order_id: string;
  reason: string;
  persistence_error?: string;
}
export interface ReconciliationResult {
  checked: number;
  closed: number;
  failed: number;
  failures: ReconciliationFailure[];
}

export function reconciliationErrorMessage(error: unknown): string {
  // Return only a bounded diagnostic in the signed scheduler response.
  const message = error instanceof Error ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error ?? "Unknown error");
  return message.slice(0, 300);
}

export async function runReconciliationBatch<T extends { order_id: string }>(
  candidates: T[],
  inspect: (candidate: T) => Promise<ReconciliationOutcome>,
  persist: (candidate: T, error: string | null) => Promise<void>,
  concurrency = 2,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { checked: 0, closed: 0, failed: 0, failures: [] };
  let index = 0;
  async function worker() {
    while (index < candidates.length) {
      const candidate = candidates[index++];
      result.checked++;
      try {
        const outcome = await inspect(candidate);
        if (outcome === "skipped") { result.checked--; continue; }
        if (outcome === "closed") result.closed++;
        await persist(candidate, null);
      } catch (error) {
        result.failed++;
        const reason = reconciliationErrorMessage(error);
        const failure: ReconciliationFailure = { order_id: candidate.order_id, reason };
        try {
          await persist(candidate, reason);
        } catch (writeError) {
          failure.persistence_error = reconciliationErrorMessage(writeError);
        }
        result.failures.push(failure);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), candidates.length) }, () => worker()));
  return result;
}
