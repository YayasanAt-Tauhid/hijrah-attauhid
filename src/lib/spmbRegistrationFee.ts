export type SpmbRegistrationFeeKey = "belum_diperiksa" | "gratis" | "belum_diatur" | "lunas" | "belum_bayar";
export type SpmbRegistrationFeeTone = "muted" | "success" | "warning" | "destructive";

export interface SpmbRegistrationFeeStatus {
  key: SpmbRegistrationFeeKey;
  label: string;
  tone: SpmbRegistrationFeeTone;
}

interface RegistrationFeeInput {
  _readiness?: unknown;
  _pmbGratis?: boolean;
  _pmbConfigured?: boolean;
  _pmbLunas?: boolean;
}

/**
 * Status biaya pendaftaran satu baris daftar SPMB. Dipakai kolom "Seleksi &
 * aktivasi" dan "Biaya Pendaftaran" supaya keduanya tidak pernah berbeda.
 * Urutan penentuan sama dengan filter "Biaya Pendaftaran" (_biayaSort).
 */
export function getSpmbRegistrationFeeStatus(row: RegistrationFeeInput): SpmbRegistrationFeeStatus {
  if (!row._readiness) return { key: "belum_diperiksa", label: "Belum diperiksa", tone: "muted" };
  if (row._pmbGratis) return { key: "gratis", label: "Gratis", tone: "success" };
  if (!row._pmbConfigured) return { key: "belum_diatur", label: "Belum diatur", tone: "warning" };
  if (row._pmbLunas) return { key: "lunas", label: "Lunas", tone: "success" };
  return { key: "belum_bayar", label: "Belum bayar", tone: "destructive" };
}
