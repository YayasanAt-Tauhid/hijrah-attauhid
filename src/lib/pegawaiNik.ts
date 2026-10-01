export type ExistingPegawaiNik = { pegawai_id: string; nik: string };
export type NikValidation = { nik: string; error?: string };

export function normalizePegawaiNik(value: unknown): string {
  return String(value ?? "").replace(/[\s.]/g, "");
}

export function maskPegawaiNik(value: unknown): string {
  const nik = normalizePegawaiNik(value);
  return nik ? "•••• •••• •••• " + nik.slice(-4) : "—";
}

export function validatePegawaiNik(value: unknown): NikValidation {
  const nik = normalizePegawaiNik(value);
  if (!nik) return { nik, error: undefined };
  if (typeof value !== "string") return { nik, error: "NIK harus berupa teks. Atur sel Excel sebagai Text agar digit tidak dibulatkan." };
  if (!/^[0-9]{16}$/.test(nik)) return { nik, error: "NIK harus tepat 16 digit; hanya spasi dan titik yang boleh menjadi pemisah." };
  return { nik, error: undefined };
}

export function validateImportNiks(
  rows: { nik?: unknown; existingId?: string }[],
  existing: ExistingPegawaiNik[],
): NikValidation[] {
  const values = rows.map(row => validatePegawaiNik(row.nik));
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value.nik && !value.error) counts.set(value.nik, (counts.get(value.nik) || 0) + 1);
  }
  const owners = new Map(existing.map(row => [row.nik, row.pegawai_id]));
  return values.map((value, index) => {
    if (value.error || !value.nik) return value;
    if ((counts.get(value.nik) || 0) > 1) return { ...value, error: "NIK duplikat di dalam file." };
    const owner = owners.get(value.nik);
    if (owner && owner !== rows[index].existingId) return { ...value, error: "NIK sudah digunakan pegawai lain." };
    return value;
  });
}

// The two tables are separate requests. Retain the saved employee ID before
// writing NIK, so a failed NIK write can be retried without another insert.
export async function savePegawaiWithNik(
  existingId: string | undefined,
  nik: string,
  callbacks: {
    writeEmployee: (id: string | undefined) => Promise<string>;
    writeNik: (id: string, nik: string) => Promise<void>;
    onEmployeeSaved: (id: string) => void;
  },
): Promise<string> {
  const id = await callbacks.writeEmployee(existingId);
  callbacks.onEmployeeSaved(id);
  if (nik) {
    try {
      await callbacks.writeNik(id, nik);
    } catch {
      throw new Error("Data pegawai tersimpan, tetapi NIK belum tersimpan. Coba simpan lagi pada record yang sama; periksa apakah NIK telah digunakan pegawai lain.");
    }
  }
  return id;
}
