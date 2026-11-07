import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261108050000_id_santri_sejak_pendaftaran.sql",
);

describe("ID Santri dibuat sejak pendaftaran SPMB (calon), bukan hanya saat Lulus", () => {
  it("menyediakan berkas migrasi", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("memasang ulang trigger agar jalan saat INSERT calon, selain saat NIS terisi", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_siswa_assign_id_santri ON public.siswa");
    expect(migration).toContain("CREATE TRIGGER trg_siswa_assign_id_santri");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF nis, status ON public.siswa");
    expect(migration).toContain("NEW.id_santri_pihak3 IS NULL");
    expect(migration).toContain("NEW.status = 'calon'");
    expect(migration).toContain("NEW.nis IS NOT NULL");
  });

  it("memakai generator yang sama (format YY.KK.NNN tetap, ID lama tidak ditimpa)", () => {
    expect(migration).toContain("EXECUTE FUNCTION public.siswa_assign_id_santri()");
    // Tidak mengganti generator dan tidak mengubah format.
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.id_santri_generate");
  });

  it("hanya skema/trigger: tanpa pengisian massal atau penghapusan data", () => {
    expect(migration).not.toMatch(/^\s*UPDATE\s+public\.siswa\b/im);
    expect(migration).not.toMatch(/^\s*DELETE\s+FROM\b/im);
    expect(migration).not.toMatch(/^\s*INSERT\s+INTO\b/im);
  });
});
