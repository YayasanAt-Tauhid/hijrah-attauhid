import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminForm = readFileSync(resolve(process.cwd(), "src/components/akademik/AdminSpmbRegistrationDialog.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924104500_spmb_admin_inputer_audit.sql"), "utf8");

describe("Admin SPMB registration parity", () => {
  it("uses the same registration engine for public and admin registration", () => {
    expect(server).toContain("async function performPmbRegistration");
    expect(server).toContain("performPmbRegistration(data)");
    expect(server).toContain("spmbAdminDaftar");
    expect(server).toContain("performPmbRegistration(data, { userId: actor.userId");
    expect(server).toContain('requireAcademicDepartment(admin, actor.userId, dept.id, ["admin", "admin_tu"])');
  });

  it("admin form contains the public SPMB data sections and document rules", () => {
    for (const label of [
      "Data Diri Murid",
      "Data Ayah",
      "Data Ibu",
      "Data Sekolah Asal",
      "Data Kemampuan Dasar Murid",
      "Dokumen Persyaratan",
      "Nama Pendaftar",
      "No. HP / WhatsApp yang Bisa Dihubungi",
      "Rentang Penghasilan",
      "Kartu Keluarga",
      "Akta Kelahiran",
    ]) {
      expect(adminForm).toContain(label);
    }
    expect(adminForm).toContain("pmbCreateDocumentUpload");
    expect(adminForm).toContain("spmbAdminDaftar");
    expect(adminForm).toContain("SPMB_TRANSFER_CATEGORY_VALUE");
  });

  it("keeps the full admin form scrollable inside the dialog viewport", () => {
    expect(adminForm).toContain('h-[94dvh] max-h-[94dvh]');
    expect(adminForm).toContain('className="flex min-h-0 flex-1 flex-col overflow-hidden"');
    expect(adminForm).toContain("overflow-y-auto overscroll-contain");
    expect(adminForm).toContain("touch-pan-y");
    expect(adminForm).toContain("shrink-0 border-b");
    expect(adminForm).toContain("shrink-0 flex-col-reverse");
  });

  it("classifies admin registration as offline and public registration as online", () => {
    expect(adminForm).toContain('value="Offline — Admin / TU"');
    expect(server).toContain('spmb_sumber_pendaftaran: actor ? "admin" : "publik"');
    expect(page).toContain('"Pendaftaran Online"');
    expect(page).toContain('"Pendaftaran Offline"');
    expect(page).toContain('detail?.spmb_sumber_pendaftaran === "admin"');
    expect(page).toContain('detail?.spmb_sumber_pendaftaran === "publik"');
    expect(page).toContain('"Belum diklasifikasikan"');
  });

  it("persists and exposes the authenticated inputer audit", () => {
    expect(migration).toContain("spmb_inputer_user_id");
    expect(migration).toContain("spmb_inputer_nama");
    expect(migration).toContain("spmb_inputer_email");
    expect(migration).toContain("spmb_sumber_pendaftaran");
    expect(server).toContain('spmb_sumber_pendaftaran: actor ? "admin" : "publik"');
    expect(page).toContain('label: "Nama Pendaftar"');
    expect(page).toContain("_spmbInputer");
    expect(page).toContain("spmbAdminUpdateRegistrantName");
    expect(page).toContain("Edit Nama Pendaftar");
    expect(server).toContain("spmbAdminUpdateRegistrantName");
    expect(server).toContain('requireAcademicDepartment(admin, actor.userId, departemenId, ["admin", "admin_tu"])');
  });
});
