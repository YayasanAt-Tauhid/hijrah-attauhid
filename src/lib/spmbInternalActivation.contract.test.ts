import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260921182716_spmb_internal_target_activation.sql"),
  "utf8",
);
const page = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");

describe("SPMB internal target activation contract", () => {
  it("requires accepted, passed, and re-registered SPMB before moving the student", () => {
    expect(migration).toContain("spmb_status_pendaftaran,'') <> 'diterima'");
    expect(migration).toContain("spmb_status_kelulusan,'') <> 'lulus'");
    expect(migration).toContain("spmb_tanggal_daftar_ulang IS NULL");
  });

  it("prevents activation before the target academic year starts", () => {
    expect(migration).toContain("current_date < target_year.tanggal_mulai");
    expect(migration).toContain("Tahun ajaran aktivasi harus sama dengan periode SPMB");
  });

  it("moves class, unit, cohort, NIS, and SPMB status atomically", () => {
    expect(migration).toContain("UPDATE public.kelas_siswa");
    expect(migration).toContain("INSERT INTO public.kelas_siswa");
    expect(migration).toContain("departemen_id=target_dept");
    expect(migration).toContain("angkatan_id=target_cohort");
    expect(migration).toContain("nis=new_nis");
    expect(migration).toContain("spmb_status_pendaftaran='selesai'");
    expect(migration).toContain("spmb_tanggal_aktivasi=now()");
  });

  it("serializes NIS generation per target class and preserves UI confirmation", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'nis_lama',old_nis");
    expect(migration).toContain("'nis_baru',new_nis");
    expect(page).toContain('rpc("spmb_activate_internal_student"');
    expect(page).toContain("NIS lama tetap tercatat pada audit identitas");
  });
});
