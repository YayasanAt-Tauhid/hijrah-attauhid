/**
 * An external applicant's displayed destination NIS may come from the
 * per-department history while the current siswa.nis is still empty.
 * The SPMB status trigger checks siswa.nis, so sync the existing NIS
 * through the idempotent SPMB generator before accepting.
 * Internal transfers use their separate registration-status RPC.
 */
export function needsNisSyncForExternalAcceptance(row: Record<string, unknown>): boolean {
  const targetNis = String(row.nis || "").trim();
  const currentNis = String(row._academicNis || "").trim();
  const sameDepartment = Boolean(row.departemen_id && row._academicDepartemenId === row.departemen_id);
  return !targetNis || (sameDepartment && !currentNis);
}