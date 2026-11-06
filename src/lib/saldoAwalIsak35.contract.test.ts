import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261106050000_saldo_awal_isak35_kontra_pendapatan.sql"),
  "utf8",
);

describe("migrasi saldo awal ISAK 35 dengan akun kontra-pendapatan", () => {
  it("tidak diterapkan otomatis ke produksi", () => {
    expect(migration).toContain("Tidak diterapkan otomatis ke produksi");
  });

  it("mengganti fungsi yang sama dengan tanda tangan yang sama dan atribut keamanan tetap", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.isi_saldo_awal_isak35\(\s*p_tahun_ditutup integer,\s*p_tgl_mulai date,\s*p_tgl_selesai date,\s*p_kategori text\[\]\s*\)/,
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path TO 'public'");
  });

  it("mempertahankan pemeriksaan peran admin/keuangan", () => {
    expect(migration).toContain("public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'keuangan')");
  });

  it("membawa saldo_normal ke kedua sumber saldo (mutasi dan saldo awal lama)", () => {
    expect(migration).toMatch(/SELECT j\.departemen_id, jd\.akun_id, ar\.jenis, ar\.saldo_normal,/);
    expect(migration).toMatch(/SELECT s\.departemen_id, s\.akun_id, ar\.jenis, ar\.saldo_normal, s\.saldo/);
  });

  it("surplus: kontra-pendapatan (saldo normal D) dibalik tandanya, kontra-beban (K) juga", () => {
    expect(migration).toContain("WHEN jenis = 'pendapatan' THEN (CASE WHEN saldo_normal = 'D' THEN -saldo ELSE saldo END)");
    expect(migration).toContain("WHEN jenis = 'beban'      THEN -(CASE WHEN saldo_normal = 'K' THEN -saldo ELSE saldo END)");
  });

  it("baris neraca tetap menurut sisi normal akun (tidak ikut dibalik)", () => {
    expect(migration).toMatch(/neraca AS \(\s*SELECT departemen_id, akun_id, saldo FROM semua\s*WHERE jenis IN \('aset','liabilitas','ekuitas'\)/);
  });

  it("jurnal penutup tetap dikecualikan dan hanya jurnal posted yang dihitung", () => {
    expect(migration).toContain("COALESCE(j.tipe,'') <> 'penutup'");
    expect(migration).toContain("j.status = 'posted'");
  });
});
