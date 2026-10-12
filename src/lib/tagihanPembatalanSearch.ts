/** Query guardrails: a broad query must not silently omit students or bills. */
export const MAX_CANCEL_SEARCH_STUDENTS = 20;
export const MIN_CANCEL_SEARCH_LENGTH = 3;

export function normalizeCancelSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 100);
}

/** Treat % and _ as literal characters in user-supplied PostgREST ILIKE patterns. */
export function escapeCancelIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function collectCancelStudentIds(
  byNis: ReadonlyArray<{ id: string }>,
  byName: ReadonlyArray<{ id: string }>,
): string[] {
  const ids = [...new Set([...byNis, ...byName].map((s) => s.id))];
  if (byNis.length > MAX_CANCEL_SEARCH_STUDENTS
    || byName.length > MAX_CANCEL_SEARCH_STUDENTS
    || ids.length > MAX_CANCEL_SEARCH_STUDENTS) {
    throw new Error("Terlalu banyak siswa cocok. Perjelas nama atau masukkan NIS lengkap sebelum memilih tagihan.");
  }
  return ids;
}


/** ISO dates sort lexicographically. Unknown dates cannot enter a dated batch. */
export function withinCancelDueDateRange(
  bill: { jatuh_tempo?: string | null }, start: string, end: string,
): boolean {
  if (!start && !end) return true;
  if (!bill.jatuh_tempo) return false;
  return (!start || bill.jatuh_tempo >= start) && (!end || bill.jatuh_tempo <= end);
}
