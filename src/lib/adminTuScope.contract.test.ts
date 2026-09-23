import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924063000_admin_tu_multi_department_scope.sql"),
  "utf8",
);
const page = readFileSync(resolve(process.cwd(), "src/pages/pengaturan/AdminTuAkademik.tsx"), "utf8");
const auth = readFileSync(resolve(process.cwd(), "src/server/auth.ts"), "utf8");
const akademik = readFileSync(resolve(process.cwd(), "src/server/akademik.ts"), "utf8");
const siswaHook = readFileSync(resolve(process.cwd(), "src/hooks/useSiswa.ts"), "utf8");
const dataHook = readFileSync(resolve(process.cwd(), "src/hooks/useAkademikData.ts"), "utf8");

describe("Admin TU multi-department scope contract", () => {
  it("stores a many-to-many scope and preserves the legacy primary department", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.admin_tu_departemen_scope");
    expect(migration).toContain("PRIMARY KEY (user_id, departemen_id)");
    expect(migration).toContain("users_profile.departemen_id remains the primary/legacy unit");
    expect(migration).toContain("INSERT INTO public.admin_tu_departemen_scope(user_id, departemen_id)");
  });

  it("centralizes authorization through can_manage_akademik_departemen", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.can_manage_akademik_departemen");
    expect(migration).toContain("FROM public.admin_tu_departemen_scope s");
    expect(auth).toContain('"can_manage_akademik_departemen"');
    expect(akademik).toContain("requireAcademicDepartment");
  });

  it("provides an admin-only atomic scope setter", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_set_admin_tu_scope");
    expect(migration).toContain("NOT public.has_role(auth.uid(), 'admin')");
    expect(page).toContain('rpc("admin_set_admin_tu_scope"');
  });

  it("supports one, several, or all visible education units in the UI", () => {
    expect(page).toContain("Pilih Semua Lembaga");
    expect(page).toContain("departemenIds");
    expect(page).toContain("<Checkbox");
    expect(page).toContain("satu, beberapa, atau semua lembaga pendidikan");
  });

  it("lets RLS return every scoped department instead of forcing the legacy primary id", () => {
    expect(siswaHook).toContain('role === "admin_tu" ? "scoped" : "all"');
    expect(siswaHook).not.toContain('q = q.eq("departemen_id", departemenId)');
    expect(dataHook).toContain("const effectiveDept = departemenIdArg;");
    expect(dataHook).not.toContain('q = q.eq("departemen_id", departemenId)');
  });
});
