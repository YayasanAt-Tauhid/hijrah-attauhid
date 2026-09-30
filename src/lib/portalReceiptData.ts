interface ReceiptIdentityRow {
  siswa?: { nama?: string; nis?: string | null; nisn?: string | null; kelas_siswa?: { aktif?: boolean; kelas?: { nama?: string } | null }[] } | null;
  departemen?: { nama?: string } | null;
}
export function portalReceiptIdentity(rows: ReceiptIdentityRow[]) {
  const join = (values: (string | null | undefined)[]) => [...new Set(values.filter(Boolean))].join(", ");
  return {
    siswa: {
      nama: join(rows.map(r => r.siswa?.nama)) || "-",
      nis: join(rows.map(r => r.siswa?.nis)),
      nisn: join(rows.map(r => r.siswa?.nisn)),
    },
    kelasNama: join(rows.map(r => {
      const classes = r.siswa?.kelas_siswa || [];
      return (classes.find(c => c.aktif) || classes[0])?.kelas?.nama;
    })),
    lembagaNama: join(rows.map(r => r.departemen?.nama)),
  };
}
