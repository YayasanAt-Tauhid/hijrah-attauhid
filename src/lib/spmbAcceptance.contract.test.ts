import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261009084606_spmb_acceptance_without_class.sql"), "utf8");
const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");

describe("SPMB accepted without class, activation still requires class", () => {
  it("maintains financial, document, academic-year and graduation prerequisites without class gate", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.spmb_readiness");
    expect(migration).toContain("'tahun ajaran tujuan'");
    expect(migration).toContain("'verifikasi data'");
    expect(migration).toContain("'pelunasan pembayaran SPMB'");
    expect(migration).toContain("'status kelulusan: Lulus'");
    expect(migration).toContain("'Kartu Keluarga'");
    expect(migration).toContain("'Akta Kelahiran'");
    expect(migration).not.toContain("IF NOT has_class THEN missing:=array_append");
    expect(migration).toContain("'punya_kelas',has_class");
  });

  it("does not gate acceptance on placement but gates activation", () => {
    expect(spmbPage).not.toContain('if (!row._punyaKelas) kekurangan.push("kelas");');
    expect(spmbPage).toContain('if (!detail?.tahun_ajaran_id) kekurangan.push("tahun ajaran tujuan");');
    expect(spmbPage).toContain("const handleAktifkan");
    expect(spmbPage).toContain('if (!row._punyaKelas) {');
    expect(spmbPage).toContain('disabled={loading || !row.nis || !row._punyaKelas}');
    expect(spmbPage).toContain('["diterima", "aktif"].includes(status)');
  });
});
