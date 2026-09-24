import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/pages/portal/SPMBDaftarOnlineV2.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924100000_spmb_akhwat_non_boarding.sql"),
  "utf8",
);

describe("SPMB boarding policy", () => {
  it("lets SMP/SMA Ikhwan choose and makes SMP/SMA Akhwat non-boarding only", () => {
    expect(page).toContain('["SMP", "SMA"].includes(kode) && jenisKelamin === "L"');
    expect(page).toContain('akhwatNonAsrama = ["SMP", "SMA"].includes(deptCode) && form.jenis_kelamin === "P"');
    expect(page).toContain("NON ASRAMA — khusus Akhwat SMP/SMA");
    expect(page).toContain("SMP dan SMA Akhwat hanya Non Asrama");
    expect(page).toContain("ASRAMA — wajib untuk pendaftar MTA");
  });

  it("enforces the same rule on the server", () => {
    expect(server).toContain('["SMP", "SMA"].includes(deptCode) && jenisKelamin === "L"');
    expect(server).toContain("wajib dipilih untuk SMP dan SMA Ikhwan");
    expect(server).toContain('["SMP", "SMA"].includes(deptCode) && jenisKelamin === "P"');
    expect(server).toContain('statusAsrama = "non_asrama"');
    expect(server).toContain('deptCode === "MTA"');
    expect(server).toContain('statusAsrama = "asrama"');
  });

  it("forces Akhwat non_asrama in the database", () => {
    expect(migration).toContain("code IN ('SMP','SMA') AND s.jenis_kelamin = 'P'");
    expect(migration).toContain("NEW.status_asrama := 'non_asrama'");
    expect(migration).toContain("code IN ('SMP','SMA') AND s.jenis_kelamin = 'L'");
    expect(migration).toContain("code = 'MTA'");
    expect(migration).toContain("UPDATE public.siswa_detail");
  });
});
