import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from "./permissions";

const sql = readFileSync("supabase/migrations/20261104130000_role_permissions.sql", "utf8");

function seeded(): Record<string, string[]> {
  const insert = sql.slice(sql.indexOf("INSERT INTO public.role_permissions"));
  const result: Record<string, string[]> = {};
  for (const [, role, permission] of insert.matchAll(/\('([a-z_]+)','([a-z_.]+)'\)/g)) {
    (result[role] ||= []).push(permission);
  }
  return result;
}

describe("migrasi role_permissions", () => {
  it("isian awal sama persis dengan DEFAULT_ROLE_PERMISSIONS (ditambah akses data untuk bendahara/sekretaris)", () => {
    const rows = seeded();
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const expected = new Set(keys);
      if (role === "bendahara" || role === "sekretaris_yayasan") expected.add("keuangan.akses_data");
      expect(new Set(rows[role]), role).toEqual(expected);
    }
  });

  it("semua izin yang di-seed dikenal di katalog", () => {
    for (const keys of Object.values(seeded())) {
      for (const key of keys) expect(PERMISSION_KEYS as readonly string[]).toContain(key);
    }
  });

  it("peran bendahara diterima validator dan has_role('keuangan') bersyarat izin akses data", () => {
    expect(sql).toContain("'sekretaris_yayasan','bendahara'");
    expect(sql).toContain("rp.permission = 'keuangan.akses_data'");
    expect(sql).toMatch(/_role = 'keuangan'\s+AND u\.role IN \('bendahara','sekretaris_yayasan'\)/);
  });

  it("tabel izin tidak bisa ditulis klien dan has_permission tidak terbuka untuk anon", () => {
    expect(sql).toContain("ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.has_permission(uuid,text) FROM PUBLIC, anon");
  });

  it("set_role_permissions hanya untuk admin, hanya peran yang bisa diatur, dan tertutup bagi klien", () => {
    expect(sql).toContain("public.has_role(p_actor_id, 'admin')");
    expect(sql).toContain("p_role NOT IN ('keuangan','kasir','bendahara','sekretaris_yayasan')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.set_role_permissions(text,text[],uuid) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.set_role_permissions(text,text[],uuid) TO service_role");
  });
});

