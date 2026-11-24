// Kontrak pendaftaran halaman Proyeksi Tagihan SPP: route di grup _finance (dijaga izin per alamat),
// menu sidebar, tautan halaman Keuangan, breadcrumb, dan konsistensi nama RPC antara migrasi,
// tipe Supabase, dan hook. Alamat yang tidak dipetakan di permissions.ts hanya terbuka untuk admin,
// jadi pemetaan izinnya diuji di permissions.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const baca = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Proyeksi Tagihan SPP: pendaftaran halaman", () => {
  it("route berada di grup _finance dan memakai halaman ProyeksiTagihan", () => {
    const berkas = "src/routes/_protected._app._finance.keuangan.proyeksi-tagihan.tsx";
    expect(existsSync(resolve(process.cwd(), berkas))).toBe(true);
    const route = baca(berkas);
    expect(route).toContain('createFileRoute("/_protected/_app/_finance/keuangan/proyeksi-tagihan")');
    expect(route).toContain("component: ProyeksiTagihan");
    expect(route).toContain('from "@/pages/keuangan/ProyeksiTagihan"');
  });

  it("menu sidebar Laporan & Rekap hanya untuk admin dan keuangan", () => {
    expect(baca("src/components/layout/AppSidebar.tsx")).toContain(
      '{ title: "Proyeksi Tagihan SPP", url: "/keuangan/proyeksi-tagihan", roles: ["admin", "keuangan"] }',
    );
  });

  it("tautan halaman Keuangan dan breadcrumb tersedia", () => {
    expect(baca("src/pages/Keuangan.tsx")).toContain('{ label: "Proyeksi Tagihan SPP", url: "/keuangan/proyeksi-tagihan" }');
    expect(baca("src/components/layout/AppBreadcrumb.tsx")).toContain('"/keuangan/proyeksi-tagihan": "Proyeksi Tagihan SPP"');
  });

  it("nama RPC sama di migrasi, tipe Supabase, dan hook", () => {
    const migrasi = baca("supabase/migrations/20261124083000_ringkasan_tagihan_periode.sql");
    expect(migrasi).toContain("CREATE OR REPLACE FUNCTION public.ringkasan_tagihan_periode(");
    expect(baca("src/integrations/supabase/types.ts")).toContain("ringkasan_tagihan_periode: {");
    expect(baca("src/hooks/useProyeksiTagihan.ts")).toContain('supabase.rpc("ringkasan_tagihan_periode"');
  });
});
