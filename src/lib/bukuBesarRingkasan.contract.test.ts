import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const migration = read("supabase/migrations/20261117120000_buku_besar_ringkasan_semua.sql");
const base = read("supabase/migrations/20261117090000_buku_besar_semua_akun.sql");
const page = read("src/pages/keuangan/BukuBesar.tsx");
const hook = read("src/hooks/useJurnal.ts");

const count = (text: string, needle: string) => text.split(needle).length - 1;
const sqlTanpaKomentar = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const SIG = "buku_besar_ringkasan_semua(date, date, uuid[], boolean, boolean)";

describe("migrasi ringkasan buku besar semua akun", () => {
  it("hanya menambah satu fungsi baca: tidak mengubah/menghapus tabel, data, atau fungsi lain", () => {
    expect(count(sqlTanpaKomentar, "CREATE OR REPLACE FUNCTION public.buku_besar_ringkasan_semua(")).toBe(1);
    expect(count(sqlTanpaKomentar, "CREATE OR REPLACE FUNCTION")).toBe(1);
    expect(sqlTanpaKomentar).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|ALTER\s+TABLE)\b/i);
  });

  it("SECURITY DEFINER dengan pengecekan peran yang sama dengan fungsi buku besar lain", () => {
    expect(count(migration, "SECURITY DEFINER")).toBe(1);
    expect(count(migration, "SET search_path TO 'public'")).toBe(1);
    expect(migration).toContain("public.is_admin_or_kepala(auth.uid()) OR public.has_role(auth.uid(), 'keuangan')");
    expect(migration).toContain("RAISE EXCEPTION 'Tidak diizinkan mengakses buku besar'");
  });

  it("tidak bisa dipanggil anon/PUBLIC, hanya authenticated dan service_role", () => {
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${SIG} FROM PUBLIC;`);
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${SIG} FROM anon;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${SIG} TO authenticated, service_role;`);
  });

  it("memakai filter yang sama persis dengan buku_besar_mutasi_semua", () => {
    for (const klausa of [
      "j.status = 'posted'",
      "j.tanggal BETWEEN p_tgl_awal AND p_tgl_akhir",
      "(p_include_penutup OR COALESCE(j.tipe, '') <> 'penutup')",
      "(p_departemen_ids IS NULL OR j.departemen_id = ANY(p_departemen_ids))",
      "(j.tipe <> 'pembalik' OR j.tipe IS NULL)",
      "NOT EXISTS (SELECT 1 FROM jurnal jp WHERE jp.jurnal_asal_id = j.id)",
    ]) {
      expect(base).toContain(klausa);
      expect(migration).toContain(klausa);
    }
  });

  it("mengembalikan total debit, total kredit, dan jumlah baris per akun", () => {
    expect(migration).toContain("RETURNS TABLE(akun_id uuid, total_debit numeric, total_kredit numeric, jumlah integer)");
    expect(migration).toContain("GROUP BY jd.akun_id");
    expect(migration).toContain("COUNT(*)");
  });
});

describe("halaman Buku Besar: Semua akun tidak lagi mengunduh seluruh mutasi di layar", () => {
  it("layar memakai hook ringkasan, bukan hook mutasi semua akun", () => {
    expect(page).toContain("useBukuBesarRingkasanSemua");
    expect(page).not.toContain("useBukuBesarSemua");
    expect(hook).toContain('.rpc("buku_besar_ringkasan_semua"');
    expect(hook).not.toContain("export function useBukuBesarSemua");
  });

  it("mutasi rinci per akun dimuat malas lewat fungsi per akun yang sudah ada, hanya saat baris dibuka", () => {
    expect(page).toContain("MutasiAkunMalas");
    // komponen malas dipasang di dalam AccordionContent (Radix tidak me-render konten yang tertutup)
    expect(page).toMatch(/<AccordionContent>[\s\S]*?<MutasiAkunMalas/);
    expect(page).toMatch(/function MutasiAkunMalas[\s\S]*?useBukuBesar\(/);
  });

  it("mutasi rinci semua akun hanya diambil saat export (fungsi fetch terpisah, bukan query layar)", () => {
    expect(hook).toContain("export async function fetchBukuBesarSemuaRinci");
    expect(page).toContain("fetchBukuBesarSemuaRinci");
    expect(page).toMatch(/const exportSemua = async/);
  });

  it("export xlsx memuat sheet Ringkasan dan sheet Mutasi", () => {
    expect(page).toContain("downloadSheetsXlsx");
    expect(page).toContain("buildBukuBesarRingkasanAoa");
    expect(page).toContain("buildBukuBesarSemuaAoa");
  });

  it("tersedia kotak cari dan filter hanya akun bermutasi", () => {
    expect(page).toContain("filterRingkasan");
    expect(page).toContain("Cari kode atau nama akun");
    expect(page).toContain("Hanya akun yang ada mutasi");
  });
});

// Regresi #248: penggantian blok halaman ikut menghapus kartu tabel mutasi mode satu akun
// (tabel, Export, Total, Saldo Akhir) sehingga memilih satu akun hanya menampilkan kartu info.
describe("halaman Buku Besar: mode satu akun tetap menampilkan tabel mutasi", () => {
  it("merender DataTable berisi computedData, export satu akun, total, dan saldo akhir", () => {
    expect(page).toMatch(/\{akunId && !modeSemua && \(/);
    expect(page).toContain("<DataTable");
    expect(page).toContain("data={computedData}");
    expect(page).toContain("loading={isLoading}");
    expect(page).toContain('onExcel={() => exportSingle("xlsx")}');
    expect(page).toContain('onCsv={() => exportSingle("csv")}');
    expect(page).toContain("Saldo Awal per");
    expect(page).toContain("Total Debit:");
    expect(page).toContain("Total Kredit:");
    expect(page).toContain("Saldo Akhir:");
  });

  it("tidak ada fungsi/nilai penting yang didefinisikan tetapi tidak dipakai (tanda blok tampilan hilang)", () => {
    for (const nama of ["exportSingle", "exportSemua", "computedData", "totalDebit", "totalKredit", "saldoAkhir", "columns", "saldoAwal"]) {
      const pakai = page.match(new RegExp(`\\b${nama}\\b`, "g"))?.length ?? 0;
      expect(pakai, `${nama} harus dipakai di luar definisinya`).toBeGreaterThanOrEqual(2);
    }
  });

  it("kartu ringkasan periode untuk mode Semua akun tetap ada", () => {
    expect(page).toContain("Semua akun rekening</span>");
    expect(page).toContain("Periode:");
  });
});
