/**
 * Server functions SPMB publik.
 *
 * Nama tabel/fungsi internal tetap `pmb*` untuk menjaga kompatibilitas data
 * dan integrasi pembayaran yang sudah berjalan. Istilah yang tampil ke pengguna
 * adalah SPMB (Sistem Penerimaan Murid Baru).
 */
import { createServerFn } from "@tanstack/react-start";
import { createAdminClient } from "./supabase";

const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const PMB_DOCUMENT_KINDS = ["kk", "akta", "rapor", "ijazah"] as const;
type PmbDocumentKind = (typeof PMB_DOCUMENT_KINDS)[number];

const UKURAN_BAJU_OPTIONS = ["S", "M", "L", "XL", "XXL", "X3L", "X4L", "X5L"] as const;
const TRANSPORTASI_OPTIONS = ["Mobil Pribadi", "Sepeda Motor", "Mobil/Bus Antar Jemput", "Sepeda", "Jalan Kaki", "Lainnya"] as const;
const PENDIDIKAN_OPTIONS = ["SD", "SMP", "SMA", "D3", "S1", "S2", "S3"] as const;
const PEKERJAAN_OPTIONS = ["PNS/TNI/POLRI", "KARYAWAN BUMN", "KARYAWAN SWASTA", "WIRASWASTA", "LAINNYA", "SUDAH MENINGGAL"] as const;
const PENGHASILAN_OPTIONS = [1000000, 2000000, 5000000, 20000000, 30000000] as const;
const KATEGORI_OPTIONS = ["MURID BARU", "MURID PINDAHAN"] as const;
const IQRO_OPTIONS = ["0", "1", "2", "3", "4", "5", "6", "7"] as const;
const LATIN_OPTIONS = ["BAIK", "CUKUP", "KURANG"] as const;
const HAFALAN_OPTIONS = ["0", "1", "2", "3"] as const;
const STATUS_ASRAMA_OPTIONS = ["asrama", "non_asrama"] as const;

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
    if (!PMB_DOCUMENT_KINDS.includes(kind)) throw new Error("Jenis dokumen SPMB tidak valid");

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
  nisn?: string;
  nik?: string;
  no_kk?: string;
  kategori?: string;
  status_asrama?: string;
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

function cleanChoice(value: unknown, allowed: readonly string[], label: string): string | null {
  const text = cleanText(value, 100);
  if (!text) return null;
  if (!allowed.includes(text)) throw new Error(`${label} tidak valid`);
  return text;
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

function cleanIncomeRange(value: unknown, label: string): number | null {
  const number = cleanNumber(value);
  if (number === null) return null;
  if (!PENGHASILAN_OPTIONS.includes(number as (typeof PENGHASILAN_OPTIONS)[number])) {
    throw new Error(`${label} harus dipilih dari rentang yang tersedia`);
  }
  return number;
}

function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeIdentityName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registrationDbError(error: { message?: string | null; code?: string | null } | null | undefined): Error {
  const message = error?.message || "Gagal menyimpan pendaftaran SPMB";
  if (message.includes("siswa_nisn_unique_nonempty")) {
    return new Error("NISN sudah terdaftar pada data siswa. Jika ini murid Hijrah At-Tauhid yang sedang melanjutkan jenjang, silakan coba lagi atau hubungi Admin TU untuk verifikasi data.");
  }
  if (message.includes("siswa_detail_nik_16_unique")) {
    return new Error("NIK Calon Murid sudah terdaftar pada data siswa. Silakan periksa kembali NIK atau hubungi Admin TU untuk verifikasi data.");
  }
  return new Error(message);
}

function validateDocumentPath(path: string | undefined, kind: PmbDocumentKind, required: boolean): string | null {
  const value = (path || "").trim();
  if (!value) {
    if (required) {
      const labels: Record<PmbDocumentKind, string> = {
        kk: "Kartu Keluarga",
        akta: "Akta Kelahiran",
        rapor: "Rapor",
        ijazah: "Ijazah / SKHUN",
      };
      throw new Error(`${labels[kind]} wajib diupload`);
    }
    return null;
  }
  const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedKind}/[0-9a-f-]+\\.(pdf|jpg|jpeg|png)$`, "i");
  if (!pattern.test(value)) throw new Error("Path dokumen SPMB tidak valid");
  return value;
}

function kodeDepartemen(dept: { kode?: string | null; nama?: string | null }): string {
  const kode = (dept.kode || "").trim().toUpperCase();
  if (["TK", "SD", "SMP", "SMA", "MTA"].includes(kode)) return kode;
  const match = (dept.nama || "").trim().toUpperCase().match(/(^|\s)(TK|SD|SMP|SMA|MTA)(\s|$)/);
  return match?.[2] || "";
}

function departemenPerluAsrama(dept: { kode?: string | null; nama?: string | null }): boolean {
  return ["SMP", "SMA", "MTA"].includes(kodeDepartemen(dept));
}

function departemenPerluNisn(dept: { kode?: string | null; nama?: string | null }): boolean {
  return ["SMP", "SMA", "MTA"].includes(kodeDepartemen(dept));
}

export const pmbDaftar = createServerFn({ method: "POST" })
  .inputValidator((d: PmbDaftarInput) => d)
  .handler(async ({ data }): Promise<PmbDaftarResult> => {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data: currentWave, error: waveError } = await (admin
      .from("spmb_gelombang") as any)
      .select("id,nama,gratis_pendaftaran")
      .eq("aktif", true)
      .lte("tanggal_mulai", now)
      .or(`tanggal_selesai.is.null,tanggal_selesai.gt.${now}`)
      .order("urutan")
      .order("tanggal_mulai")
      .limit(1)
      .maybeSingle();

    if (waveError) throw new Error(waveError.message);
    if (!currentWave) {
      throw new Error("Pendaftaran SPMB sedang ditutup. Silakan lihat jadwal gelombang berikutnya.");
    }
    const nama = (data.nama || "").trim();
    const departemen_id = (data.departemen_id || "").trim();
    const angkatan_id = (data.angkatan_id || "").trim() || null;
    const tahun_ajaran_id = (data.tahun_ajaran_id || "").trim() || null;
    const kategori = cleanChoice(data.kategori, KATEGORI_OPTIONS, "Kategori") || "MURID BARU";
    const jenis_pendaftaran = kategori === "MURID PINDAHAN" ? "pindahan" : "baru";
    const isTransfer = kategori === "MURID PINDAHAN";

    if (!nama || nama.length < 2 || nama.length > 200) throw new Error("Nama lengkap wajib diisi (2-200 karakter)");
    if (!departemen_id) throw new Error("Departemen/lembaga wajib dipilih");
    if (!cleanText(data.alamat, 500)) throw new Error("Alamat rumah wajib diisi");
    if (!cleanText(data.telepon, 20)) throw new Error("No. HP/WhatsApp yang bisa dihubungi wajib diisi");

    const dokumenKkPath = validateDocumentPath(data.dokumen_kk_path, "kk", true);
    const dokumenAktaPath = validateDocumentPath(data.dokumen_akta_path, "akta", true);
    const dokumenRaporPath = validateDocumentPath(data.dokumen_rapor_path, "rapor", isTransfer);
    const dokumenIjazahPath = validateDocumentPath(data.dokumen_ijazah_path, "ijazah", isTransfer);

    const { data: dept } = await admin.from("departemen")
      .select("id, nama, kode")
      .eq("id", departemen_id)
      .eq("aktif", true)
      .eq("kategori", "unit_pendidikan")
      .eq("psb_dibuka", true)
      .single();
    if (!dept) throw new Error("Departemen tidak valid atau SPMB belum dibuka untuk lembaga ini");

    const deptCode = kodeDepartemen(dept);
    const perluAsrama = departemenPerluAsrama(dept);
    const perluNisn = departemenPerluNisn(dept);
    const nisn = cleanText(data.nisn, 10);
    if (perluNisn && !/^\d{10}$/.test(nisn || "")) {
      throw new Error("NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA");
    }
    const nik = normalizeDigits(data.nik);
    if (!/^\d{16}$/.test(nik)) {
      throw new Error("NIK Calon Murid harus terdiri dari 16 digit");
    }

    let statusAsrama = perluAsrama
      ? cleanChoice(data.status_asrama, STATUS_ASRAMA_OPTIONS, "Pilihan asrama")
      : null;
    if (deptCode === "MTA") statusAsrama = "asrama";
    if (perluAsrama && !statusAsrama) throw new Error("Pilihan Asrama / Non Asrama wajib dipilih untuk SMP atau SMA");

    if (angkatan_id) {
      const { data: angkatan, error } = await admin.from("angkatan").select("id").eq("id", angkatan_id).eq("departemen_id", departemen_id).eq("aktif", true).maybeSingle();
      if (error || !angkatan) throw new Error("Angkatan tidak valid untuk lembaga yang dipilih");
    }

    if (tahun_ajaran_id) {
      const { data: tahunAjaran, error } = await admin.from("tahun_ajaran").select("id").eq("id", tahun_ajaran_id).maybeSingle();
      if (error || !tahunAjaran) throw new Error("Periode tahun ajaran tidak valid");
    }

    const ukuranBaju = cleanChoice(data.ukuran_baju, UKURAN_BAJU_OPTIONS, "Ukuran baju");
    const transportasi = cleanChoice(data.transportasi, TRANSPORTASI_OPTIONS, "Transportasi");
    const pendidikanAyah = cleanChoice(data.pendidikan_ayah, PENDIDIKAN_OPTIONS, "Pendidikan ayah");
    const pendidikanIbu = cleanChoice(data.pendidikan_ibu, PENDIDIKAN_OPTIONS, "Pendidikan ibu");
    const pekerjaanAyah = cleanChoice(data.pekerjaan_ayah, PEKERJAAN_OPTIONS, "Pekerjaan ayah");
    const pekerjaanIbu = cleanChoice(data.pekerjaan_ibu, PEKERJAAN_OPTIONS, "Pekerjaan ibu");
    const penghasilanAyah = cleanIncomeRange(data.penghasilan_ayah, "Penghasilan ayah");
    const penghasilanIbu = cleanIncomeRange(data.penghasilan_ibu, "Penghasilan ibu");
    const kemampuanIqro = cleanChoice(data.kemampuan_iqro, IQRO_OPTIONS, "Kemampuan Iqro");
    const membacaLatin = cleanChoice(data.membaca_latin, LATIN_OPTIONS, "Kemampuan membaca Latin");
    const menulisLatin = cleanChoice(data.menulis_latin, LATIN_OPTIONS, "Kemampuan menulis Latin");
    const hafalanQuran = cleanChoice(data.hafalan_quran, HAFALAN_OPTIONS, "Hafalan Qur'an");

    const requiredParentValues = [
      ["Nama Ayah", data.nama_ayah],
      ["NIK Ayah", data.nik_ayah],
      ["Tempat lahir Ayah", data.tempat_lahir_ayah],
      ["Tanggal lahir Ayah", data.tanggal_lahir_ayah],
      ["Pendidikan Ayah", data.pendidikan_ayah],
      ["Pekerjaan Ayah", data.pekerjaan_ayah],
      ["Penghasilan Ayah", data.penghasilan_ayah],
      ["No. HP/WA Ayah", data.telepon_ayah],
      ["Alamat Ayah", data.alamat_ayah],
      ["Nama Ibu", data.nama_ibu],
      ["NIK Ibu", data.nik_ibu],
      ["Tempat lahir Ibu", data.tempat_lahir_ibu],
      ["Tanggal lahir Ibu", data.tanggal_lahir_ibu],
      ["Pendidikan Ibu", data.pendidikan_ibu],
      ["Pekerjaan Ibu", data.pekerjaan_ibu],
      ["Penghasilan Ibu", data.penghasilan_ibu],
      ["No. HP/WA Ibu", data.telepon_ibu],
      ["Alamat Ibu", data.alamat_ibu],
    ] as const;
    const missingParent = requiredParentValues.find(([, value]) => value === null || value === undefined || String(value).trim() === "");
    if (missingParent) throw new Error(`${missingParent[0]} wajib diisi`);
    if (!/^\d{16}$/.test(String(data.nik_ayah || "").replace(/\D/g, ""))) throw new Error("NIK Ayah harus 16 digit");
    if (!/^\d{16}$/.test(String(data.nik_ibu || "").replace(/\D/g, ""))) throw new Error("NIK Ibu harus 16 digit");

    let nisnOwner: any = null;
    if (nisn) {
      const lookup = await (admin.from("siswa") as any)
        .select("id,nama,jenis_kelamin,tempat_lahir,tanggal_lahir,nisn,status,alamat,telepon,departemen_id,angkatan_id")
        .eq("nisn", nisn)
        .maybeSingle();
      if (lookup.error) throw new Error(lookup.error.message);
      nisnOwner = lookup.data;
    }

    const nikLookup = await (admin.from("siswa_detail") as any)
      .select("siswa_id")
      .eq("nik", nik)
      .maybeSingle();
    if (nikLookup.error) throw new Error(nikLookup.error.message);

    if (nisnOwner?.id && nikLookup.data?.siswa_id && nisnOwner.id !== nikLookup.data.siswa_id) {
      throw new Error("NISN dan NIK mengarah ke data siswa yang berbeda. Silakan hubungi Admin TU untuk verifikasi identitas.");
    }

    const existingSiswaId = nisnOwner?.id || nikLookup.data?.siswa_id || null;
    let existingSiswa: any = nisnOwner;
    let existingDetail: any = null;

    if (existingSiswaId) {
      if (!existingSiswa) {
        const lookup = await (admin.from("siswa") as any)
          .select("id,nama,jenis_kelamin,tempat_lahir,tanggal_lahir,nisn,status,alamat,telepon,departemen_id,angkatan_id")
          .eq("id", existingSiswaId)
          .maybeSingle();
        if (lookup.error) throw new Error(lookup.error.message);
        existingSiswa = lookup.data;
      }

      const detailLookup = await (admin.from("siswa_detail") as any)
        .select("id,siswa_id,nik,tahun_ajaran_id,pmb_payment_token,spmb_gelombang_id,spmb_departemen_tujuan_id,spmb_angkatan_tujuan_id,spmb_siswa_internal")
        .eq("siswa_id", existingSiswaId)
        .maybeSingle();
      if (detailLookup.error) throw new Error(detailLookup.error.message);
      existingDetail = detailLookup.data;

      const existingNik = normalizeDigits(existingDetail?.nik);
      const submittedGender = data.jenis_kelamin === "P" ? "P" : "L";
      const birthMismatch = Boolean(
        existingSiswa?.tanggal_lahir &&
        data.tanggal_lahir &&
        existingSiswa.tanggal_lahir !== data.tanggal_lahir
      );
      const genderMismatch = Boolean(
        existingSiswa?.jenis_kelamin &&
        existingSiswa.jenis_kelamin !== submittedGender
      );
      const nisnMismatch = Boolean(
        nisn &&
        existingSiswa?.nisn &&
        existingSiswa.nisn !== nisn
      );
      const nikMismatch = existingNik.length === 16 && existingNik !== nik;
      const fallbackIdentityMismatch = existingNik.length !== 16 && (
        !existingSiswa?.tanggal_lahir ||
        !data.tanggal_lahir ||
        existingSiswa.tanggal_lahir !== data.tanggal_lahir ||
        normalizeIdentityName(existingSiswa?.nama) !== normalizeIdentityName(nama)
      );

      if (birthMismatch || genderMismatch || nisnMismatch || nikMismatch || fallbackIdentityMismatch) {
        throw new Error("NISN/NIK sudah terdaftar, tetapi data identitas tidak cocok dengan data sekolah. Silakan hubungi Admin TU untuk verifikasi.");
      }

      const existingTargetDept = existingDetail?.spmb_departemen_tujuan_id || existingSiswa?.departemen_id || null;
      const sameCurrentRegistration = Boolean(
        existingDetail?.pmb_payment_token &&
        existingDetail?.spmb_gelombang_id === currentWave.id &&
        existingTargetDept === departemen_id &&
        existingDetail?.tahun_ajaran_id === tahun_ajaran_id
      );
      if (sameCurrentRegistration) {
        return {
          success: true,
          siswa_id: existingSiswaId,
          payment_token: existingDetail.pmb_payment_token,
        };
      }
      if (existingDetail?.pmb_payment_token && existingDetail?.spmb_gelombang_id === currentWave.id) {
        throw new Error("Data siswa ini sudah memiliki pendaftaran pada gelombang yang sedang berjalan. Silakan hubungi Admin TU bila tujuan lembaganya perlu diubah.");
      }
      if (existingSiswa?.status !== "aktif") {
        throw new Error("Data siswa sudah terdaftar di sistem tetapi status akademiknya perlu diverifikasi Admin TU sebelum digunakan untuk pendaftaran jenjang berikutnya.");
      }

      const studentPatch: Record<string, unknown> = {};
      if (!existingSiswa.nisn && nisn) studentPatch.nisn = nisn;
      if (!cleanText(existingSiswa.alamat, 500)) studentPatch.alamat = cleanText(data.alamat, 500);
      if (!cleanText(existingSiswa.telepon, 20)) studentPatch.telepon = cleanText(data.telepon, 20);
      if (!existingSiswa.tanggal_lahir && data.tanggal_lahir) studentPatch.tanggal_lahir = data.tanggal_lahir;
      if (!cleanText(existingSiswa.tempat_lahir, 100)) studentPatch.tempat_lahir = cleanText(data.tempat_lahir, 100);
      if (Object.keys(studentPatch).length) {
        const patchResult = await (admin.from("siswa") as any).update(studentPatch).eq("id", existingSiswaId);
        if (patchResult.error) throw registrationDbError(patchResult.error);
      }
    }

    const paymentToken = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const detailPayload = {
      tahun_ajaran_id,
      nik,
      no_kk: cleanText(data.no_kk, 32),
      kategori,
      status_asrama: statusAsrama,
      anak_ke: cleanInteger(data.anak_ke),
      jumlah_bersaudara: cleanInteger(data.jumlah_bersaudara),
      tinggi_badan_cm: cleanNumber(data.tinggi_badan_cm),
      berat_badan_kg: cleanNumber(data.berat_badan_kg),
      lingkar_kepala_cm: cleanNumber(data.lingkar_kepala_cm),
      ukuran_baju: ukuranBaju,
      penyakit_pernah_diderita: cleanText(data.penyakit_pernah_diderita, 500),
      jarak_rumah_km: cleanNumber(data.jarak_rumah_km),
      waktu_perjalanan_menit: cleanInteger(data.waktu_perjalanan_menit),
      transportasi,
      nama_ayah: cleanText(data.nama_ayah, 200),
      nik_ayah: normalizeDigits(data.nik_ayah),
      tempat_lahir_ayah: cleanText(data.tempat_lahir_ayah, 100),
      tanggal_lahir_ayah: data.tanggal_lahir_ayah || null,
      pendidikan_ayah: pendidikanAyah,
      pekerjaan_ayah: pekerjaanAyah,
      penghasilan_ayah: penghasilanAyah,
      telepon_ayah: cleanText(data.telepon_ayah, 20),
      alamat_ayah: cleanText(data.alamat_ayah, 500),
      nama_ibu: cleanText(data.nama_ibu, 200),
      nik_ibu: normalizeDigits(data.nik_ibu),
      tempat_lahir_ibu: cleanText(data.tempat_lahir_ibu, 100),
      tanggal_lahir_ibu: data.tanggal_lahir_ibu || null,
      pendidikan_ibu: pendidikanIbu,
      pekerjaan_ibu: pekerjaanIbu,
      penghasilan_ibu: penghasilanIbu,
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
      kemampuan_iqro: kemampuanIqro,
      membaca_latin: membacaLatin,
      menulis_latin: menulisLatin,
      hafalan_quran: hafalanQuran,
      dokumen_kk_path: dokumenKkPath,
      dokumen_akta_path: dokumenAktaPath,
      dokumen_rapor_path: dokumenRaporPath,
      dokumen_ijazah_path: dokumenIjazahPath,
      pmb_payment_token: paymentToken,
      pendaftaran_id: registrationId,
      spmb_gelombang_id: currentWave.id,
      spmb_registered_at: now,
      spmb_departemen_tujuan_id: departemen_id,
      spmb_angkatan_tujuan_id: angkatan_id,
      spmb_status_pendaftaran: "calon",
    };

    if (existingSiswaId) {
      if (existingDetail?.id) {
        const updateResult = await (admin.from("siswa_detail") as any)
          .update({ ...detailPayload, spmb_siswa_internal: true })
          .eq("id", existingDetail.id);
        if (updateResult.error) throw registrationDbError(updateResult.error);
      } else {
        const insertResult = await (admin.from("siswa_detail") as any).insert({
          siswa_id: existingSiswaId,
          ...detailPayload,
          spmb_siswa_internal: true,
        });
        if (insertResult.error) throw registrationDbError(insertResult.error);
      }

      return { success: true, siswa_id: existingSiswaId, payment_token: paymentToken };
    }

    const { data: siswa, error: siswaError } = await (admin.from("siswa") as any).insert({
      nama,
      jenis_kelamin: data.jenis_kelamin === "P" ? "P" : "L",
      tempat_lahir: cleanText(data.tempat_lahir, 100),
      tanggal_lahir: data.tanggal_lahir || null,
      nisn: perluNisn ? nisn : null,
      alamat: cleanText(data.alamat, 500),
      telepon: cleanText(data.telepon, 20),
      agama: "Islam",
      status: "calon",
      departemen_id,
      angkatan_id,
    }).select("id").single();
    if (siswaError) throw registrationDbError(siswaError);

    const { error: detailError } = await (admin.from("siswa_detail") as any).insert({
      siswa_id: siswa.id,
      ...detailPayload,
      spmb_siswa_internal: false,
    });

    if (detailError) {
      await admin.from("siswa").delete().eq("id", siswa.id);
      throw registrationDbError(detailError);
    }
    return { success: true, siswa_id: siswa.id, payment_token: paymentToken };
  });
