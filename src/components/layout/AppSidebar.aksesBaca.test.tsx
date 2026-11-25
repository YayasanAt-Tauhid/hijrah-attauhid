import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

const state = vi.hoisted(() => ({ role: "keuangan" as string, granted: new Set<string>(), path: "/akademik/siswa" }));
vi.mock("@/server/pembatalanPembayaran", () => ({ countPengajuanPembatalanMenunggu: vi.fn().mockResolvedValue({ count: 0 }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: state.role, can: (key: string) => state.role === "admin" || state.granted.has(key) }),
}));
vi.mock("@/lib/router-compat", () => ({ useLocation: () => ({ pathname: state.path }) }));
vi.mock("@/components/NavLink", () => ({ NavLink: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a> }));
vi.mock("@/components/shared/BrandLogo", () => ({ BrandLogo: () => null }));
vi.mock("@/components/ui/sidebar", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Pass, SidebarContent: Pass, SidebarGroup: Pass, SidebarGroupContent: Pass, SidebarMenu: Pass,
    SidebarMenuButton: Pass, SidebarMenuItem: Pass, SidebarMenuSub: Pass, SidebarMenuSubItem: Pass,
    SidebarMenuSubButton: Pass, SidebarHeader: Pass, useSidebar: () => ({ state: "expanded" }),
  };
});

import { AppSidebar } from "./AppSidebar";

function as(role: string, granted: readonly string[] = []) {
  state.role = role;
  state.granted = new Set(granted);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppSidebar />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => { state.path = "/akademik/siswa"; });

describe("AppSidebar: keuangan melihat Daftar Siswa saja di Akademik", () => {
  it("menampilkan Akademik > Daftar Siswa", () => {
    as("keuangan", DEFAULT_ROLE_PERMISSIONS.keuangan);
    expect(screen.getByText("Akademik")).toBeInTheDocument();
    expect(screen.getByText("Daftar Siswa")).toBeInTheDocument();
  });
  it("menyembunyikan semua menu Akademik lain", () => {
    as("keuangan", DEFAULT_ROLE_PERMISSIONS.keuangan);
    // Item di grup yang tertutup tidak dirender, jadi judul grup juga diperiksa.
    for (const title of [
      "Seragam Siswa", "Data Alumni", "SPMB", "Statistik SPMB", "Konfigurasi SPMB", "Mutasi Siswa", "Statistik Siswa",
      "Kegiatan Belajar", "Penilaian & Rapor", "Referensi",
    ]) {
      expect(screen.queryByText(title), title).not.toBeInTheDocument();
    }
  });
  it.each(["admin", "admin_tu", "kepala_sekolah", "guru"])("%s tetap melihat menu Akademik lengkap", role => {
    as(role);
    for (const title of ["Data Siswa", "Daftar Siswa", "Seragam Siswa", "Mutasi Siswa", "Kegiatan Belajar", "Penilaian & Rapor", "Referensi"]) {
      expect(screen.getByText(title), title).toBeInTheDocument();
    }
  });
  it("peran Keuangan lain (kasir, bendahara) tidak mendapat menu Akademik", () => {
    as("kasir", DEFAULT_ROLE_PERMISSIONS.kasir);
    expect(screen.queryByText("Akademik")).not.toBeInTheDocument();
  });
});

describe("AppSidebar: admin TU melihat Biaya Seragam SPMB", () => {
  beforeEach(() => { state.path = "/keuangan/seragam-vendor"; });
  it("menampilkan Biaya Seragam SPMB dan Monitoring, tanpa menu transaksi", () => {
    as("admin_tu");
    expect(screen.getByText("Biaya Seragam SPMB")).toBeInTheDocument();
    expect(screen.getByText("Monitoring Pembayaran SPMB")).toBeInTheDocument();
    expect(screen.queryByText("Input Pembayaran")).not.toBeInTheDocument();
    expect(screen.queryByText("Rencana Tagihan Siswa Baru")).not.toBeInTheDocument();
    expect(screen.queryByText("Pengeluaran")).not.toBeInTheDocument();
  });
});
