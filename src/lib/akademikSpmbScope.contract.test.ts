import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scopeMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260928075832_separate_admin_tu_academic_student_scope.sql"),
  "utf8",
);
const spmbScopeMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260921175557_spmb_internal_verification_scope.sql"),
  "utf8",
);
const helper = readFileSync(resolve(process.cwd(), "src/lib/akademikScope.ts"), "utf8");
const siswaHook = readFileSync(resolve(process.cwd(), "src/hooks/useSiswa.ts"), "utf8");
const statistik = readFileSync(resolve(process.cwd(), "src/pages/akademik/StatistikSiswa.tsx"), "utf8");
const dashboard = readFileSync(resolve(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");
const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");

describe("Academic student scope stays separate from SPMB destination access", () => {
  it("derives the academic unit list from the caller's managed education units", () => {
    expect(scopeMigration).toContain("CREATE OR REPLACE FUNCTION public.akademik_managed_departemen_ids()");
    expect(scopeMigration).toContain("d.kategori = 'unit_pendidikan'");
    expect(scopeMigration).toContain("public.can_manage_akademik_departemen(auth.uid(), d.id)");
    expect(helper).toContain('role !== "admin_tu"');
    expect(helper).toContain('rpc("akademik_managed_departemen_ids")');
  });

  it("restricts generic academic student lists and counts to the academic department scope", () => {
    expect(siswaHook).toContain('q = q.in("departemen_id", managedDepartemenIds)');
    expect(statistik).toContain('q = q.in("departemen_id", managedDepartemenIds)');
    expect(dashboard).toContain('q = q.in("departemen_id", managedDepartemenIds)');
  });

  it("keeps destination-based SPMB access for internal students still enrolled in the previous unit", () => {
    expect(spmbScopeMigration).toContain("d.spmb_departemen_tujuan_id IS NOT NULL");
    expect(spmbScopeMigration).toContain("public.can_manage_akademik_departemen(_user_id,d.spmb_departemen_tujuan_id)");
    expect(spmbPage).toContain('rpc("spmb_visible_siswa_ids")');
  });
});
