import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const berkas = resolve(process.cwd(), "supabase/migrations/20261125093000_akses_baca_seragam_vendor_dan_siswa.sql");
const sql = existsSync(berkas) ? readFileSync(berkas, "utf8") : "";
// Hanya SQL yang dieksekusi; komentar boleh menyebut kata apa pun.
const sqlAktif = sql.split("\n").filter((baris) => !baris.trimStart().startsWith("--")).join("\n");

describe("Migrasi akses baca: seragam vendor untuk admin_tu, siswa untuk keuangan", () => {
  it("ada dan hanya memberi izin SELECT", () => {
    expect(sql).not.toBe("");
    expect(sqlAktif).not.toMatch(/FOR\s+(ALL|INSERT|UPDATE|DELETE)/i);
    expect(sqlAktif).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|\bALTER\b|\bUPDATE\b|\bINSERT\b/i);
    expect(sqlAktif).not.toMatch(/\bGRANT\b/i);
    expect(sqlAktif.match(/FOR SELECT/g)).toHaveLength(2);
  });

  it("memberi keuangan hak baca tabel siswa", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS keuangan_siswa_select ON public.siswa;");
    expect(sql).toMatch(/CREATE POLICY keuangan_siswa_select ON public\.siswa\s+FOR SELECT TO authenticated/);
    expect(sql).toContain("public.has_role(auth.uid(), 'keuangan')");
  });

  it("membatasi admin_tu ke harga seragam departemen yang ia kelola", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS admin_tu_baca_harga_seragam_vendor ON public.harga_seragam_vendor;");
    expect(sql).toMatch(/CREATE POLICY admin_tu_baca_harga_seragam_vendor ON public\.harga_seragam_vendor\s+FOR SELECT TO authenticated/);
    expect(sql).toContain("public.has_role(auth.uid(), 'admin_tu')");
    expect(sql).toContain("public.can_manage_akademik_departemen(auth.uid(), departemen_id)");
  });

  it("mendokumentasikan cara membatalkan", () => {
    expect(sql).toMatch(/Rollback/i);
    expect(sql).toContain("DROP POLICY keuangan_siswa_select ON public.siswa;");
    expect(sql).toContain("DROP POLICY admin_tu_baca_harga_seragam_vendor ON public.harga_seragam_vendor;");
  });
});
