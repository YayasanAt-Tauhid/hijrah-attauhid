import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/AppSidebar.tsx"), "utf8");
const keuanganPage = readFileSync(resolve(process.cwd(), "src/pages/Keuangan.tsx"), "utf8");
const pembayaranPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/InputPembayaran.tsx"), "utf8");
const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/PembayaranPMB.tsx"), "utf8");
const rekapKasirPage = readFileSync(resolve(process.cwd(), "src/pages/keuangan/RekapKasirSaya.tsx"), "utf8");
const kuitansi = readFileSync(resolve(process.cwd(), "src/components/shared/PrintKuitansi.tsx"), "utf8");
const pembayaranServer = readFileSync(resolve(process.cwd(), "src/server/pembayaran.ts"), "utf8");
const spmbRoute = readFileSync(resolve(process.cwd(), "src/routes/_protected._app.keuangan.pembayaran-spmb.tsx"), "utf8");
const rekapRoute = readFileSync(resolve(process.cwd(), "src/routes/_protected._app.keuangan.rekap-kasir.tsx"), "utf8");

// Siswa nonaktif hanya boleh dilayani untuk pelunasan tunggakan yang sudah tercatat.\ndescribe("Kasir payment access contract", () => {
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
    expect(pembayaranPage).toContain("include_nonaktif_with_open_bills: true");
    expect(pembayaranServer).toContain('["aktif", "keluar", "alumni", "pindah"]');
    expect(pembayaranServer).toContain('.in("status", ["belum_bayar", "sebagian"])');
    expect(spmbPage).toContain('status: "calon"');
  });

  it("allows inactive students to settle old arrears without opening new obligations", () => {
    expect(pembayaranPage).toContain("Siswa nonaktif hanya dapat membayar tunggakan lama");
    expect(pembayaranPage).toContain('["keluar", "alumni", "pindah"]');
    expect(pembayaranPage).toContain("payableTagihanStatuses");
    expect(pembayaranServer).toContain("Siswa berstatus keluar/alumni hanya dapat membayar tagihan lama yang masih terbuka.");
    expect(pembayaranServer).toContain("Siswa berstatus keluar/alumni tidak dapat membayar tagihan baru atau yang belum jatuh tempo.");
  });

  it("limits cashier recap to the logged-in employee and preserves cancellation separation", () => {
    expect(pembayaranServer).toContain('export const getRekapKasirSaya');
    expect(pembayaranServer).toContain('.in("petugas_id", [userId, profile.pegawai_id])');
    expect(pembayaranServer).toContain('// BUKAN kasir — hanya admin/keuangan');
    expect(pembayaranServer).toContain('await requireRole(admin, userId, [\n        "admin",\n        "keuangan",\n      ])');
  });

  it("never prints NIK and uses NIS/NISN as the cashier receipt identity", () => {
    expect(kuitansi).toContain("NIS / NISN");
    expect(kuitansi).toContain("payment.siswa.nisn");
    expect(kuitansi).not.toContain(">NIK<");
  });

  it("shows a cashier-only finance landing and printable SPMB receipt", () => {
    expect(keuanganPage).toContain('if (role === "kasir") return <KasirKeuanganLanding />');
    expect(keuanganPage).toContain("Laporan yayasan dan menu akuntansi tidak ditampilkan untuk kasir.");
    expect(spmbPage).toContain("<DialogTitle>Kuitansi Pembayaran SPMB</DialogTitle>");
    expect(spmbPage).toContain("Cetak Kuitansi");
  });
});
