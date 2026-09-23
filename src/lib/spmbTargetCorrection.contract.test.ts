import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924010000_spmb_change_registration_target.sql"),
  "utf8",
);
const page = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");

describe("SPMB target correction contract", () => {
  it("keeps the same registration and blocks changes after activation", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.spmb_change_registration_target");
    expect(migration).toContain("SPMB sudah selesai/diaktivasi. Gunakan Mutasi Antar Lembaga.");
    expect(migration).toContain("'pendaftaran_id',d.pendaftaran_id");
    expect(migration).not.toContain("DELETE FROM public.siswa");
  });

  it("resets target-specific milestones and old target placement safely", () => {
    expect(migration).toContain("spmb_status_pendaftaran='calon'");
    expect(migration).toContain("spmb_tanggal_tes=NULL");
    expect(migration).toContain("spmb_status_kelulusan=NULL");
    expect(migration).toContain("spmb_tanggal_daftar_ulang=NULL");
    expect(migration).toContain("spmb_kelas_tujuan_id=NULL");
    expect(migration).toContain("UPDATE public.kelas_siswa ks");
    expect(migration).toContain("nis=NULL");
  });

  it("preserves internal students at their current academic unit", () => {
    expect(migration).toContain("IF internal_student THEN");
    expect(migration).toContain("Siswa masih aktif pada lembaga asal");
  });

  it("does not silently transfer real payments and corrects free promo accounting atomically", () => {
    expect(migration).toContain("sudah ada pembayaran atau order pembayaran aktif");
    expect(migration).toContain("spmb_retarget_cancel_promo");
    expect(migration).toContain("KOREKSI TUJUAN SPMB");
    expect(migration).toContain("spmb_apply_first_wave_promo(p_siswa_id)");
  });

  it("exposes a dedicated correction UI", () => {
    expect(page).toContain("Ubah Lembaga/Jenjang Tujuan SPMB");
    expect(page).toContain("Ubah Tujuan");
    expect(page).toContain('rpc("spmb_change_registration_target"');
    expect(page).toContain("Pendaftaran yang sama tetap dipakai");
  });
});
