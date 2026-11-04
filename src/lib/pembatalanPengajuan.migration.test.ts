import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261104150000_pembatalan_pembayaran_pengajuan.sql", "utf8");

describe("migrasi pengajuan pembatalan pembayaran", () => {
  it("tabel tertutup untuk klien dan hanya satu pengajuan menunggu per pembayaran", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.pembatalan_pembayaran_pengajuan");
    expect(sql).toContain("ALTER TABLE public.pembatalan_pembayaran_pengajuan ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.pembatalan_pembayaran_pengajuan FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*pembatalan_pembayaran_pengajuan/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*\(pembayaran_id\)\s+WHERE status = 'menunggu'/);
  });

  it("pembayaran tidak memakai FK karena barisnya dihapus saat pembatalan; ringkasannya disimpan sebagai snapshot", () => {
    expect(sql).not.toMatch(/pembayaran_id uuid[^,]*REFERENCES/i);
    expect(sql).toContain("snapshot jsonb NOT NULL");
  });

  it("status dibatasi; keputusan final wajib tercatat (pemutus atau waktu, karena pemutus boleh SET NULL saat akun dihapus)", () => {
    expect(sql).toContain("CHECK (status IN ('menunggu','disetujui','ditolak','dibatalkan'))");
    expect(sql).toMatch(/CHECK \(status = 'menunggu' OR diputuskan_oleh IS NOT NULL OR diputuskan_at IS NOT NULL\)/);
    expect(sql).toContain("diputuskan_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL");
  });

  it("baris tidak dapat dihapus, isi pengajuan tidak dapat diubah, dan keputusan bersifat final", () => {
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON public.pembatalan_pembayaran_pengajuan");
    expect(sql).toContain("Pengajuan pembatalan tidak dapat dihapus");
    expect(sql).toContain("Pengajuan pembatalan yang sudah diputuskan tidak dapat diubah");
    expect(sql).toContain("Isi pengajuan pembatalan tidak dapat diubah");
  });

  it.each([
    "ajukan_pembatalan_pembayaran(uuid,text,uuid)",
    "setujui_pembatalan_pembayaran(uuid,uuid,date,text)",
    "tolak_pembatalan_pembayaran(uuid,uuid,text)",
    "batalkan_pengajuan_pembatalan(uuid,uuid)",
  ])("fungsi %s hanya dapat dipanggil service_role", (signature) => {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`);
  });

  it("persetujuan dicek ulang di database: izin, bukan pengaju sendiri, dan memakai pembatalan atomik yang sama", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.setujui_pembatalan_pembayaran"));
    expect(body).toContain("public.has_permission(p_actor_id, 'keuangan.pembatalan.setujui')");
    expect(body).toContain("v_row.diajukan_oleh = p_actor_id");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("public.batalkan_pembayaran_dengan_kuitansi_atomik(");
  });

  it("pengajuan dicek izin ajukan, alasan minimal 5 karakter, dan pembayaran harus ada", () => {
    const body = sql.slice(sql.indexOf("FUNCTION public.ajukan_pembatalan_pembayaran"), sql.indexOf("FUNCTION public.setujui_pembatalan_pembayaran"));
    expect(body).toContain("public.has_permission(p_actor_id, 'keuangan.pembatalan.ajukan')");
    expect(body).toContain("length(v_alasan) < 5");
    expect(body).toContain("Pembayaran tidak ditemukan");
  });

  it("penolakan wajib beralasan dan pembatalan pengajuan hanya oleh pengaju atau admin", () => {
    const tolak = sql.slice(sql.indexOf("FUNCTION public.tolak_pembatalan_pembayaran"), sql.indexOf("FUNCTION public.batalkan_pengajuan_pembatalan"));
    expect(tolak).toContain("length(v_catatan) < 5");
    expect(tolak).toContain("public.has_permission(p_actor_id, 'keuangan.pembatalan.setujui')");
    const batal = sql.slice(sql.indexOf("FUNCTION public.batalkan_pengajuan_pembatalan"));
    expect(batal).toContain("v_row.diajukan_oleh <> p_actor_id");
    expect(batal).toContain("public.has_role(p_actor_id, 'admin')");
  });

  it("memuat petunjuk rollback dan tidak diterapkan otomatis", () => {
    expect(sql).toContain("Mengembalikan ke keadaan lama");
    expect(sql).toContain("Tidak diterapkan otomatis ke produksi");
  });
});
