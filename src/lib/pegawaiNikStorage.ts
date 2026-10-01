import { supabase } from "@/integrations/supabase/client";
import { validateImportNiks, type ExistingPegawaiNik } from "./pegawaiNik";

export async function loadPegawaiNiks(): Promise<ExistingPegawaiNik[]> {
  const { data, error } = await supabase.from("pegawai_nik").select("pegawai_id,nik");
  if (error) throw new Error("NIK pegawai tidak dapat dibaca. Periksa akses admin.");
  return data || [];
}

export async function assertPegawaiNikAvailable(nik: string, existingId?: string) {
  if (!nik) return;
  const { data, error } = await supabase.from("pegawai_nik").select("pegawai_id,nik").eq("nik", nik);
  if (error) throw new Error("NIK tidak dapat divalidasi. Periksa akses admin.");
  const result = validateImportNiks([{ nik, existingId }], data || [])[0];
  if (result.error) throw new Error(result.error);
}

export async function writePegawaiNik(id: string, nik: string): Promise<void> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Sesi admin tidak tersedia.");
  const { data, error } = await supabase.from("pegawai_nik").upsert({
    pegawai_id: id, nik, updated_at: new Date().toISOString(), updated_by: auth.user.id,
  }, { onConflict: "pegawai_id" }).select("pegawai_id").single();
  if (error || !data) throw new Error("NIK gagal disimpan. Periksa akses admin dan duplikasi NIK.");
}
