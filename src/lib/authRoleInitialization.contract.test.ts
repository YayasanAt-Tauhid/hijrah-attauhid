import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261001084253_stop_default_siswa_role.sql",
  ),
  "utf8",
);
const orphanCleanupMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261001090046_reset_orphan_siswa_roles.sql",
  ),
  "utf8",
);
const loginPage = readFileSync(
  resolve(process.cwd(), "src/pages/Login.tsx"),
  "utf8",
);
const usersServer = readFileSync(
  resolve(process.cwd(), "src/server/users.ts"),
  "utf8",
);
const portalServer = readFileSync(
  resolve(process.cwd(), "src/server/portalOrtu.ts"),
  "utf8",
);

describe("auth role initialization contract", () => {
  it("does not classify arbitrary new auth users as students", () => {
    expect(migration).toContain("ALTER COLUMN role DROP DEFAULT");
    expect(migration).toContain("VALUES (NEW.id, NEW.email, NULL)");
    expect(migration).not.toContain("NEW.email, 'siswa'");
  });

  it("keeps official staff and student account creation role-explicit", () => {
    expect(usersServer).toContain("role,");
    expect(usersServer).toContain(".upsert({");
    expect(usersServer).toContain("role,");
  });

  it("keeps parent signup role-explicit after child verification", () => {
    expect(portalServer).toContain('role: "ortu"');
    expect(portalServer).toContain("cariSiswaTervalidasi");
  });

  it("allows only unlinked legacy accounts to recover as parents", () => {
    expect(portalServer).toContain('select("role,siswa_id,pegawai_id")');
    expect(portalServer).toContain('from("ortu_siswa")');
    expect(portalServer).toContain("const akunOrphan");
    expect(portalServer).toContain("!profile?.siswa_id");
    expect(portalServer).toContain("!profile?.pegawai_id");
    expect(portalServer).toContain("!existingParentLink");
    expect(portalServer).not.toContain("JENDELA_SIGNUP_BARU_MS");
  });

  it("resets only unlinked legacy siswa-role accounts", () => {
    expect(orphanCleanupMigration).toContain("SET role = NULL");
    expect(orphanCleanupMigration).toContain("up.role = 'siswa'");
    expect(orphanCleanupMigration).toContain("up.siswa_id IS NULL");
    expect(orphanCleanupMigration).toContain("up.pegawai_id IS NULL");
    expect(orphanCleanupMigration).toContain("NOT EXISTS");
    expect(orphanCleanupMigration).toContain("public.ortu_siswa");
  });

  it("clearly routes parents away from the staff login page", () => {
    expect(loginPage).toContain("Login Pegawai / Guru / Admin");
    expect(loginPage).toContain("Orang Tua / Wali Siswa?");
    expect(loginPage).toContain('to="/portal/login"');
    expect(loginPage).toContain("Google hanya untuk akun pegawai yang sudah didaftarkan admin");
  });
});
