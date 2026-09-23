import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923073500_internal_department_transfer.sql"),
  "utf8",
);
const page = readFileSync(resolve(process.cwd(), "src/pages/akademik/MutasiSiswa.tsx"), "utf8");

describe("internal department transfer contract", () => {
  it("moves an active student atomically without deleting prior history", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.akademik_mutasi_antar_lembaga");
    expect(migration).toContain("UPDATE public.kelas_siswa");
    expect(migration).toContain("INSERT INTO public.kelas_siswa");
    expect(migration).toContain("departemen_id=p_departemen_tujuan_id");
    expect(migration).toContain("angkatan_id=p_angkatan_tujuan_id");
    expect(migration).toContain("nis=new_nis");
    expect(migration).not.toContain("DELETE FROM public.kelas_siswa");
  });

  it("preserves a completed SPMB as historical verification", () => {
    expect(migration).toContain("COALESCE(d.spmb_status_pendaftaran, '') = 'selesai'");
    expect(migration).toContain("tidak mengubah hasil verifikasi SPMB lama");
  });

  it("records old and new unit, class, NIS, boarding status, and reason", () => {
    expect(migration).toContain("siswa_mutasi_departemen_audit");
    expect(migration).toContain("nis_lama,nis_baru");
    expect(migration).toContain("status_asrama_lama,status_asrama_baru");
    expect(migration).toContain("alasan,changed_by");
    expect(migration).toContain("siswa_tahun_masuk_departemen");
  });

  it("keeps MTA non-boarding exception explicit for existing internal students", () => {
    expect(migration).toContain("target_code IN ('SMP','SMA','MTA')");
    expect(migration).toContain("murid lama/internal");
    expect(page).toContain("Non Asrama — murid lama/internal");
  });

  it("exposes a dedicated UI and uses the atomic RPC", () => {
    expect(page).toContain('value="internal"');
    expect(page).toContain("Pindah Antar Lembaga Internal");
    expect(page).toContain('rpc("akademik_mutasi_antar_lembaga"');
    expect(page).toContain("Tagihan dan histori SPMB lama tidak dihapus");
  });
});
