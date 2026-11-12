import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migrasi = read("supabase/migrations/20261112060000_kuitansi_label_tampil_tagihan.sql");
const inputPembayaran = read("src/pages/keuangan/InputPembayaran.tsx");
const arsitekturAwal = read("supabase/migrations/20261002090000_payment_receipt_architecture.sql");

describe("kuitansi baru memakai label tagihan — database", () => {
  it("hanya mengganti sumber nama pada item kuitansi baru: label tagihan, lalu nama jenis", () => {
    expect(migrasi).toContain("CREATE OR REPLACE FUNCTION public.append_payment_receipt_item(p_receipt_id uuid, p_payment_id uuid)");
    expect(migrasi).toContain(
      "v_description := COALESCE(NULLIF(btrim(v_tagihan.label_tampil), ''), v_jenis.nama, 'Pembayaran') ||",
    );
    expect(migrasi).toContain(
      "COALESCE(NULLIF(btrim(v_tagihan.label_tampil), ''), NULLIF(btrim(v_jenis.nama), ''), 'Pembayaran'),",
    );
  });

  it("item kuitansi yang sudah ada tetap dikembalikan apa adanya dan tidak pernah diubah atau dihapus", () => {
    expect(migrasi).toContain(
      "FROM public.payment_receipt_items\n  WHERE payment_id = p_payment_id;\n  IF FOUND THEN\n    RETURN jsonb_build_object(",
    );
    expect(migrasi).not.toMatch(/UPDATE\s+public\.payment_receipt_items/i);
    expect(migrasi).not.toMatch(/DELETE\s+FROM\s+public\.payment_receipt_items/i);
    expect(migrasi).not.toMatch(/\bDROP\b/i);
  });

  it("mempertahankan atribut fungsi dan tidak mengubah hak akses (CREATE OR REPLACE)", () => {
    expect(migrasi).toContain("SECURITY DEFINER");
    expect(migrasi).toContain("SET search_path TO 'public'");
    expect(migrasi).not.toMatch(/\bGRANT\b|\bREVOKE\b/i);
  });

  it("selain dua ekspresi nama, isi fungsi sama dengan definisi arsitektur kuitansi", () => {
    for (const bagian of [
      "SELECT * INTO v_receipt",
      "RAISE EXCEPTION 'Kuitansi pembayaran tidak ditemukan'",
      "RAISE EXCEPTION 'Pembayaran tidak ditemukan untuk kuitansi'",
      "total_amount = total_amount + v_payment.jumlah",
      "v_payment.jumlah, 'paid'",
    ]) {
      expect(migrasi).toContain(bagian);
      expect(arsitekturAwal).toContain(bagian);
    }
  });
});

describe("kuitansi baru memakai label tagihan — kasir", () => {
  it("keranjang membawa namaTampil dari label tagihan hanya untuk tampilan cetak", () => {
    expect(inputPembayaran).toContain("namaTampil?: string | null;");
    expect(inputPembayaran).toContain("namaTampil: bill.label_tampil ?? null,");
    expect(inputPembayaran).toContain("namaTampil: item.namaTampil ?? null,");
  });

  it("kuitansi gabungan yang dicetak setelah bayar memakai namaTampil dengan cadangan nama jenis", () => {
    expect(inputPembayaran).toContain("jenisNama: item.namaTampil ?? item.jenisNama,");
  });

  it("logika keranjang (pesan gagal, data yang dikirim ke server) tetap memakai nama jenis", () => {
    expect(inputPembayaran).toContain('gagal.push(item.jenisNama + (item.bulan ? " " + namaBulan(item.bulan) : "") + ": " + message);');
    expect(inputPembayaran).toContain("          jenisNama: item.jenisNama,\n          bulan: item.bulan,\n          tahunLabel: item.tahunLabel,");
  });
});
