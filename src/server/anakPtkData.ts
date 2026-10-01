import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildAnakPtkReport, type AnakPtkSource, type AnakPtkReport } from "@/lib/anakPtk";

type YearOption = { id: string; nama: string; aktif: boolean; ditutup: boolean };
type JenisOption = { id: string; nama: string; departemen_id: string | null };
type DepartmentOption = { id: string; nama: string; kode: string };
export type AnakPtkSelection = { tahunAjaranId?: string; tahunBukuId?: string; jenisId?: string };
export type AnakPtkData = AnakPtkReport & {
  selection: { tahunAjaranId: string; tahunBukuId: string; jenisId: string };
  options: { tahunAjaran: YearOption[]; tahunBuku: YearOption[]; jenis: JenisOption[]; departemen: DepartmentOption[] };
  dibacaPada: string;
};

export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const result: T[] = [];
  const size = 500;
  for (let from = 0; from < 100000; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error("Gagal membaca data pemeriksaan anak PTK. Muat ulang atau periksa akses.");
    const rows = (data || []) as T[];
    result.push(...rows);
    if (rows.length < size) return result;
  }
  throw new Error("Data terlalu besar untuk laporan ini. Persempit cakupan sebelum melanjutkan.");
}

export async function loadAnakPtkData(
  admin: SupabaseClient<Database>,
  userId: string,
  input: AnakPtkSelection,
): Promise<AnakPtkData> {
  // Service-role client is server-only. Authorize before reading any identity.
  const { data: profile, error } = await admin.from("users_profile").select("role,aktif").eq("id", userId).single();
  if (error || !profile || profile.role !== "admin" || profile.aktif !== true) {
    throw new Error("Akses hanya untuk admin aktif.");
  }
  const [tahunAjaran, tahunBuku, jenis, departemen] = await Promise.all([
    readAllRows<YearOption>((from, to) => admin.from("tahun_ajaran").select("id,nama,aktif,ditutup").order("tanggal_mulai", { ascending: false }).order("id").range(from, to)),
    readAllRows<YearOption>((from, to) => admin.from("tahun_buku").select("id,nama,aktif,ditutup").order("tanggal_mulai", { ascending: false }).order("id").range(from, to)),
    readAllRows<JenisOption>((from, to) => admin.from("jenis_pembayaran").select("id,nama,departemen_id").eq("aktif", true).order("nama").order("id").range(from, to)),
    readAllRows<DepartmentOption>((from, to) => admin.from("departemen").select("id,nama,kode").order("nama").order("id").range(from, to)),
  ]);
  const choose = <T extends { id: string }>(options: T[], requested: string | undefined, fallback: T | undefined): string => {
    const option = requested ? options.find(row => row.id === requested) : fallback;
    if (!option) throw new Error("Pilihan referensi tidak tersedia. Periksa Tahun Ajaran, Tahun Buku, dan jenis tagihan.");
    return option.id;
  };
  const selection = {
    tahunAjaranId: choose(tahunAjaran, input.tahunAjaranId, tahunAjaran.find(row => row.aktif) || tahunAjaran[0]),
    tahunBukuId: choose(tahunBuku, input.tahunBukuId, tahunBuku.find(row => row.aktif) || tahunBuku[0]),
    jenisId: choose(jenis, input.jenisId, jenis.find(row => row.nama.trim().toUpperCase() === "UANG DAFTAR ULANG TK") || jenis[0]),
  };
  const [siswa, detail, pegawai, nikPegawai, kelas, penempatan, tarif] = await Promise.all([
    readAllRows<AnakPtkSource["siswa"][number]>((from, to) => admin.from("siswa").select("id,nama,nis,status,departemen_id,angkatan_id").eq("status", "aktif").order("id").range(from, to)),
    readAllRows<AnakPtkSource["detail"][number]>((from, to) => admin.from("siswa_detail").select("siswa_id,nik_ayah,nik_ibu").order("id").range(from, to)),
    readAllRows<AnakPtkSource["pegawai"][number]>((from, to) => admin.from("pegawai").select("id,nama,status").order("id").range(from, to)),
    readAllRows<AnakPtkSource["nikPegawai"][number]>((from, to) => admin.from("pegawai_nik").select("pegawai_id,nik").order("pegawai_id").range(from, to)),
    readAllRows<AnakPtkSource["kelas"][number]>((from, to) => admin.from("kelas").select("id,nama").order("id").range(from, to)),
    readAllRows<AnakPtkSource["penempatan"][number]>((from, to) => admin.from("kelas_siswa").select("siswa_id,kelas_id,tahun_ajaran_id,aktif").eq("aktif", true).eq("tahun_ajaran_id", selection.tahunAjaranId).order("id").range(from, to)),
    readAllRows<AnakPtkSource["tarif"][number]>((from, to) => admin.from("tarif_tagihan").select("id,jenis_id,siswa_id,kelas_id,tahun_ajaran_id,angkatan_id,aktif,nominal").eq("aktif", true).eq("jenis_id", selection.jenisId).order("id").range(from, to)),
  ]);
  return {
    ...buildAnakPtkReport({ siswa, detail, pegawai, nikPegawai, kelas, penempatan, tarif }, selection),
    selection, options: { tahunAjaran, tahunBuku, jenis, departemen }, dibacaPada: new Date().toISOString(),
  };
}
