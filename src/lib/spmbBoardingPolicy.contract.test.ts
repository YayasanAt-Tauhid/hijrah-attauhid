import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/pages/portal/SPMBDaftarOnlineV2.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924094500_correct_spmb_boarding_policy.sql"),
  "utf8",
);

describe("SPMB boarding policy", () => {
  it("shows boarding selection for SMA and SMP Ikhwan while keeping MTA automatic", () => {
    expect(page).toContain('kode === "SMA" || (kode === "SMP" && jenisKelamin === "L")');
    expect(page).toContain("mtaWajibAsrama || perluPilihanAsrama(selectedDept, form.jenis_kelamin)");
    expect(page).toContain("wajib dipilih untuk SMA dan SMP Ikhwan");
    expect(page).toContain("SMP Akhwat tidak berasrama");
  });

  it("validates SMA and SMP Ikhwan choices and normalizes SMP Akhwat", () => {
    expect(server).toContain('deptCode === "SMA" || (deptCode === "SMP" && jenisKelamin === "L")');
    expect(server).toContain("wajib dipilih untuk SMA dan SMP Ikhwan");
    expect(server).toContain('deptCode === "SMP" && jenisKelamin === "P"');
    expect(server).toContain('statusAsrama = "non_asrama"');
    expect(server).toContain('deptCode === "MTA"');
    expect(server).toContain('statusAsrama = "asrama"');
  });

  it("enforces the corrected policy in the database without rewriting existing SMA rows", () => {
    expect(migration).toContain("code = 'SMA'");
    expect(migration).toContain("wajib dipilih untuk SMA");
    expect(migration).toContain("code = 'SMP' AND s.jenis_kelamin = 'P'");
    expect(migration).toContain("NEW.status_asrama := 'non_asrama'");
    expect(migration).toContain("code = 'SMP' AND s.jenis_kelamin = 'L'");
    expect(migration).toContain("code = 'MTA'");
    expect(migration).not.toContain("UPDATE public.siswa_detail");
  });
});
