import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261104040000_spmb_withdrawal.sql"),
  "utf8",
);

describe("migrasi pengunduran diri pendaftar SPMB", () => {
  it("menambah status 'mengundurkan_diri' ke constraint status pendaftaran tanpa menghapus status lama", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS siswa_detail_spmb_status_pendaftaran_check");
    expect(migration).toContain("IN ('calon','diterima','aktif','selesai','mengundurkan_diri')");
  });

  it("mencatat siapa, kapan, mengapa, dan perlunya tindak lanjut keuangan", () => {
    for (const column of [
      "spmb_mundur_at", "spmb_mundur_tanggal_efektif", "spmb_mundur_alasan", "spmb_mundur_oleh",
      "spmb_mundur_status_sebelumnya", "spmb_mundur_total_dibayar", "spmb_mundur_perlu_keuangan",
    ]) expect(migration).toContain(column);
  });

  it("dibatasi ke service role; otorisasi lembaga di server function, peran dicek ulang di RPC", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.spmb_withdraw_registration");
    expect(migration).toContain("FROM PUBLIC,anon,authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("public.has_role(p_actor_id,'admin')");
    expect(migration).toContain("public.has_role(p_actor_id,'admin_tu')");
  });

  it("hanya untuk calon/diterima yang belum diaktivasi dan menolak dua kali mundur", () => {
    expect(migration).toContain("IN ('calon','diterima')");
    expect(migration).toContain("spmb_tanggal_aktivasi IS NOT NULL");
    expect(migration).toContain("Alasan pengunduran diri wajib diisi minimal 5 karakter");
  });

  it("membatalkan tagihan belum dibayar lewat fungsi pembatalan yang sudah ada (jurnal pembalik, tutup buku)", () => {
    expect(migration).toContain("public.batalkan_tagihan_atomik");
    expect(migration).toContain("t.status IN ('terjadwal','belum_bayar')");
  });

  it("menjumlahkan hanya pembayaran aktif sebagai dasar tindak lanjut keuangan, tanpa refund otomatis", () => {
    expect(migration).toContain("p.status = 'aktif'");
    expect(migration).not.toMatch(/INSERT INTO public\.(pembayaran|jurnal)\b/i);
    expect(migration).not.toContain("batalkan_pembayaran_atomik");
  });

  it("menonaktifkan rencana tagihan, melepas kelas, dan mengakhiri diskon pendaftar eksternal", () => {
    expect(migration).toContain("UPDATE public.rencana_tagihan_siswa");
    expect(migration).toContain("UPDATE public.kelas_siswa SET aktif = false");
    expect(migration).toContain("UPDATE public.siswa_diskon");
    expect(migration).toContain("UPDATE public.siswa SET status = 'mengundurkan_diri'");
  });

  it("pendaftar internal hanya ditandai: status siswa, tagihan, rencana, dan kelas lembaga asal tidak disentuh", () => {
    expect(migration).toContain("IF COALESCE(d.spmb_siswa_internal,false) THEN");
    const internalBranch = migration.slice(
      migration.indexOf("IF COALESCE(d.spmb_siswa_internal,false) THEN"),
      migration.indexOf("ELSE", migration.indexOf("IF COALESCE(d.spmb_siswa_internal,false) THEN")),
    );
    expect(internalBranch).not.toContain("UPDATE public.siswa ");
    expect(internalBranch).not.toContain("batalkan_tagihan_atomik");
    expect(internalBranch).not.toContain("kelas_siswa");
  });

  it("tidak melepas NIS: tidak ada perubahan kolom nis maupun riwayat NIS", () => {
    expect(migration).not.toMatch(/\bnis\s*=/i);
    expect(migration).not.toContain("siswa_tahun_masuk_departemen");
    expect(migration).toContain("NIS yang sudah terbit tetap tercatat");
  });
});
