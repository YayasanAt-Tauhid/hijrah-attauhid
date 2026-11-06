import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261106030000_hapus_siswa_guard_riwayat.sql"),
  "utf8",
);

describe("migrasi hapus siswa dengan penjaga riwayat", () => {
  it("tidak diterapkan otomatis ke produksi", () => {
    expect(migration).toContain("Tidak diterapkan otomatis ke produksi");
  });

  it("membuat RPC hapus_siswa(p_siswa_id, p_actor_id) yang mengembalikan jsonb", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.hapus_siswa\(\s*p_siswa_id uuid,\s*p_actor_id uuid\s*\)/);
    expect(migration).toMatch(/RETURNS jsonb/);
  });

  it("SECURITY DEFINER dengan search_path tetap, dan hanya bisa dipanggil service_role", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.hapus_siswa\(uuid,\s*uuid\)\s+FROM PUBLIC,\s*anon,\s*authenticated/,
    );
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.hapus_siswa\(uuid,\s*uuid\)\s+TO service_role/);
  });

  it("memeriksa ulang peran pelaku: admin, atau admin_tu yang mengelola departemen siswa", () => {
    expect(migration).toContain("public.has_role(p_actor_id,'admin')");
    expect(migration).toContain("public.has_role(p_actor_id,'admin_tu')");
    expect(migration).toContain("public.can_manage_akademik_departemen(p_actor_id");
  });

  it("mengunci baris siswa lalu menghitung riwayat dari semua FK ke siswa (termasuk CASCADE), bukan dari daftar tetap", () => {
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("pg_constraint");
    expect(migration).toMatch(/confrelid\s*=\s*'public\.siswa'::regclass/);
  });

  it("hanya tabel pendamping yang boleh ikut terhapus bersama siswa", () => {
    for (const tabel of ["siswa_detail", "ortu_siswa", "siswa_tahun_masuk_departemen"]) {
      expect(migration).toContain(`'${tabel}'`);
    }
  });

  it("tidak menghapus bila ada riwayat; mengembalikan daftar tabel dan jumlahnya", () => {
    expect(migration).toContain("'punya_riwayat'");
    expect(migration).toContain("'riwayat'");
    expect(migration).toMatch(/DELETE FROM public\.siswa WHERE id = p_siswa_id/);
  });

  it("DELETE hanya muncul sesudah pemeriksaan riwayat", () => {
    const pemeriksaan = migration.indexOf("'punya_riwayat'");
    const hapus = migration.indexOf("DELETE FROM public.siswa WHERE id = p_siswa_id");
    expect(pemeriksaan).toBeGreaterThan(-1);
    expect(hapus).toBeGreaterThan(pemeriksaan);
  });
});
