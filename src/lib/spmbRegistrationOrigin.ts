export interface SpmbDepartmentHistoryEntry {
  departemen_id: string;
  created_at?: string | null;
}

export interface ResolveSpmbOriginDepartmentInput {
  currentDepartmentId: string | null | undefined;
  targetDepartmentId: string | null | undefined;
  history: readonly SpmbDepartmentHistoryEntry[];
}

/**
 * Resolve the source department for an internal SPMB registration.
 *
 * The active student row can already point at the destination department even
 * when the SPMB transition has not been activated. In that case, department
 * history (excluding the destination) is the source of truth. Prefer the most
 * recent non-destination history entry so SD -> SMP -> SMA resolves to SMP -> SMA.
 */
export function resolveSpmbOriginDepartmentId(
  input: ResolveSpmbOriginDepartmentInput,
): string | null {
  const targetDepartmentId = String(input.targetDepartmentId ?? "").trim();
  const history = input.history.filter((entry) => {
    const departmentId = String(entry.departemen_id ?? "").trim();
    return Boolean(departmentId) && departmentId !== targetDepartmentId;
  });

  history.sort((a, b) => {
    const timeA = Date.parse(String(a.created_at ?? "")) || 0;
    const timeB = Date.parse(String(b.created_at ?? "")) || 0;
    return timeB - timeA;
  });

  if (history[0]?.departemen_id) return history[0].departemen_id;

  const currentDepartmentId = String(input.currentDepartmentId ?? "").trim();
  if (currentDepartmentId && currentDepartmentId !== targetDepartmentId) {
    return currentDepartmentId;
  }

  // Do not invent an SMA -> SMA origin when the history cannot identify it.
  return null;
}
