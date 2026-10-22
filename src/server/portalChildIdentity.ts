import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ChildIdentityType = "nis" | "nisn";
export interface ChildIdentityInput {
  nis: string;
  jenis_identitas?: ChildIdentityType;
  nama: string;
  tanggal_lahir: string;
}
const FAILED = "Data siswa tidak ditemukan. Periksa kembali NIS/NISN, nama lengkap, dan tanggal lahir anak.";

// Keep exact identifiers (including leading zeroes); never interpolate user input into filters.
export async function cariSiswaTervalidasi(admin: SupabaseClient<Database>, input: ChildIdentityInput) {
  const type = input.jenis_identitas ?? "nis";
  if (type !== "nis" && type !== "nisn") throw new Error(FAILED);
  const number = (input.nis || "").trim();
  const identifier = type === "nis" ? number.replace(/-/g, "") : number;
  const name = (input.nama || "").trim().toLowerCase();
  const birthDate = (input.tanggal_lahir || "").trim();
  if (!identifier || !name || !birthDate) {
    throw new Error("NIS/NISN, nama lengkap, dan tanggal lahir anak wajib diisi");
  }
  if (type === "nisn" && !/^\d{10}$/.test(identifier)) throw new Error(FAILED);
  const { data, error } = await admin.from("siswa")
    .select("id, nama, nis")
    .eq(type, identifier)
    .eq("tanggal_lahir", birthDate)
    .maybeSingle();
  // Duplicate NISNs and query failures must fail closed; do not pick the first child.
  if (error || !data || data.nama.trim().toLowerCase() !== name) throw new Error(FAILED);
  return data;
}
