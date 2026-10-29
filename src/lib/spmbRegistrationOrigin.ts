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

export interface ResolveSpmbOriginNisInput {
  originDepartmentId: string | null | undefined;
  currentDepartmentId: string | null | undefined;
  currentNis: string | null | undefined;
  history: readonly (SpmbDepartmentHistoryEntry & { nis?: string | null })[];
}

function normalizeNis(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/-/g, '');
}

/**
 * Resolve the NIS of the source department for an internal SPMB registration.
 * Use the per-department history first; the current student row can already
 * contain the destination NIS even while the source class is still active.
 */
export function resolveSpmbOriginNis(input: ResolveSpmbOriginNisInput): string | null {
  const originDepartmentId = String(input.originDepartmentId ?? '').trim();
  if (!originDepartmentId) return null;

  const entries = input.history
    .filter((entry) => (String(entry.departemen_id ?? '').trim() === originDepartmentId)
      && Boolean(normalizeNis(entry.nis)))
    .slice()
    .sort((a, b) => {
      const timeA = Date.parse(String(a.created_at ?? '')) || 0;
      const timeB = Date.parse(String(b.created_at ?? '')) || 0;
      return timeB - timeA;
    });

  if (entries[0]?.nis) return normalizeNis(entries[0].nis);

  // Only fall back to the master NIS when that master row still belongs to
  // the source department. Never relabel a destination NIS as the source NIS.
  if (String(input.currentDepartmentId ?? '').trim() === originDepartmentId) {
    return normalizeNis(input.currentNis) || null;
  }

  return null;
}
