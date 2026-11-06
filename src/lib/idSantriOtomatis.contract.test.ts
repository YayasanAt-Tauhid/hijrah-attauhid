import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261106103500_id_santri_otomatis.sql",
);

describe("ID Santri dibuat otomatis oleh aplikasi (tanpa bergantung pada pihak ketiga)", () => {
  it("menyediakan berkas migrasi", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("membuat generator ID format YY.KK.NNN yang idempotent dan aman dari balapan", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.id_santri_generate");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    // Kode lembaga memakai pemetaan yang sama dengan NIS (TK=01, SD=02, ...).
    expect(migration).toContain("public.nis_kode_lembaga(p_departemen_id)");
    // Urutan per tahun+lembaga dikunci agar dua transaksi tidak mendapat nomor sama.
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('id_santri:'");
    // ID yang sudah ada dikembalikan apa adanya, tidak pernah ditimpa.
    expect(migration).toContain("RETURN v_existing");
    // Format keluaran YY.KK.NNN.
    expect(migration).toContain("lpad(v_next::text, 3, '0')");
    expect(migration).toContain("v_year2 || '.' || v_kode || '.'");
  });

  it("memasang trigger BEFORE yang mengisi ID saat NIS pertama kali terisi", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.siswa_assign_id_santri");
    expect(migration).toContain("NEW.id_santri_pihak3 := public.id_santri_generate(");
    expect(migration).toContain("CREATE TRIGGER trg_siswa_assign_id_santri");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF nis ON public.siswa");
    expect(migration).toContain("NEW.id_santri_pihak3 IS NULL");
    expect(migration).toContain("NEW.nis IS NOT NULL");
  });

  it("tidak mengubah data yang ada dan membatasi eksekusi generator ke service role", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.id_santri_generate(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.id_santri_generate(uuid,uuid,uuid) TO service_role",
    );
    // Migrasi hanya skema/fungsi: tidak ada pengisian ulang massal.
    expect(migration).not.toMatch(/^\s*UPDATE\s+public\.siswa\b/im);
    expect(migration).not.toMatch(/^\s*DELETE\s+FROM\b/im);
  });
});
