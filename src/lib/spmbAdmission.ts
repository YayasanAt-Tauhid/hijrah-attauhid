export type SpmbAdmissionRow = {
  status?: unknown;
  _academicStatus?: unknown;
  _spmbInternal?: unknown;
  _spmbTanggalAktivasi?: unknown;
};

// Penerimaan SPMB tetap tercatat setelah aktivasi. Status akademik siswa
// internal di lembaga asal bukan bukti aktivasi pada pendaftaran tujuan.
export function isSpmbAccepted(row: SpmbAdmissionRow): boolean {
  return ["diterima", "aktif", "selesai"].includes(String(row.status))
    || Boolean(row._spmbTanggalAktivasi);
}

export function isSpmbActivated(row: SpmbAdmissionRow): boolean {
  if (row._spmbTanggalAktivasi || row.status === "selesai" || row.status === "aktif") return true;
  return row._spmbInternal !== true && isSpmbAccepted(row) && row._academicStatus === "aktif";
}

// Pendaftar yang mengundurkan diri tidak lagi bagian dari antrean seleksi:
// disembunyikan dari "Semua status" dan ringkasan, tetapi tetap bisa dilihat
// lewat filter "Mengundurkan diri" untuk keperluan audit dan keuangan.
export function isSpmbWithdrawn(row: SpmbAdmissionRow): boolean {
  return row.status === "mengundurkan_diri";
}

export function matchesSpmbStatus(row: SpmbAdmissionRow, filter: string): boolean {
  if (filter === "mengundurkan_diri") return isSpmbWithdrawn(row);
  if (isSpmbWithdrawn(row)) return false;
  if (filter === "all") return true;
  if (filter === "diterima") return isSpmbAccepted(row);
  if (filter === "belum_aktif") return isSpmbAccepted(row) && !isSpmbActivated(row);
  if (filter === "selesai") return isSpmbActivated(row);
  return row.status === filter;
}

export function summarizeSpmbAdmissions(allRows: SpmbAdmissionRow[]) {
  const rows = allRows.filter((row) => !isSpmbWithdrawn(row));
  const accepted = rows.filter(isSpmbAccepted);
  const activated = accepted.filter(isSpmbActivated).length;
  return { total: rows.length, accepted: accepted.length, activated, awaitingActivation: accepted.length - activated };
}
