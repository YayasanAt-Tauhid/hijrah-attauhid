import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/pages/portal/SPMBDaftarOnlineV2.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924093000_spmb_boarding_policy_gender.sql"),
  "utf8",
);

describe("SPMB boarding policy", () => {
  it("shows boarding selection only for SMP Ikhwan while keeping MTA automatic", () => {
    expect(page).toContain('kodeDepartemen(dept) === "SMP" && jenisKelamin === "L"');
    expect(page).toContain("mtaWajibAsrama || perluPilihanAsrama(selectedDept, form.jenis_kelamin)");
    expect(page).toContain("SMA dan SMP Akhwat tidak berasrama");
  });

  it("normalizes SMA and SMP Akhwat to non_asrama on the server", () => {
    expect(server).toContain('deptCode === "SMA" || (deptCode === "SMP" && jenisKelamin === "P")');
    expect(server).toContain('statusAsrama = "non_asrama"');
    expect(server).toContain("wajib dipilih untuk SMP Ikhwan");
  });

  it("enforces the same policy in the database", () => {
    expect(migration).toContain("code = 'SMA'");
    expect(migration).toContain("code = 'SMP' AND s.jenis_kelamin = 'P'");
    expect(migration).toContain("NEW.status_asrama := 'non_asrama'");
    expect(migration).toContain("aaa_spmb_normalize_public_boarding_policy");
  });
});
