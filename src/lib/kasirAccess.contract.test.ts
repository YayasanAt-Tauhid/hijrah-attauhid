import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/AppSidebar.tsx"), "utf8");
const keuanganPage = readFileSync(resolve(process.cwd(), "src/pages/Keuangan.tsx"), "utf8");
const pembayaranPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/InputPembayaran.tsx"), "utf8");
const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/PembayaranPMB.tsx"), "utf8");
const rekapKasirPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/RekapKasirSaya.tsx"), "utf8");
const pembayaranServer = readFileSync(resolve(process.cwd(), "src/server/pembayaran.ts"), "utf8");
const spmbRoute = readFileSync(resolve(process.cwd(), "src/routes/_protected._app.keuangan.pembayaran-spmb.tsx"), "utf8");
const rekapRoute = readFileSync(resolve(process.cwd(), "src/routes/_protected._app.keuangan.rekap-kasir.tsx"), "utf8");

describe("Kasir payment access contract", () => {
  it("exposes only the intended cashier operational menu", () => {
    expect(sidebar).toContain('{ title: "Input Pembayaran", url: "/keuangan/pembayaran", roles: ["admin", "keuangan", "kasir"] }');
    expect(sidebar).toContain('{ title: "Pembayaran SPMB", url: "/keuangan/pembayaran-spmb", roles: ["admin", "keuangan", "kasir"] }');
    expect(sidebar).toContain('{ title: "Tunggakan", url: "/keuangan/tunggakan", roles: ["admin", "keuangan", "kasir"] }');
    expect(sidebar).toContain('{ title: "Rekap Kasir Saya", url: "/keuangan/rekap-kasir", roles: ["admin", "keuangan", "kasir"] }');
    expect(sidebar).toContain('{ title: "Rekap Harian", url: "/keuangan/rekap-harian", roles: ["admin", "keuangan"] }');
  });

  it("keeps SPMB and cashier recap outside the admin/finance-only route group", () => {
    expect(spmbRoute).toContain('createFileRoute("/_protected/_app/keuangan/pembayaran-spmb")');
    expect(spmbRoute).not.toContain("/_finance/");
    expect(rekapRoute).toContain('createFileRoute("/_protected/_app/keuangan/rekap-kasir")');
  });

  it("fails closed for shared finance pages while allowing admin, finance and cashier", () => {
    expect(pembayaranPage).toContain('!["admin", "keuangan", "kasir"].includes(role)');
    expect(spmbPage).toContain('!["admin", "keuangan", "kasir"].includes(role)');
    expect(rekapKasirPage).toContain('!["admin", "keuangan", "kasir"].includes(role)');
  });

  it("searches students through a role-checked server function instead of granting cashier full student-table access", () => {
    expect(pembayaranServer).toContain('export const cariSiswaPembayaran');
    expect(pembayaranServer).toContain('await requireRole(admin, userId, ["admin", "keuangan", "kasir"])');
    expect(pembayaranPage).toContain("cariSiswaPembayaran");
    expect(spmbPage).toContain('status: "calon"');
  });

  it("limits cashier recap to the logged-in employee and preserves cancellation separation", () => {
    expect(pembayaranServer).toContain('export const getRekapKasirSaya');
    expect(pembayaranServer).toContain('.eq("petugas_id", profile.pegawai_id)');
    expect(pembayaranServer).toContain('// BUKAN kasir — hanya admin/keuangan');
    expect(pembayaranServer).toContain('await requireRole(admin, userId, [\n        "admin",\n        "keuangan",\n      ])');
  });

  it("shows a cashier-only finance landing and printable SPMB receipt", () => {
    expect(keuanganPage).toContain('if (role === "kasir") return <KasirKeuanganLanding />');
    expect(keuanganPage).toContain("Laporan yayasan dan menu akuntansi tidak ditampilkan untuk kasir.");
    expect(spmbPage).toContain("<DialogTitle>Kuitansi Pembayaran SPMB</DialogTitle>");
    expect(spmbPage).toContain("Cetak Kuitansi");
  });
});
