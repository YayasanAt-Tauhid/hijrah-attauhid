interface Props {
  row: Record<string, unknown>;
}

// Keep destination NIS separate from the current-school NIS. Displaying the
// current number must never satisfy the destination-school activation checks.
export function SpmbNisDisplay({ row }: Props) {
  const sourceNis = String(row._spmbOriginNis || row._academicNis || "");
  const targetNis = String(row.nis || "");
  const sourceSchool = String(row._spmbOriginLembagaKode || row._academicLembagaKode || row._spmbOriginLembagaNama || row._academicLembagaNama || "asal");
  const targetSchool = String(row._lembagaKode || row._lembagaNama || "tujuan");
  const sourceDepartmentId = String(row._spmbOriginDepartmentId || row._academicDepartemenId || "");
  const targetDepartmentId = String(row.departemen_id || "");
  const differentSchools = Boolean(sourceDepartmentId && targetDepartmentId
    && sourceDepartmentId !== targetDepartmentId);
  // Lembaga yang berbeda tidak otomatis berarti siswa internal. Pendaftar
  // eksternal tidak memiliki NIS asal At-Tauhid dan tidak boleh ditampilkan
  // seolah-olah sedang menjalani mutasi jenjang.
  if (!differentSchools || row._spmbInternal !== true) {
    const nis = targetNis || (!differentSchools ? sourceNis : "");
    const label = differentSchools ? "NIS tujuan" : "NIS";
    return <span className="block">{label}: <span className="font-mono">{nis || "Belum dibuat"}</span></span>;
  }
  return <span className="block space-y-0.5">
    <span className="block">NIS asal ({sourceSchool}): <span className="font-mono">{sourceNis || "Belum ada (bukan syarat penerimaan)"}</span></span>
    <span className="block">NIS tujuan ({targetSchool}): <span className="font-mono">{targetNis || "Belum dibuat"}</span></span>
  </span>;
}