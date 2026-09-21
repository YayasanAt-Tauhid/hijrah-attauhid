import * as XLSX from "xlsx";

export type ImportCell = string | number | boolean | null | undefined;

export interface SiswaImportRow {
  siswa_id?: ImportCell; nis?: ImportCell; nisn?: ImportCell; nama?: ImportCell; jenis_kelamin?: ImportCell;
  tempat_lahir?: ImportCell; tanggal_lahir?: ImportCell; agama?: ImportCell; alamat?: ImportCell;
  telepon?: ImportCell; email?: ImportCell; status?: ImportCell; departemen?: ImportCell;
  tingkat?: ImportCell; kelas?: ImportCell; tahun_ajaran?: ImportCell; angkatan?: ImportCell;
  periode_pendaftaran?: ImportCell; jenis_pendaftaran?: ImportCell; nik?: ImportCell; nik_dapodik?: ImportCell; no_kk?: ImportCell;
  kategori?: ImportCell; status_asrama?: ImportCell; anak_ke?: ImportCell; jumlah_bersaudara?: ImportCell;
  tinggi_badan_cm?: ImportCell; berat_badan_kg?: ImportCell; lingkar_kepala_cm?: ImportCell; ukuran_baju?: ImportCell;
  penyakit_pernah_diderita?: ImportCell; jarak_rumah_km?: ImportCell; waktu_perjalanan_menit?: ImportCell; transportasi?: ImportCell;
  nama_ayah?: ImportCell; nik_ayah?: ImportCell; tempat_lahir_ayah?: ImportCell; tanggal_lahir_ayah?: ImportCell;
  pendidikan_ayah?: ImportCell; pekerjaan_ayah?: ImportCell; penghasilan_ayah?: ImportCell; telepon_ayah?: ImportCell; alamat_ayah?: ImportCell;
  nama_ibu?: ImportCell; nik_ibu?: ImportCell; tempat_lahir_ibu?: ImportCell; tanggal_lahir_ibu?: ImportCell;
  pendidikan_ibu?: ImportCell; pekerjaan_ibu?: ImportCell; penghasilan_ibu?: ImportCell; telepon_ibu?: ImportCell; alamat_ibu?: ImportCell;
  telepon_ortu?: ImportCell; alamat_ortu?: ImportCell; asal_sekolah?: ImportCell; alamat_sekolah_asal?: ImportCell;
  kabupaten_sekolah_asal?: ImportCell; kecamatan_sekolah_asal?: ImportCell; kelurahan_sekolah_asal?: ImportCell;
  kelas_terakhir?: ImportCell; alasan_pindah?: ImportCell; kemampuan_iqro?: ImportCell; membaca_latin?: ImportCell;
  menulis_latin?: ImportCell; hafalan_quran?: ImportCell;
  [key: string]: ImportCell;
}

export interface DepartemenRef { id: string; nama: string; kode?: string | null }
export interface TingkatRef { id: string; nama: string; departemen_id: string | null }
export interface KelasRef { id: string; nama: string; tingkat_id: string | null; departemen_id: string | null }
export interface TahunAjaranRef { id: string; nama: string }
export interface AngkatanRef { id: string; nama: string; departemen_id: string | null }
export interface ImportReferences {
  departemenList: DepartemenRef[]; tingkatList: TingkatRef[]; kelasList: KelasRef[];
  tahunAjaranList: TahunAjaranRef[]; angkatanList: AngkatanRef[];
}
export interface ExistingStudentForImport {
  id: string; nis: string | null; nisn?: string | null; status: string | null; departemen_id: string | null;
  nik?: string | null; nik_dapodik?: string | null; spmb_gelombang_id?: string | null; spmb_siswa_internal?: boolean | null;
}
export interface PreparedImportRow {
  rowNumber: number; raw: SiswaImportRow; action: "insert" | "update" | "adopt_spmb"; existingId?: string; errors: string[];
  siswaPayload: Record<string, unknown>; detailPayload: Record<string, unknown>;
  kelasPayload: { kelas_id: string; tahun_ajaran_id: string } | null;
}

const VALID_STATUS = new Set(["calon", "diterima", "aktif", "alumni", "pindah", "keluar"]);
const VALID_JENIS_PENDAFTARAN = new Set(["baru", "pindahan", "alumni_internal"]);
const VALID_STATUS_ASRAMA = new Set(["asrama", "non_asrama"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IMPORT_COLUMNS = [
  "siswa_id", "nis", "nisn", "nama", "jenis_kelamin", "tempat_lahir", "tanggal_lahir", "agama", "alamat", "telepon", "email", "status",
  "departemen", "tingkat", "kelas", "tahun_ajaran", "angkatan",
  "periode_pendaftaran", "jenis_pendaftaran", "nik", "nik_dapodik", "no_kk", "kategori", "status_asrama",
  "anak_ke", "jumlah_bersaudara", "tinggi_badan_cm", "berat_badan_kg", "lingkar_kepala_cm", "ukuran_baju",
  "penyakit_pernah_diderita", "jarak_rumah_km", "waktu_perjalanan_menit", "transportasi",
  "nama_ayah", "nik_ayah", "tempat_lahir_ayah", "tanggal_lahir_ayah", "pendidikan_ayah", "pekerjaan_ayah", "penghasilan_ayah", "telepon_ayah", "alamat_ayah",
  "nama_ibu", "nik_ibu", "tempat_lahir_ibu", "tanggal_lahir_ibu", "pendidikan_ibu", "pekerjaan_ibu", "penghasilan_ibu", "telepon_ibu", "alamat_ibu",
  "asal_sekolah", "alamat_sekolah_asal", "kabupaten_sekolah_asal", "kecamatan_sekolah_asal", "kelurahan_sekolah_asal",
  "kelas_terakhir", "alasan_pindah", "kemampuan_iqro", "membaca_latin", "menulis_latin", "hafalan_quran",
] as const;

const TEXT_SENSITIVE_COLUMNS = new Set(["siswa_id", "nis", "nisn", "nik", "nik_dapodik", "no_kk", "nik_ayah", "nik_ibu", "telepon", "telepon_ayah", "telepon_ibu"]);

export function normalize(value: unknown): string { return (value ?? "").toString().trim(); }
function normalizeKey(value: unknown): string { return normalize(value).toLocaleLowerCase("id-ID"); }
function validDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function dateToISO(value: ImportCell): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed || !validDateParts(parsed.y, parsed.m, parsed.d)) return null;
    return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = normalize(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (!validDateParts(year, month, day)) return null;
    return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  if (!validDateParts(year, month, day)) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findUniqueByName<T extends { nama: string }>(list: T[], value: unknown): { item?: T; ambiguous: boolean } {
  const key = normalizeKey(value); if (!key) return { ambiguous: false };
  const matches = list.filter((item) => normalizeKey(item.nama) === key);
  return { item: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1 };
}
function addString(payload: Record<string, unknown>, key: string, value: ImportCell, insert: boolean) {
  const text = normalize(value); if (text) payload[key] = text; else if (insert) payload[key] = null;
}
function parseNumber(value: ImportCell, label: string, errors: string[], integer = false): number | null {
  if (!normalize(value)) return null;
  const parsed = typeof value === "number" ? value : Number(normalize(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    errors.push(`${label} harus berupa ${integer ? "bilangan bulat" : "angka"} non-negatif`); return null;
  }
  return parsed;
}
function validateLegacyNik(value: ImportCell, errors: string[]) {
  if (!normalize(value)) return;
  if (typeof value === "number") {
    errors.push("NIK Hijrah harus disimpan sebagai teks di Excel agar nilai legacy tidak berubah");
  }
}
function validateIdentityNumber(value: ImportCell, label: string, errors: string[]) {
  if (!normalize(value)) return;
  if (typeof value === "number") { errors.push(`${label} harus 16 digit dan disimpan sebagai teks di Excel`); return; }
  if (!/^\d{16}$/.test(normalize(value))) errors.push(`${label} harus tepat 16 digit`);
}
function validateNis(value: ImportCell, errors: string[]) {
  const text = normalize(value);
  if (!text) return;
  if (text.length > 13) errors.push("NIS maksimal 13 karakter");
}
function validateNisn(value: ImportCell, errors: string[]) {
  if (!normalize(value)) return;
  if (typeof value === "number") { errors.push("NISN harus 10 digit dan disimpan sebagai teks di Excel"); return; }
  if (!/^\d{10}$/.test(normalize(value))) errors.push("NISN harus tepat 10 digit");
}
function isAsramaDepartment(dept: DepartemenRef | undefined): boolean {
  if (!dept) return false;
  const kode = normalize(dept.kode).toUpperCase(), nama = normalize(dept.nama).toUpperCase();
  return ["SMP", "SMA", "MTA"].includes(kode) || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(nama);
}
function countDuplicates(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}

export function prepareImportRows(rawRows: SiswaImportRow[], references: ImportReferences, existingStudents: ExistingStudentForImport[], allowUpdate: boolean): PreparedImportRow[] {
  const byId = new Map(existingStudents.map((student) => [student.id, student]));
  const byNis = new Map<string, ExistingStudentForImport[]>();
  const byNisn = new Map<string, ExistingStudentForImport[]>();
  const byNik = new Map<string, ExistingStudentForImport[]>();
  const byNikDapodik = new Map<string, ExistingStudentForImport[]>();
  for (const student of existingStudents) {
    const nis = normalize(student.nis);
    if (nis) { const list = byNis.get(nis) || []; list.push(student); byNis.set(nis, list); }
    const nisn = normalize(student.nisn);
    if (nisn) { const list = byNisn.get(nisn) || []; list.push(student); byNisn.set(nisn, list); }
    const nik = normalize(student.nik);
    if (nik) { const list = byNik.get(nik) || []; list.push(student); byNik.set(nik, list); }
    const nikDapodik = normalize(student.nik_dapodik);
    if (nikDapodik) { const list = byNikDapodik.get(nikDapodik) || []; list.push(student); byNikDapodik.set(nikDapodik, list); }
  }
  const duplicateIds = countDuplicates(rawRows.map((row) => normalize(row.siswa_id)));
  const duplicateNis = countDuplicates(rawRows.map((row) => normalize(row.nis)));
  const duplicateNisn = countDuplicates(rawRows.map((row) => normalize(row.nisn)));
  const duplicateNikDapodik = countDuplicates(rawRows.map((row) => normalize(row.nik_dapodik)));

  return rawRows.map((raw, index) => {
    const errors: string[] = [], siswaId = normalize(raw.siswa_id), nis = normalize(raw.nis);
    const nisn = normalize(raw.nisn), nik = normalize(raw.nik), nikDapodik = normalize(raw.nik_dapodik);
    if (siswaId && !UUID_RE.test(siswaId)) errors.push("siswa_id bukan UUID yang valid");
    if (siswaId && (duplicateIds.get(siswaId) || 0) > 1) errors.push(`siswa_id ganda dalam file: ${siswaId}`);
    if (nis && (duplicateNis.get(nis) || 0) > 1) errors.push(`NIS ganda dalam file: ${nis}`);
    if (nisn && (duplicateNisn.get(nisn) || 0) > 1) errors.push(`NISN ganda dalam file: ${nisn}`);
    if (nikDapodik && (duplicateNikDapodik.get(nikDapodik) || 0) > 1) errors.push(`NIK Dapodik ganda dalam file: ${nikDapodik}`);

    const matchById = siswaId ? byId.get(siswaId) : undefined;
    const nisMatches = nis ? byNis.get(nis) || [] : [];
    const nisnMatches = nisn ? byNisn.get(nisn) || [] : [];
    const nikMatches = nik ? byNik.get(nik) || [] : [];
    const nikDapodikMatches = nikDapodik ? byNikDapodik.get(nikDapodik) || [] : [];
    if (siswaId && !matchById) errors.push(`siswa_id tidak ditemukan: ${siswaId}`);
    if (nisMatches.length > 1) errors.push(`NIS ${nis} terhubung ke lebih dari satu siswa di database`);
    if (nisnMatches.length > 1) errors.push(`NISN ${nisn} terhubung ke lebih dari satu siswa di database`);
    if (nikMatches.length > 1) errors.push(`NIK Hijrah ${nik} terhubung ke lebih dari satu siswa di database`);
    if (nikDapodikMatches.length > 1) errors.push(`NIK Dapodik ${nikDapodik} terhubung ke lebih dari satu siswa di database`);
    const matchByNis = nisMatches.length === 1 ? nisMatches[0] : undefined;
    const matchByNisn = nisnMatches.length === 1 ? nisnMatches[0] : undefined;
    const matchByNik = nikMatches.length === 1 ? nikMatches[0] : undefined;
    const matchByNikDapodik = nikDapodikMatches.length === 1 ? nikDapodikMatches[0] : undefined;

    const identityIds = new Set(
      [matchByNisn?.id, matchByNik?.id, matchByNikDapodik?.id].filter((id): id is string => Boolean(id)),
    );
    if (identityIds.size > 1) errors.push("NISN/NIK menunjuk ke siswa yang berbeda; periksa data sebelum import");
    const identityCandidate = identityIds.size === 1
      ? [matchByNisn, matchByNik, matchByNikDapodik].find((student) => student?.id === [...identityIds][0])
      : undefined;
    const canAdoptSpmb = !matchById && !matchByNis
      && identityCandidate?.status === "calon"
      && Boolean(identityCandidate.spmb_gelombang_id)
      && !identityCandidate.spmb_siswa_internal;

    if (matchById && matchByNis && matchById.id !== matchByNis.id) errors.push("NIS baru sudah digunakan siswa lain");
    if (matchById && matchByNisn && matchById.id !== matchByNisn.id) errors.push("NISN baru sudah digunakan siswa lain");
    if (matchById && matchByNik && matchById.id !== matchByNik.id) errors.push("NIK Hijrah baru sudah digunakan siswa lain");
    if (matchById && matchByNikDapodik && matchById.id !== matchByNikDapodik.id) errors.push("NIK Dapodik baru sudah digunakan siswa lain");

    const existing = matchById || (!siswaId ? matchByNis : undefined) || (canAdoptSpmb ? identityCandidate : undefined);
    const action: "insert" | "update" | "adopt_spmb" = canAdoptSpmb ? "adopt_spmb" : existing ? "update" : "insert";
    if (!existing && matchByNisn) errors.push("NISN sudah terdaftar; gunakan file update yang memuat siswa_id");
    if (!existing && matchByNik) errors.push("NIK Hijrah sudah terdaftar pada siswa lain");
    if (!existing && matchByNikDapodik) errors.push("NIK Dapodik sudah terdaftar; gunakan file update yang memuat siswa_id");
    if (existing && !allowUpdate) {
      errors.push(action === "adopt_spmb"
        ? "Ditemukan pendaftaran SPMB existing; aktifkan opsi update untuk menautkannya ke siswa aktif hasil migrasi"
        : "siswa sudah ada di database; aktifkan opsi update untuk memperbarui");
    }
    const insert = action === "insert";
    const siswaPayload: Record<string, unknown> = {}, detailPayload: Record<string, unknown> = {};

    const nama = normalize(raw.nama);
    if (insert && !nama) errors.push("nama wajib diisi untuk siswa baru");
    if (nama) siswaPayload.nama = nama;
    validateNis(raw.nis, errors);
    if (nis) siswaPayload.nis = nis; else if (insert) siswaPayload.nis = null;
    validateNisn(raw.nisn, errors);
    if (nisn) siswaPayload.nisn = nisn; else if (insert) siswaPayload.nisn = null;

    const jk = normalize(raw.jenis_kelamin).toUpperCase();
    if (jk && !["L", "P"].includes(jk)) errors.push("jenis_kelamin harus L atau P");
    else if (jk) siswaPayload.jenis_kelamin = jk; else if (insert) siswaPayload.jenis_kelamin = null;
    addString(siswaPayload, "tempat_lahir", raw.tempat_lahir, insert);
    addString(siswaPayload, "agama", raw.agama, insert); addString(siswaPayload, "alamat", raw.alamat, insert); addString(siswaPayload, "telepon", raw.telepon, insert);

    const email = normalize(raw.email);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push(`email tidak valid: ${email}`);
    else if (email) siswaPayload.email = email; else if (insert) siswaPayload.email = null;
    if (normalize(raw.tanggal_lahir)) {
      const iso = dateToISO(raw.tanggal_lahir); if (!iso) errors.push(`tanggal_lahir tidak valid: ${normalize(raw.tanggal_lahir)}`); else siswaPayload.tanggal_lahir = iso;
    } else if (insert) siswaPayload.tanggal_lahir = null;

    const status = normalize(raw.status).toLowerCase();
    if (status && !VALID_STATUS.has(status)) errors.push(`status tidak valid: ${status}`);
    if (action === "adopt_spmb") {
      if (status && status !== "aktif") errors.push("Siswa hasil migrasi yang ditautkan ke SPMB harus berstatus aktif");
      siswaPayload.status = "aktif";
    } else if (existing) {
      if (status && status !== normalize(existing.status).toLowerCase()) errors.push("status siswa existing tidak boleh diubah lewat import; gunakan SPMB/Mutasi");
    } else siswaPayload.status = status || "aktif";

    let effectiveDeptId = existing?.departemen_id || null;
    let dept: DepartemenRef | undefined;
    if (normalize(raw.departemen)) {
      const found = findUniqueByName(references.departemenList, raw.departemen);
      if (found.ambiguous) errors.push(`departemen ambigu: ${normalize(raw.departemen)}`);
      else if (!found.item) errors.push(`departemen tidak ditemukan: ${normalize(raw.departemen)}`);
      else { dept = found.item; effectiveDeptId = dept.id; }
    } else if (insert) errors.push("departemen wajib diisi untuk siswa baru");
    else if (effectiveDeptId) dept = references.departemenList.find((item) => item.id === effectiveDeptId);
    if (effectiveDeptId) siswaPayload.departemen_id = effectiveDeptId;
    else if (existing) errors.push("siswa existing belum memiliki departemen; isi departemen pada file sebelum update");
    const departmentChanged = !!existing && !!effectiveDeptId && effectiveDeptId !== existing.departemen_id;

    let tingkat: TingkatRef | undefined;
    if (normalize(raw.tingkat)) {
      if (!effectiveDeptId) errors.push("departemen harus diketahui sebelum memvalidasi tingkat");
      const found = findUniqueByName(references.tingkatList.filter((item) => item.departemen_id === effectiveDeptId), raw.tingkat);
      if (found.ambiguous) errors.push(`tingkat ambigu dalam lembaga: ${normalize(raw.tingkat)}`);
      else if (!found.item) errors.push(`tingkat tidak ditemukan pada lembaga: ${normalize(raw.tingkat)}`); else tingkat = found.item;
    }

    const hasKelas = !!normalize(raw.kelas), hasTahunAjaran = !!normalize(raw.tahun_ajaran);
    if (hasKelas !== hasTahunAjaran) errors.push("kelas dan tahun_ajaran wajib diisi bersama");
    if (hasKelas && !normalize(raw.tingkat)) errors.push("tingkat wajib diisi jika kelas diisi");
    let kelas: KelasRef | undefined;
    if (hasKelas && effectiveDeptId) {
      const found = findUniqueByName(references.kelasList.filter((item) => item.departemen_id === effectiveDeptId && (!tingkat || item.tingkat_id === tingkat.id)), raw.kelas);
      if (found.ambiguous) errors.push(`kelas ambigu pada lembaga/tingkat: ${normalize(raw.kelas)}`);
      else if (!found.item) errors.push(`kelas tidak ditemukan pada lembaga/tingkat: ${normalize(raw.kelas)}`); else kelas = found.item;
    }
    let tahunAjaran: TahunAjaranRef | undefined;
    if (hasTahunAjaran) {
      const found = findUniqueByName(references.tahunAjaranList, raw.tahun_ajaran);
      if (found.ambiguous) errors.push(`tahun ajaran ambigu: ${normalize(raw.tahun_ajaran)}`);
      else if (!found.item) errors.push(`tahun ajaran tidak ditemukan: ${normalize(raw.tahun_ajaran)}`); else tahunAjaran = found.item;
    }

    if (normalize(raw.angkatan)) {
      const found = findUniqueByName(references.angkatanList.filter((item) => item.departemen_id === effectiveDeptId), raw.angkatan);
      if (found.ambiguous) errors.push(`angkatan ambigu dalam lembaga: ${normalize(raw.angkatan)}`);
      else if (!found.item) errors.push(`angkatan tidak ditemukan pada lembaga: ${normalize(raw.angkatan)}`); else siswaPayload.angkatan_id = found.item.id;
    } else if (insert) siswaPayload.angkatan_id = null;

    if (departmentChanged && !(kelas && tahunAjaran)) {
      errors.push("perubahan departemen siswa existing harus disertai kelas dan tahun_ajaran baru yang sesuai");
    }
    if (departmentChanged && !normalize(raw.angkatan)) {
      errors.push("perubahan departemen siswa existing harus disertai angkatan baru yang sesuai");
    }
    const kelasPayload = kelas && tahunAjaran ? { kelas_id: kelas.id, tahun_ajaran_id: tahunAjaran.id } : null;

    const periode = normalize(raw.periode_pendaftaran);
    if (periode) {
      const found = findUniqueByName(references.tahunAjaranList, periode);
      if (found.ambiguous) errors.push(`periode_pendaftaran ambigu: ${periode}`);
      else if (!found.item) errors.push(`periode_pendaftaran tidak ditemukan: ${periode}`); else detailPayload.tahun_ajaran_id = found.item.id;
    }
    const jenisPendaftaran = normalize(raw.jenis_pendaftaran).toLowerCase();
    if (jenisPendaftaran && !VALID_JENIS_PENDAFTARAN.has(jenisPendaftaran)) errors.push(`jenis_pendaftaran tidak valid: ${jenisPendaftaran}`);
    else if (jenisPendaftaran) detailPayload.jenis_pendaftaran = jenisPendaftaran;

    validateLegacyNik(raw.nik, errors);
    validateIdentityNumber(raw.nik_dapodik, "NIK Dapodik", errors);
    validateIdentityNumber(raw.no_kk, "No. KK", errors);
    validateIdentityNumber(raw.nik_ayah, "NIK ayah", errors); validateIdentityNumber(raw.nik_ibu, "NIK ibu", errors);
    const detailStrings = [
      "nik", "nik_dapodik", "no_kk", "kategori", "ukuran_baju", "penyakit_pernah_diderita", "transportasi",
      "nama_ayah", "nik_ayah", "tempat_lahir_ayah", "pendidikan_ayah", "pekerjaan_ayah", "telepon_ayah", "alamat_ayah",
      "nama_ibu", "nik_ibu", "tempat_lahir_ibu", "pendidikan_ibu", "pekerjaan_ibu", "telepon_ibu", "alamat_ibu",
      "telepon_ortu", "alamat_ortu", "asal_sekolah", "alamat_sekolah_asal", "kabupaten_sekolah_asal", "kecamatan_sekolah_asal",
      "kelurahan_sekolah_asal", "kelas_terakhir", "alasan_pindah", "kemampuan_iqro", "membaca_latin", "menulis_latin", "hafalan_quran",
    ] as const;
    for (const key of detailStrings) { const value = normalize(raw[key]); if (value) detailPayload[key] = value; }

    const asrama = normalize(raw.status_asrama).toLowerCase();
    if (asrama && !VALID_STATUS_ASRAMA.has(asrama)) errors.push(`status_asrama tidak valid: ${asrama}`);
    else if (asrama) { if (dept && !isAsramaDepartment(dept)) errors.push("status_asrama hanya untuk lembaga SMP/SMA/MTA"); detailPayload.status_asrama = asrama; }

    for (const key of ["tanggal_lahir_ayah", "tanggal_lahir_ibu"] as const) {
      if (!normalize(raw[key])) continue; const iso = dateToISO(raw[key]);
      if (!iso) errors.push(`${key} tidak valid: ${normalize(raw[key])}`); else detailPayload[key] = iso;
    }
    const numericFields = [
      ["anak_ke", true], ["jumlah_bersaudara", true], ["tinggi_badan_cm", false], ["berat_badan_kg", false],
      ["lingkar_kepala_cm", false], ["jarak_rumah_km", false], ["waktu_perjalanan_menit", true], ["penghasilan_ayah", true], ["penghasilan_ibu", true],
    ] as const;
    for (const [key, integer] of numericFields) {
      if (!normalize(raw[key])) continue; const value = parseNumber(raw[key], key, errors, integer); if (value !== null) detailPayload[key] = value;
    }

    return { rowNumber: index + 2, raw, action, existingId: existing?.id, errors, siswaPayload, detailPayload, kelasPayload };
  });
}

export function rowHasAnyImportValue(row: SiswaImportRow): boolean { return IMPORT_COLUMNS.some((key) => normalize(row[key])); }

function sampleRow(): Record<string, string> {
  return {
    siswa_id: "", nis: "", nisn: "0123456789", nama: "Ahmad Fauzan", jenis_kelamin: "L", tempat_lahir: "Pangkalpinang", tanggal_lahir: "2012-05-14",
    agama: "Islam", alamat: "Jl. Contoh No. 1", telepon: "081234567890", email: "", status: "aktif",
    departemen: "SDIT At-Tauhid", tingkat: "1", kelas: "1A", tahun_ajaran: "2026/2027", angkatan: "2026",
    periode_pendaftaran: "2026/2027", jenis_pendaftaran: "baru", nik: "3273011405120001", nik_dapodik: "3273011405120001", no_kk: "3273010101010001",
    kategori: "MURID BARU", status_asrama: "", anak_ke: "1", jumlah_bersaudara: "2", tinggi_badan_cm: "125", berat_badan_kg: "25",
    lingkar_kepala_cm: "52", ukuran_baju: "M", penyakit_pernah_diderita: "", jarak_rumah_km: "3.5", waktu_perjalanan_menit: "15", transportasi: "Sepeda Motor",
    nama_ayah: "Abdullah", nik_ayah: "3273010101800001", tempat_lahir_ayah: "Pangkalpinang", tanggal_lahir_ayah: "1980-01-01", pendidikan_ayah: "S1", pekerjaan_ayah: "WIRASWASTA", penghasilan_ayah: "5000000", telepon_ayah: "081200000001", alamat_ayah: "",
    nama_ibu: "Aisyah", nik_ibu: "3273010202820001", tempat_lahir_ibu: "Pangkalpinang", tanggal_lahir_ibu: "1982-02-02", pendidikan_ibu: "S1", pekerjaan_ibu: "LAINNYA", penghasilan_ibu: "0", telepon_ibu: "081200000002", alamat_ibu: "",
    asal_sekolah: "TK Contoh", alamat_sekolah_asal: "", kabupaten_sekolah_asal: "", kecamatan_sekolah_asal: "", kelurahan_sekolah_asal: "", kelas_terakhir: "", alasan_pindah: "", kemampuan_iqro: "3", membaca_latin: "BAIK", menulis_latin: "BAIK", hafalan_quran: "1",
  };
}

export function templateWorkbook(): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet([sampleRow()], { header: [...IMPORT_COLUMNS] });
  ws["!cols"] = IMPORT_COLUMNS.map((key) => ({ wch: Math.min(34, Math.max(14, key.length + 3)) }));
  for (let row = 2; row <= 501; row++) {
    for (let col = 0; col < IMPORT_COLUMNS.length; col++) {
      const key = IMPORT_COLUMNS[col]; if (!TEXT_SENSITIVE_COLUMNS.has(key)) continue;
      const address = XLSX.utils.encode_cell({ r: row - 1, c: col });
      const cell: XLSX.CellObject = (ws[address] as XLSX.CellObject | undefined) || { t: "s", v: "" };
      cell.t = "s"; cell.z = "@"; ws[address] = cell;
    }
  }
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A2"); range.e.r = Math.max(range.e.r, 500); ws["!ref"] = XLSX.utils.encode_range(range);
  const info = XLSX.utils.aoa_to_sheet([
    ["Petunjuk Import Siswa"],
    ["1", "Untuk siswa baru, departemen wajib. Kelas harus disertai tingkat dan tahun_ajaran."],
    ["2", "Untuk update, gunakan siswa_id dari file Data Siswa untuk Update. siswa_id adalah identitas utama; NIS, NISN, NIK Hijrah, dan NIK Dapodik boleh dikoreksi."],
    ["3", "Sel kosong pada update mempertahankan data lama. Penghapusan nilai dilakukan lewat Edit Siswa."],
    ["4", "NIS disimpan sebagai teks dan maksimal 13 karakter. NIK Hijrah adalah data legacy: panjangnya tidak dipaksa 16 digit, tetapi tetap simpan sebagai teks agar nilainya tidak berubah. NIK Dapodik dan No. KK harus tepat 16 digit; NISN harus 10 digit."],
    ["5", "Tanggal: YYYY-MM-DD atau DD/MM/YYYY. Tanggal kalender yang tidak nyata akan ditolak."],
    ["6", "Dokumen KK/Akta/Rapor/Ijazah tidak diimport dari Excel; unggah melalui Edit Siswa."],
    ["7", "Status siswa existing tidak dapat diubah lewat import. Gunakan alur SPMB atau Mutasi."],
    ["8", "status_asrama: asrama / non_asrama, khusus SMP/SMA/MTA."],
    ["9", "Jika mengganti departemen siswa existing, kelas, tahun_ajaran, dan angkatan baru wajib diisi dan harus sesuai lembaga baru."],
  ]);
  info["!cols"] = [{ wch: 5 }, { wch: 110 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, info, "Petunjuk"); XLSX.utils.book_append_sheet(wb, ws, "Template"); return wb;
}
