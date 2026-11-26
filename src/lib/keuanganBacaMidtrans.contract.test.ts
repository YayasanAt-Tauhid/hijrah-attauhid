import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const berkas = resolve(process.cwd(), "supabase/migrations/20261126040000_keuangan_baca_transaksi_midtrans.sql");
const sql = existsSync(berkas) ? readFileSync(berkas, "utf8") : "";
// Hanya SQL yang dieksekusi; komentar boleh menyebut kata apa pun.
const sqlAktif = sql.split("\n").filter((baris) => !baris.trimStart().startsWith("--")).join("\n");

describe("Migrasi akses baca: keuangan membaca transaksi Midtrans (/keuangan/online-payment)", () => {
  it("ada dan hanya memberi izin SELECT", () => {
    expect(sql).not.toBe("");
    expect(sqlAktif).not.toMatch(/FOR\s+(ALL|INSERT|UPDATE|DELETE)/i);
    expect(sqlAktif).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\b|\bALTER\b|\bUPDATE\b|\bINSERT\b/i);
    expect(sqlAktif).not.toMatch(/\bGRANT\b/i);
    expect(sqlAktif.match(/FOR SELECT/g)).toHaveLength(2);
  });

  it("memberi keuangan hak baca transaksi_midtrans", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS keuangan_baca_transaksi_midtrans ON public.transaksi_midtrans;");
    expect(sql).toMatch(
      /CREATE POLICY keuangan_baca_transaksi_midtrans ON public\.transaksi_midtrans\s+FOR SELECT TO authenticated/,
    );
  });

  it("memberi keuangan hak baca transaksi_midtrans_item", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS keuangan_baca_transaksi_midtrans_item ON public.transaksi_midtrans_item;");
    expect(sql).toMatch(
      /CREATE POLICY keuangan_baca_transaksi_midtrans_item ON public\.transaksi_midtrans_item\s+FOR SELECT TO authenticated/,
    );
  });

  it("memakai has_role keuangan (bendahara/sekretaris ber-izin ikut lewat fungsi itu)", () => {
    expect(sqlAktif.match(/public\.has_role\(auth\.uid\(\), 'keuangan'\)/g)).toHaveLength(2);
  });

  it("mendokumentasikan cara membatalkan", () => {
    expect(sql).toMatch(/Rollback/i);
    expect(sql).toContain("DROP POLICY keuangan_baca_transaksi_midtrans ON public.transaksi_midtrans;");
    expect(sql).toContain("DROP POLICY keuangan_baca_transaksi_midtrans_item ON public.transaksi_midtrans_item;");
  });
});
