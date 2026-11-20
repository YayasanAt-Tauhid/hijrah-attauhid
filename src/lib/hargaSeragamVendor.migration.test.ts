import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mentah = readFileSync("supabase/migrations/20261120050000_harga_seragam_vendor.sql", "utf8");
// Komentar (termasuk catatan rollback) tidak dihitung sebagai perintah.
const sql = mentah.split("\n").filter((baris) => !baris.trim().startsWith("--")).join("\n");

describe("migrasi harga_seragam_vendor", () => {
  it("membuat tabel dengan kolom dan batasan yang dirancang", () => {
    expect(sql).toContain("CREATE TABLE public.harga_seragam_vendor");
    for (const kolom of [
      /tahun_ajaran_id uuid NOT NULL REFERENCES public\.tahun_ajaran\(id\)/,
      /departemen_id uuid NOT NULL REFERENCES public\.departemen\(id\)/,
      /jenis_kelamin text NOT NULL CHECK \(jenis_kelamin IN \('L', 'P', 'semua'\)\)/,
      /nama_stel text NOT NULL CHECK \(btrim\(nama_stel\) <> '' AND char_length\(nama_stel\) <= 80\)/,
      /ukuran text\[\] NOT NULL DEFAULT '\{\}'/,
      /harga bigint NOT NULL CHECK \(harga >= 0\)/,
      /aktif boolean NOT NULL DEFAULT true/,
      /created_by uuid/,
    ]) expect(sql).toMatch(kolom);
  });

  it("pemicu merapikan nama dan ukuran lalu menolak baris aktif yang bertabrakan (dengan kunci penasihat)", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_harga_seragam_vendor_sebelum_tulis\s+BEFORE INSERT OR UPDATE ON public\.harga_seragam_vendor/);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("'X3L' THEN '3XL'");
    expect(sql).toContain("'X4L' THEN '4XL'");
    expect(sql).toContain("'X5L' THEN '5XL'");
    expect(sql).toContain("ERRCODE = '23P01'");
    expect(sql).toMatch(/h\.ukuran && NEW\.ukuran/);
    expect(sql).toMatch(/cardinality\(h\.ukuran\) = 0 OR cardinality\(NEW\.ukuran\) = 0/);
  });

  it("RLS aktif; hanya admin dan keuangan yang bisa baca, tambah, dan ubah; tidak ada DELETE", () => {
    expect(sql).toContain("ALTER TABLE public.harga_seragam_vendor ENABLE ROW LEVEL SECURITY");
    const kebijakan = sql.match(/CREATE POLICY/g) ?? [];
    expect(kebijakan).toHaveLength(3);
    expect(sql).toMatch(/FOR SELECT TO authenticated/);
    expect(sql).toMatch(/FOR INSERT TO authenticated/);
    expect(sql).toMatch(/FOR UPDATE TO authenticated/);
    expect(sql).not.toMatch(/FOR (DELETE|ALL)/);
    const syarat = "public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan')";
    expect(sql.split(syarat).length - 1).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/REVOKE ALL ON public\.harga_seragam_vendor FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.harga_seragam_vendor TO authenticated/);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*authenticated/);
  });

  it("hanya menyentuh tabelnya sendiri dan tidak memuat data harga", () => {
    expect(sql).not.toMatch(/INSERT INTO public\.harga_seragam_vendor/);
    for (const [, tabel] of sql.matchAll(/ALTER TABLE (?:ONLY )?(public\.[a-z_]+)/g)) {
      expect(tabel).toBe("public.harga_seragam_vendor");
    }
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});
