export interface SpmbNisHistoryEntry {
  departemen_id: string;
  nis: string | null | undefined;
}

export interface ResolveSpmbTargetNisInput {
  currentNis: string | null | undefined;
  currentDepartmentId: string | null | undefined;
  targetDepartmentId: string | null | undefined;
  history: readonly SpmbNisHistoryEntry[];
}

function normalizeNis(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/-/g, "");
}

/**
 * Resolve the NIS for the SPMB destination department.
 *
 * The per-department history is authoritative. A student's current NIS can
 * still be the source-school NIS after a legacy/manual department change, so
 * do not present it as the destination NIS when history assigns it elsewhere.
 */
export function resolveSpmbTargetNis(input: ResolveSpmbTargetNisInput): string | null {
  const targetDepartmentId = String(input.targetDepartmentId ?? "").trim();
  if (!targetDepartmentId) return null;

  const targetHistoryNis = input.history.find(
    (entry) => entry.departemen_id === targetDepartmentId && normalizeNis(entry.nis),
  )?.nis;
  if (targetHistoryNis) return normalizeNis(targetHistoryNis);

  const currentNis = normalizeNis(input.currentNis);
  const currentDepartmentId = String(input.currentDepartmentId ?? "").trim();
  if (!currentNis || !currentDepartmentId || currentDepartmentId !== targetDepartmentId) {
    return null;
  }

  const currentNisIsKnownToBelongToAnotherDepartment = input.history.some(
    (entry) =>
      entry.departemen_id !== targetDepartmentId
      && normalizeNis(entry.nis) === currentNis,
  );

  return currentNisIsKnownToBelongToAnotherDepartment ? null : currentNis;
}
