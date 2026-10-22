interface Props {
  row: Record<string, unknown>;
}

// Keep destination NIS separate from the current-school NIS. Displaying the
// current number must never satisfy the destination-school activation checks.
export function SpmbNisDisplay({ row }: Props) {
  const sourceNis = String(row._academicNis || "");
  const targetNis = String(row.nis || "");
  const sourceSchool = String(row._academicLembagaKode || row._academicLembagaNama || "asal");
  const targetSchool = String(row._lembagaKode || row._lembagaNama || "tujuan");
  const differentSchools = Boolean(row._academicDepartemenId && row.departemen_id
    && row._academicDepartemenId !== row.departemen_id);
  if (!differentSchools) {
    return <span className="block">NIS: <span className="font-mono">{targetNis || sourceNis || "Belum ada"}</span></span>;
  }
  return <span className="block space-y-0.5">
    <span className="block">NIS asal ({sourceSchool}): <span className="font-mono">{sourceNis || "Belum ada"}</span></span>
    <span className="block">NIS tujuan ({targetSchool}): <span className="font-mono">{targetNis || "Belum dibuat"}</span></span>
  </span>;
}
