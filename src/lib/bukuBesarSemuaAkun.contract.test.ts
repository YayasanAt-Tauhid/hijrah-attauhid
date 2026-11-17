import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const migration = read("supabase/migrations/20261117090000_buku_besar_semua_akun.sql");
const page = read("src/pages/keuangan/BukuBesar.tsx");
const hook = read("src/hooks/useJurnal.ts");

const count = (text: string, needle: string) => text.split(needle).length - 1;
const sqlTanpaKomentar = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migrasi buku besar semua akun", () => {
  it("hanya menambah dua fungsi baca: tidak mengubah/menghapus tabel atau data", () => {
    expect(count(sqlTanpaKomentar, "CREATE OR REPLACE FUNCTION public.buku_besar_saldo_awal_semua(")).toBe(1);
    expect(count(sqlTanpaKomentar, "CREATE OR REPLACE FUNCTION public.buku_besar_mutasi_semua(")).toBe(1);
    expect(sqlTanpaKomentar).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|ALTER\s+TABLE)\b/i);
  });

  it("memakai SECURITY DEFINER dengan pengecekan peran yang sama dengan fungsi per akun", () => {
    expect(count(migration, "SECURITY DEFINER")).toBe(2);
    expect(count(migration, "SET search_path TO 'public'")).toBe(2);
    expect(count(migration, "public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan')")).toBe(2);
    expect(count(migration, "RAISE EXCEPTION 'Tidak diizinkan mengakses buku besar'")).toBe(2);
  });

  it("tidak bisa dipanggil anon/PUBLIC, hanya authenticated dan service_role", () => {
    for (const sig of ["buku_besar_saldo_awal_semua(date, uuid[], boolean)", "buku_besar_mutasi_semua(date, date, uuid[], boolean, boolean)"]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC;`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM anon;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
    }
  });

  it("mengikuti aturan fungsi per akun: hanya jurnal posted, penutup, dan pengecualian koreksi", () => {
    expect(count(migration, "j.status = 'posted'")).toBe(2);
    expect(migration).toContain("COALESCE(j.tipe, '') <> 'penutup'");
    expect(migration).toContain("p_include_penutup OR COALESCE(j.tipe, '') <> 'penutup'");
    expect(count(migration, "jp.jurnal_asal_id = j.id")).toBe(2);
    expect(migration).toContain("s.tahun = EXTRACT(YEAR FROM p_tgl_awal)::int");
    // urutan stabil agar aman dipaginasi di klien
    expect(migration).toContain("ORDER BY a.kode, jd.akun_id, j.tanggal, j.nomor, jd.urutan, jd.id");
  });
});

describe("halaman Buku Besar", () => {
  it("menyediakan pilihan Semua akun rekening; layar memakai ringkasan, export memakai mutasi semua akun", () => {
    expect(page).toContain("Semua akun rekening");
    expect(page).toContain("useBukuBesarRingkasanSemua");
    expect(page).toContain("fetchBukuBesarSemuaRinci");
    expect(hook).toContain('supabase.rpc("buku_besar_saldo_awal_semua"');
    expect(hook).toContain('.rpc("buku_besar_mutasi_semua"');
  });

  it("filter bulan berurutan kalender dan tahun divalidasi sebelum query", () => {
    expect(page).toContain("BULAN_KALENDER");
    expect(page).not.toContain("BULAN_ORDER_AKADEMIK");
    expect(page).toContain("parseTahunInput(tahunInput)");
    expect(page).not.toMatch(/setTahun\(Number\(e\.target\.value\)\)/);
    expect(page).toContain("periodeBukuBesar(");
  });

  it("export tersedia untuk satu akun maupun semua akun", () => {
    expect(page).toContain("buildBukuBesarSingleAoa");
    expect(page).toContain("buildBukuBesarSemuaAoa");
    expect(page).toContain("downloadAoaXlsx");
    expect(page).toContain("downloadAoaCsv");
  });
});
