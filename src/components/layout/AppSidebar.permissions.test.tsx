import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

const state = vi.hoisted(() => ({ role: "kasir" as string, granted: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: state.role, can: (key: string) => state.role === "admin" || state.granted.has(key) }),
}));
vi.mock("@/lib/router-compat", () => ({ useLocation: () => ({ pathname: "/keuangan" }) }));
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

function as(role: string, granted: readonly string[]) {
  state.role = role;
  state.granted = new Set(granted);
  render(<AppSidebar />);
}
afterEach(cleanup);

describe("AppSidebar: menu Keuangan menurut izin", () => {
  it("kasir bawaan hanya melihat transaksi harian dan laporan/rekap", () => {
    as("kasir", DEFAULT_ROLE_PERMISSIONS.kasir);
    expect(screen.getByText("Keuangan")).toBeInTheDocument();
    expect(screen.getByText("Transaksi Harian")).toBeInTheDocument();
    expect(screen.getByText("Laporan & Rekap")).toBeInTheDocument();
    expect(screen.queryByText("Akuntansi")).not.toBeInTheDocument();
    expect(screen.queryByText("Laporan ISAK 35")).not.toBeInTheDocument();
    expect(screen.queryByText("Keringanan & Beasiswa")).not.toBeInTheDocument();
  });

  it("bendahara bawaan melihat seluruh grup Keuangan tetapi bukan Akademik/Pengaturan/Kepegawaian", () => {
    as("bendahara", DEFAULT_ROLE_PERMISSIONS.bendahara);
    for (const title of ["Keringanan & Beasiswa", "Transaksi Harian", "Laporan & Rekap", "Akuntansi", "Laporan ISAK 35", "Pengaturan"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Akademik")).not.toBeInTheDocument();
    expect(screen.queryByText("Kepegawaian")).not.toBeInTheDocument();
    // "Pengaturan" hanya sebagai grup di dalam Keuangan, bukan menu sistem.
    expect(screen.getAllByText("Pengaturan")).toHaveLength(1);
  });

  it("mengikuti izin yang diubah admin: tanpa laporan, grup Laporan & Rekap hanya berisi rekap kasir", () => {
    as("sekretaris_yayasan", ["keuangan.akuntansi"]);
    expect(screen.getByText("Akuntansi")).toBeInTheDocument();
    expect(screen.queryByText("Transaksi Harian")).not.toBeInTheDocument();
    expect(screen.queryByText("Laporan & Rekap")).not.toBeInTheDocument();
  });

  it("admin tetap melihat semua menu", () => {
    as("admin", []);
    expect(screen.getByText("Akademik")).toBeInTheDocument();
    expect(screen.getByText("Akuntansi")).toBeInTheDocument();
    expect(screen.getAllByText("Pengaturan")).toHaveLength(2);
  });
});
