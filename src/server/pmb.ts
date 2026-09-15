/**
 * Server functions PMB publik.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";

const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const PMB_DOCUMENT_KINDS = ["kk", "akta", "rapor", "ijazah"] as const;
type PmbDocumentKind = (typeof PMB_DOCUMENT_KINDS)[number];

export interface PmbOptionsResult {
  departemen: { id: string; nama: string; kode: string | null }[];
  angkatan: { id: string; nama: string; departemen_id: string | null }[];
  tahun_ajaran: { id: string; nama: string; aktif: boolean | null }[];
}

export const pmbOptions = createServerFn({ method: "GET" }).handler(
  async (): Promise<PmbOptionsResult> => {
    const admin = createAdminClient();
    const [deptRes, angkatanRes, tahunAjaranRes] = await Promise.all([
      admin.from("departemen").select("id, nama, kode").eq("aktif", true).eq("kategori", "unit_pendidikan").eq("psb_dibuka", true).order("nama"),
      admin.from("angkatan").select("id, nama, departemen_id").eq("aktif", true).order("nama", { ascending: false }),
      admin.from("tahun_ajaran").select("id, nama, aktif").order("tanggal_mulai", { ascending: false }),
    ]);
    if (deptRes.error) throw new Error(deptRes.error.message);
    if (angkatanRes.error) throw new Error(angkatanRes.error.message);
    if (tahunAjaranRes.error) throw new Error(tahunAjaranRes.error.message);
    return {
      departemen: deptRes.data || [],
      angkatan: angkatanRes.data || [],
      tahun_ajaran: tahunAjaranRes.data || [],
    };
  }
);

interface PmbDocumentUploadInput {
  kind: PmbDocumentKind;
  file_name: string;
}

export interface PmbDocumentUploadResult {
  path: string;
  token: string;
}

export const pmbCreateDocumentUpload = createServerFn({ method: "POST" })
  .inputValidator((d: PmbDocumentUploadInput) => d)
  .handler(async ({ data }): Promise<PmbDocumentUploadResult> => {
    const kind = data.kind;
    if (!PMB_DOCUMENT_KINDS.includes(kind)) throw new Error("Jenis dokumen PMB tidak valid");

    const ext = (data.file_name || "").split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      throw new Error("Dokumen harus berupa PDF, JPG, JPEG, atau PNG");
    }

    const admin = createAdminClient();
    const path = `${kind}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await admin.storage.from(PMB_DOCUMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !signed?.token) throw new Error(error?.message || "Gagal menyiapkan upload dokumen");
    return { path, token: signed.token };
  });

export interface PmbDaftarInput {
  nama: string;
  departemen_id: string;
  angkatan_id?: string;
  tahun_ajaran_id?: string;
  jenis_pendaftaran?: string;
  jenis_kelamin?: string;
  tempat_lahir?: string;
  tanggal_lahir?: string;
  alamat?: string;
  telepon?: string;
  nik?: string;
  no_kk?: string;
  kategori?: string;
  anak_ke?: string | number;
  jumlah_bersaudara?: string | number;
  tinggi_badan_cm?: string | number;
  berat_badan_kg?: string | number;
  lingkar_kepala_cm?: string | number;
  ukuran_baju?: string;
  penyakit_pernah_diderita?: string;
  jarak_rumah_km?: string | number;
  waktu_perjalanan_menit?: string | number;
  transportasi?: string;
  nama_ayah?: string;
  nik_ayah?: string;
  tempat_lahir_ayah?: string;
  tanggal_lahir_ayah?: string;
  pendidikan_ayah?: string;
  pekerjaan_ayah?: string;
  penghasilan_ayah?: string | number;
  telepon_ayah?: string;
  alamat_ayah?: string;
  nama_ibu?: string;
  nik_ibu?: string;
  tempat_lahir_ibu?: string;
  tanggal_lahir_ibu?: string;
  pendidikan_ibu?: string;
  pekerjaan_ibu?: string;
  penghasilan_ibu?: string | number;
  telepon_ibu?: string;
  alamat_ibu?: string;
  telepon_ortu?: string;
  alamat_ortu?: string;
  asal_sekolah?: string;
  kelas_terakhir?: string;
  alasan_pindah?: string;
  alamat_sekolah_asal?: string;
  kabupaten_sekolah_asal?: string;
  kecamatan_sekolah_asal?: string;
  kelurahan_sekolah_asal?: string;
  kemampuan_iqro?: string;
  membaca_latin?: string;
  menulis_latin?: string;
  hafalan_quran?: string;
  dokumen_kk_path?: string;
  dokumen_akta_path?: string;
  dokumen_rapor_path?: string;
  dokumen_ijazah_path?: string;
}

export interface PmbDaftarResult {
  success: true;
  siswa_id: string;
  payment_token: string;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : null;
}

function cleanNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanInteger(value: unknown): number | null {
  const number = cleanNumber(value);
  return number === null ? null : Math.trunc(number);
}

function validateDocumentPath(path: string | undefined, kind: PmbDocumentKind, required: boolean): string | null {
  const value = (path || "").trim();
  if (!value) {
    if (required) throw new Error(kind === "kk" ? "Kartu Keluarga wajib diupload" : "Akta Kelahiran wajib diupload");
    return null;
  }
  const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedKind}/[0-9a-f-]+\\.(pdf|jpg|jpeg|png)$`, "i");
  if (!pattern.test(value)) throw new Error("Path dokumen PMB tidak valid");
  return value;
}

export const pmbDaftar = createServerFn({ method: "POST" })
  .inputValidator((d: PmbDaftarInput) => d)
  .handler(async ({ data }): Promise<PmbDaftarResult> => {
    const admin = createAdminClient();
    const nama = (data.nama || "").trim();
    const departemen_id = (data.departemen_id || "").trim();
    const angkatan_id = (data.angkatan_id || "").trim() || null;
    const tahun_ajaran_id = (data.tahun_ajaran_id || "").trim() || null;
    const jenis_pendaftaran = ["baru", "pindahan", "alumni_internal"].includes(data.jenis_pendaftaran || "") ? data.jenis_pendaftaran! : "baru";

    if (!nama || nama.length < 2 || nama.length > 200) throw new Error("Nama lengkap wajib diisi (2-200 karakter)");
    if (!departemen_id) throw new Error("Departemen/lembaga wajib dipilih");

    const dokumenKkPath = validateDocumentPath(data.dokumen_kk_path, "kk", true);
    const dokumenAktaPath = validateDocumentPath(data.dokumen_akta_path, "akta", true);
    const dokumenRaporPath = validateDocumentPath(data.dokumen_rapor_path, "rapor", false);
    const dokumenIjazahPath = validateDocumentPath(data.dokumen_ijazah_path, "ijazah", false);

    const { data: dept } = await admin.from("departemen").select("id").eq("id", departemen_id).eq("aktif", true).eq("kategori", "unit_pendidikan").eq("psb_dibuka", true).single();
    if (!dept) throw new Error("Departemen tidak valid atau PMB belum dibuka untuk lembaga ini");

    if (angkatan_id) {
      const { data: angkatan, error } = await admin.from("angkatan").select("id").eq("id", angkatan_id).eq("departemen_id", departemen_id).eq("aktif", true).maybeSingle();
      if (error || !angkatan) throw new Error("Angkatan tidak valid untuk lembaga yang dipilih");
    }

    if (tahun_ajaran_id) {
      const { data: tahunAjaran, error } = await admin.from("tahun_ajaran").select("id").eq("id", tahun_ajaran_id).maybeSingle();
      if (error || !tahunAjaran) throw new Error("Periode tahun ajaran tidak valid");
    }

    const { data: siswa, error: siswaError } = await admin.from("siswa").insert({
      nama,
      jenis_kelamin: data.jenis_kelamin === "P" ? "P" : "L",
      tempat_lahir: cleanText(data.tempat_lahir, 100),
      tanggal_lahir: data.tanggal_lahir || null,
      alamat: cleanText(data.alamat, 500),
      telepon: cleanText(data.telepon, 20),
      agama: "Islam",
      status: "calon",
      departemen_id,
      angkatan_id,
    }).select("id").single();
    if (siswaError) throw new Error(siswaError.message);

    const paymentToken = crypto.randomUUID();
    const { error: detailError } = await (admin.from("siswa_detail") as any).insert({
      siswa_id: siswa.id,
      tahun_ajaran_id,
      nik: cleanText(data.nik, 32),
      no_kk: cleanText(data.no_kk, 32),
      kategori: cleanText(data.kategori, 100),
      anak_ke: cleanInteger(data.anak_ke),
      jumlah_bersaudara: cleanInteger(data.jumlah_bersaudara),
      tinggi_badan_cm: cleanNumber(data.tinggi_badan_cm),
      berat_badan_kg: cleanNumber(data.berat_badan_kg),
      lingkar_kepala_cm: cleanNumber(data.lingkar_kepala_cm),
      ukuran_baju: cleanText(data.ukuran_baju, 50),
      penyakit_pernah_diderita: cleanText(data.penyakit_pernah_diderita, 500),
      jarak_rumah_km: cleanNumber(data.jarak_rumah_km),
      waktu_perjalanan_menit: cleanInteger(data.waktu_perjalanan_menit),
      transportasi: cleanText(data.transportasi, 100),
      nama_ayah: cleanText(data.nama_ayah, 200),
      nik_ayah: cleanText(data.nik_ayah, 32),
      tempat_lahir_ayah: cleanText(data.tempat_lahir_ayah, 100),
      tanggal_lahir_ayah: data.tanggal_lahir_ayah || null,
      pendidikan_ayah: cleanText(data.pendidikan_ayah, 100),
      pekerjaan_ayah: cleanText(data.pekerjaan_ayah, 100),
      penghasilan_ayah: cleanNumber(data.penghasilan_ayah),
      telepon_ayah: cleanText(data.telepon_ayah, 20),
      alamat_ayah: cleanText(data.alamat_ayah, 500),
      nama_ibu: cleanText(data.nama_ibu, 200),
      nik_ibu: cleanText(data.nik_ibu, 32),
      tempat_lahir_ibu: cleanText(data.tempat_lahir_ibu, 100),
      tanggal_lahir_ibu: data.tanggal_lahir_ibu || null,
      pendidikan_ibu: cleanText(data.pendidikan_ibu, 100),
      pekerjaan_ibu: cleanText(data.pekerjaan_ibu, 100),
      penghasilan_ibu: cleanNumber(data.penghasilan_ibu),
      telepon_ibu: cleanText(data.telepon_ibu, 20),
      alamat_ibu: cleanText(data.alamat_ibu, 500),
      telepon_ortu: cleanText(data.telepon_ortu, 20),
      alamat_ortu: cleanText(data.alamat_ortu, 500),
      jenis_pendaftaran,
      asal_sekolah: cleanText(data.asal_sekolah, 200),
      kelas_terakhir: jenis_pendaftaran !== "baru" ? cleanText(data.kelas_terakhir, 50) : null,
      alasan_pindah: jenis_pendaftaran === "pindahan" ? cleanText(data.alasan_pindah, 500) : null,
      alamat_sekolah_asal: cleanText(data.alamat_sekolah_asal, 500),
      kabupaten_sekolah_asal: cleanText(data.kabupaten_sekolah_asal, 100),
      kecamatan_sekolah_asal: cleanText(data.kecamatan_sekolah_asal, 100),
      kelurahan_sekolah_asal: cleanText(data.kelurahan_sekolah_asal, 100),
      kemampuan_iqro: cleanText(data.kemampuan_iqro, 100),
      membaca_latin: cleanText(data.membaca_latin, 100),
      menulis_latin: cleanText(data.menulis_latin, 100),
      hafalan_quran: cleanText(data.hafalan_quran, 200),
      dokumen_kk_path: dokumenKkPath,
      dokumen_akta_path: dokumenAktaPath,
      dokumen_rapor_path: dokumenRaporPath,
      dokumen_ijazah_path: dokumenIjazahPath,
      pmb_payment_token: paymentToken,
    });

    if (detailError) {
      await admin.from("siswa").delete().eq("id", siswa.id);
      throw new Error(detailError.message);
    }
    return { success: true, siswa_id: siswa.id, payment_token: paymentToken };
  });
