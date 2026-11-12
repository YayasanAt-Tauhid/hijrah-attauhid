import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrasi = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261112070000_relabel_kuitansi_lama_saldo_piutang.sql"),
  "utf8",
);

describe("relabel kuitansi lama Saldo Piutang Lama — migrasi arsip", () => {
  it("hanya mengubah payment_type_name dan description pada payment_receipt_items", () => {
    // pernyataan UPDATE sebenarnya ada di akhir file; komentar rollback di header juga memuat kata yang sama
    const update = migrasi.slice(migrasi.lastIndexOf("UPDATE public.payment_receipt_items"));
    expect(update).toContain("SET payment_type_name = a.new_payment_type_name,");
    expect(update).toContain("description = a.new_description");
    for (const kolom of ["amount =", "status =", "receipt_id =", "payment_id =", "tagihan_id =", "line_no =", "bulan ="]) {
      expect(update).not.toContain(kolom);
    }
    expect(migrasi).not.toMatch(/UPDATE\s+public\.payment_receipts\b/i);
    expect(migrasi).not.toMatch(/DELETE\s+FROM/i);
    expect(migrasi).not.toMatch(/\bDROP\b/i);
  });

  it("menyimpan nama lama di tabel audit yang terlindungi sebelum mengubah", () => {
    expect(migrasi).toContain("CREATE TABLE IF NOT EXISTS migration.kuitansi_relabel_20261112");
    expect(migrasi).toContain("old_payment_type_name text NOT NULL");
    expect(migrasi).toContain("old_description text NOT NULL");
    expect(migrasi).toContain("ALTER TABLE migration.kuitansi_relabel_20261112 ENABLE ROW LEVEL SECURITY;");
    expect(migrasi).not.toMatch(/\bGRANT\b/i);
    expect(migrasi.indexOf("INSERT INTO migration.kuitansi_relabel_20261112")).toBeLessThan(
      migrasi.lastIndexOf("UPDATE public.payment_receipt_items"),
    );
  });

  it("aman dijalankan ulang dan hanya menyentuh tagihan yang berlabel", () => {
    expect(migrasi).toContain("ON CONFLICT (receipt_item_id) DO NOTHING;");
    expect(migrasi).toContain("AND i.payment_type_name = a.old_payment_type_name");
    expect(migrasi).toContain("AND i.description = a.old_description;");
    expect(migrasi).toContain("WHERE NULLIF(btrim(t.label_tampil), '') IS NOT NULL");
  });

  it("menyertakan SQL rollback yang mengembalikan nama lama dari audit", () => {
    expect(migrasi).toContain("SET payment_type_name = a.old_payment_type_name, description = a.old_description");
    expect(migrasi).toContain("AND i.payment_type_name = a.new_payment_type_name;");
  });
});
