import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261123043000_pemilik_tabel_pengajuan_pembatalan.sql", "utf8");

// Di Rustbase, aplikasi terhubung sebagai proj_kqylkreswang_admin (pemilik tabel, jadi lolos RLS).
// Tabel yang dibuat oleh role lain dengan RLS tanpa policy terbaca kosong tanpa galat.
describe("migrasi pemilik tabel RLS tanpa policy (Rustbase)", () => {
  it.each(["pembatalan_pembayaran_pengajuan", "log_potongan_saudara"])(
    "tabel %s dipindah ke pemilik role aplikasi",
    (tabel) => {
      expect(sql).toContain(`ALTER TABLE public.${tabel} OWNER TO proj_kqylkreswang_admin`);
    },
  );

  it("hanya berjalan bila role aplikasi ada dan tabelnya ada, agar aman di lingkungan lain", () => {
    expect(sql).toMatch(/pg_roles WHERE rolname = 'proj_kqylkreswang_admin'/);
    expect(sql).toContain("to_regclass('public.pembatalan_pembayaran_pengajuan')");
    expect(sql).toContain("to_regclass('public.log_potongan_saudara')");
  });

  it("tidak membuka akses klien: tanpa policy baru dan tanpa GRANT ke anon/authenticated", () => {
    const kode = sql.replace(/--.*$/gm, ""); // periksa pernyataan SQL saja, bukan komentar
    expect(kode).not.toMatch(/CREATE POLICY/i);
    expect(kode).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
    expect(kode).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});
