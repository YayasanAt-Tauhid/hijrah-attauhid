import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { JenisIdentitasAnak } from "@/lib/identitasAnak";

export type ChildIdentityType = JenisIdentitasAnak;
export interface ChildIdentityInput {
  nis: string;
  jenis_identitas?: ChildIdentityType;
  nama: string;
  tanggal_lahir: string;
}
const FAILED = "Data siswa tidak ditemukan. Periksa kembali NIS/NISN/ID Santri, nama lengkap, dan tanggal lahir anak.";
// ID Santri: YY.KK.NNN (tahun angkatan, kode lembaga, nomor urut).
const ID_SANTRI_FORMAT = /^\d{2}\.\d{2}\.\d{3,}$/;

// Keep exact identifiers (including leading zeroes); never interpolate user input into filters.
export async function cariSiswaTervalidasi(admin: SupabaseClient<Database>, input: ChildIdentityInput) {
  const type = input.jenis_identitas ?? "nis";
  if (type !== "nis" && type !== "nisn" && type !== "id_santri") throw new Error(FAILED);
  const number = (input.nis || "").trim();
  const identifier = type === "nis" ? number.replace(/-/g, "") : number;
  const name = (input.nama || "").trim().toLowerCase();
  const birthDate = (input.tanggal_lahir || "").trim();
  if (!identifier || !name || !birthDate) {
    throw new Error("NIS/NISN/ID Santri, nama lengkap, dan tanggal lahir anak wajib diisi");
  }
  if (type === "nisn" && !/^\d{10}$/.test(identifier)) throw new Error(FAILED);
  if (type === "id_santri" && !ID_SANTRI_FORMAT.test(identifier)) throw new Error(FAILED);
  const column = type === "id_santri" ? "id_santri_pihak3" : type;
  const { data, error } = await admin.from("siswa")
    .select("id, nama, nis")
    .eq(column, identifier)
    .eq("tanggal_lahir", birthDate)
    .maybeSingle();
  // Duplicate identifiers and query failures must fail closed; do not pick the first child.
  if (error || !data || data.nama.trim().toLowerCase() !== name) throw new Error(FAILED);
  return data;
}
