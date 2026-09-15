import { describe, expect, it } from "vitest";
import { dateToISO, prepareImportRows, type ExistingStudentForImport, type ImportReferences, type SiswaImportRow } from "./siswaImport";

const STUDENT_A = "11111111-1111-4111-8111-111111111111";
const STUDENT_B = "22222222-2222-4222-8222-222222222222";
const refs: ImportReferences = {
  departemenList: [{ id: "d-sd", nama: "SDIT At-Tauhid", kode: "SD" }, { id: "d-smp", nama: "SMPIT At-Tauhid", kode: "SMP" }],
  tingkatList: [{ id: "t-1", nama: "1", departemen_id: "d-sd" }, { id: "t-7", nama: "7", departemen_id: "d-smp" }],
  kelasList: [{ id: "k-1a", nama: "1A", tingkat_id: "t-1", departemen_id: "d-sd" }, { id: "k-7a", nama: "7A", tingkat_id: "t-7", departemen_id: "d-smp" }],
  tahunAjaranList: [{ id: "ta-26", nama: "2026/2027" }],
  angkatanList: [{ id: "a-26-sd", nama: "2026", departemen_id: "d-sd" }, { id: "a-26-smp", nama: "2026", departemen_id: "d-smp" }],
};
const existing: ExistingStudentForImport[] = [
  { id: STUDENT_A, nis: "260001", status: "aktif", departemen_id: "d-sd" },
  { id: STUDENT_B, nis: "260002", status: "calon", departemen_id: "d-smp" },
];
const prepare = (rows: SiswaImportRow[], allowUpdate = true) => prepareImportRows(rows, refs, existing, allowUpdate);

describe("dateToISO", () => {
  it("accepts real leap dates and rejects impossible calendar dates", () => {
    expect(dateToISO("2024-02-29")).toBe("2024-02-29");
    expect(dateToISO("29/02/2024")).toBe("2024-02-29");
    expect(dateToISO("2023-02-29")).toBeNull();
    expect(dateToISO("31/04/2026")).toBeNull();
  });
});

describe("prepareImportRows", () => {
  it("updates a student without NIS safely by siswa_id", () => {
    const [row] = prepare([{ siswa_id: STUDENT_A, nama: "Nama Baru" }]);
    expect(row.errors).toEqual([]); expect(row.action).toBe("update"); expect(row.existingId).toBe(STUDENT_A);
    expect(row.siswaPayload.nama).toBe("Nama Baru"); expect(row.siswaPayload.departemen_id).toBe("d-sd");
  });

  it("requires siswa_id and NIS to identify the same existing student", () => {
    const [row] = prepare([{ siswa_id: STUDENT_A, nis: "260002" }]);
    expect(row.errors.join(" ")).toContain("menunjuk ke siswa yang berbeda");
  });

  it("does not turn an existing NIS into a duplicate insert when update is disabled", () => {
    const [row] = prepare([{ nis: "260001", nama: "Duplikat" }], false);
    expect(row.action).toBe("update"); expect(row.errors.join(" ")).toContain("sudah ada di database");
  });

  it("detects duplicate siswa_id and NIS inside the uploaded file", () => {
    const rows = prepare([{ siswa_id: STUDENT_A, nis: "260001" }, { siswa_id: STUDENT_A, nis: "260001" }]);
    expect(rows[0].errors.join(" ")).toContain("siswa_id ganda dalam file");
    expect(rows[0].errors.join(" ")).toContain("NIS ganda dalam file");
    expect(rows[1].errors.join(" ")).toContain("siswa_id ganda dalam file");
  });

  it("preserves blank update cells instead of sending nulls", () => {
    const [row] = prepare([{ siswa_id: STUDENT_A, nama: "", alamat: "", nama_ayah: "" }]);
    expect(row.errors).toEqual([]); expect(row.siswaPayload).not.toHaveProperty("nama"); expect(row.siswaPayload).not.toHaveProperty("alamat");
    expect(row.detailPayload).not.toHaveProperty("nama_ayah"); expect(row.siswaPayload.departemen_id).toBe("d-sd");
  });

  it("rejects reference combinations outside the selected department", () => {
    const [row] = prepare([{ nama: "Siswa Baru", departemen: "SDIT At-Tauhid", tingkat: "7", kelas: "7A", tahun_ajaran: "2026/2027", angkatan: "2026" }]);
    expect(row.errors.join(" ")).toContain("tingkat tidak ditemukan pada lembaga");
    expect(row.errors.join(" ")).toContain("kelas tidak ditemukan pada lembaga/tingkat");
  });

  it("requires a new class, year, and angkatan when changing an existing student's department", () => {
    const [missingAngkatan] = prepare([{ siswa_id: STUDENT_A, departemen: "SMPIT At-Tauhid", tingkat: "7", kelas: "7A", tahun_ajaran: "2026/2027" }]);
    expect(missingAngkatan.errors.join(" ")).toContain("angkatan baru yang sesuai");

    const [complete] = prepare([{ siswa_id: STUDENT_A, departemen: "SMPIT At-Tauhid", tingkat: "7", kelas: "7A", tahun_ajaran: "2026/2027", angkatan: "2026" }]);
    expect(complete.errors).toEqual([]);
    expect(complete.siswaPayload.departemen_id).toBe("d-smp");
    expect(complete.siswaPayload.angkatan_id).toBe("a-26-smp");
    expect(complete.kelasPayload).toEqual({ kelas_id: "k-7a", tahun_ajaran_id: "ta-26" });
  });

  it("blocks status changes for existing students", () => {
    const [row] = prepare([{ siswa_id: STUDENT_A, status: "alumni" }]);
    expect(row.errors.join(" ")).toContain("status siswa existing tidak boleh diubah lewat import");
    expect(row.siswaPayload).not.toHaveProperty("status");
  });

  it("validates NIK/KK as 16 digit text and rejects numeric Excel cells", () => {
    const [numeric] = prepare([{ nama: "Siswa Baru", departemen: "SDIT At-Tauhid", nik: 3273011405120001 }]);
    expect(numeric.errors.join(" ")).toContain("disimpan sebagai teks");
    const [short] = prepare([{ nama: "Siswa Baru", departemen: "SDIT At-Tauhid", no_kk: "12345" }]);
    expect(short.errors.join(" ")).toContain("No. KK harus tepat 16 digit");
  });

  it("validates class/year pairing and registration period", () => {
    const [missingYear] = prepare([{ nama: "Siswa Baru", departemen: "SDIT At-Tauhid", tingkat: "1", kelas: "1A" }]);
    expect(missingYear.errors.join(" ")).toContain("kelas dan tahun_ajaran wajib diisi bersama");
    const [badPeriod] = prepare([{ nama: "Siswa Baru", departemen: "SDIT At-Tauhid", periode_pendaftaran: "2099/2100" }]);
    expect(badPeriod.errors.join(" ")).toContain("periode_pendaftaran tidak ditemukan");
  });
});
