import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(process.cwd(), "src/pages/portal/SPMBDaftarOnlineV2.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");
const monitoring = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");

describe("Public SPMB registrant/inputer", () => {
  it("requires a registrant name on /spmb", () => {
    expect(page).toContain('pendaftar_nama: ""');
    expect(page).toContain('label: "Nama Pendaftar / Inputer"');
    expect(page).toContain('id="spmb-public-pendaftar"');
    expect(page).toContain('Nama akun tidak tersedia otomatis. Silakan isi nama pendaftar secara manual; kolom ini wajib.');
  });

  it("autofills and locks the registrant for logged-in users", () => {
    expect(page).toContain("supabase.auth.getSession()");
    expect(page).toContain('pegawai:pegawai_id(nama)');
    expect(page).toContain("identity_data");
    expect(page).toContain("setPendaftarLocked(Boolean(namaPendaftar))");
    expect(page).toContain("disabled={pendaftarLocked}");
    expect(page).toContain("Terisi otomatis dari nama akun yang sedang login.");
    expect(page).not.toContain("namaPendaftar =\n        String(user.user_metadata?.full_name || user.user_metadata?.name || \"\").trim() ||\n        email");
  });

  it("validates and persists the registrant on the server", () => {
    expect(server).toContain("pendaftar_nama?: string");
    expect(server).toContain('throw new Error("Nama Pendaftar / Inputer wajib diisi")');
    expect(server).toContain("spmb_inputer_nama: inputerNama");
    expect(server).toContain('spmb_sumber_pendaftaran: actor ? "admin" : "publik"');
    expect(server).not.toContain("inputerNama = pegawai?.nama || inputerEmail");
  });

  it("keeps the inputer visible in SPMB monitoring/export", () => {
    expect(monitoring).toContain('label: "Petugas / Inputer"');
    expect(monitoring).toContain("_spmbInputer");
  });
});
