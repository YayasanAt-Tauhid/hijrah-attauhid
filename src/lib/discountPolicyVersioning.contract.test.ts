import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260929090738_discount_policy_versioning.sql"),
  "utf8",
);
const hardening = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260929091143_discount_policy_hardening.sql"),
  "utf8",
);
const server = readFileSync(resolve(process.cwd(), "src/server/diskon.ts"), "utf8");
const page = readFileSync(
  resolve(process.cwd(), "src/pages/keuangan/DiskonSiswa.tsx"),
  "utf8",
);
const reference = readFileSync(
  resolve(process.cwd(), "src/pages/keuangan/ReferensiKeuangan.tsx"),
  "utf8",
);
const policyTab = readFileSync(
  resolve(process.cwd(), "src/pages/keuangan/TabKebijakanKeringanan.tsx"),
  "utf8",
);

describe("discount policy versioning contract", () => {
  it("stores versioned policies without overwriting prior policy history", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.kebijakan_keringanan");
    expect(migration).toContain("CONSTRAINT kebijakan_keringanan_kode_versi_key UNIQUE (kode, versi)");
    expect(migration).toContain("buat_versi_kebijakan_keringanan");
    expect(migration).toContain("SET berlaku_selesai = p_berlaku_mulai - 1");
  });

  it("snapshots the applied discount value and prevents approved discount mutation", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS tipe_snapshot");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS nilai_snapshot");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS kebijakan_snapshot");
    expect(migration).toContain("trg_cegah_mutasi_diskon_disetujui");
    expect(migration).toContain("Materialize the actual value");
  });

  it("seeds the currently agreed PTK and sibling policies but leaves unknown special amounts configurable", () => {
    expect(migration).toContain("ptk_spp_tk");
    expect(migration).toContain("'persen',100::numeric");
    expect(migration).toContain("ptk_spp_sd");
    expect(migration).toContain("'persen',50::numeric");
    expect(migration).toContain("ptk_du_mta_reguler");
    expect(migration).toContain("^MTA (2|3|5|6)$");
    expect(migration).toContain("50000::numeric");
    expect(migration).toContain("Special TK entry/repeat");
  });

  it("adds flexible Keringanan Khusus without forcing a semester duration", () => {
    expect(migration).toContain("'Keringanan Khusus'");
    expect(migration).toContain("Nilai dan masa berlaku ditentukan per pengajuan");
    expect(page).toContain("Mulai Bulan");
    expect(page).toContain("Sampai Bulan");
  });

  it("resolves active policy during application and exposes version management in finance references", () => {
    expect(server).toContain("cariKebijakanKeringananAktif");
    expect(server).toContain("kebijakan_keringanan_id");
    expect(page).toContain("Kebijakan aktif:");
    expect(reference).toContain('value="kebijakan-keringanan"');
    expect(policyTab).toContain("Versi Baru");
    expect(policyTab).toContain("histori tagihan lama tidak ikut berubah");
  });

  it("keeps sibling automation policy-driven instead of hard-coding the amount", () => {
    expect(migration).toContain("v_policy public.kebijakan_keringanan");
    expect(migration).toContain("kk.otomatis=true");
    expect(migration).toContain("v_policy.nilai");
    expect(page).toContain("nilai sesuai <strong>kebijakan aktif</strong>");
  });

  it("keeps the service-only policy table explicit and indexes the new foreign keys", () => {
    expect(hardening).toContain("kebijakan_keringanan_service_role_all");
    expect(hardening).toContain("TO service_role");
    expect(hardening).toContain("idx_kebijakan_keringanan_jenis_id");
    expect(hardening).toContain("idx_kebijakan_keringanan_dibuat_oleh");
    expect(hardening).toContain("idx_siswa_diskon_kebijakan_keringanan_id");
  });
});