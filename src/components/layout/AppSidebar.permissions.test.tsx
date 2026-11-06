import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

const state = vi.hoisted(() => ({ role: "kasir" as string, granted: new Set<string>(), count: vi.fn(), path: "/keuangan" }));
vi.mock("@/server/pembatalanPembayaran", () => ({ countPengajuanPembatalanMenunggu: state.count }));
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

function as(role: string, granted: readonly string[]) {
  state.role = role;
  state.granted = new Set(granted);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppSidebar />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => { state.path = "/keuangan"; state.count.mockReset(); state.count.mockResolvedValue({ count: 0 }); });

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

  it("menu Persetujuan Pembatalan: penyetuju melihat lencana jumlah, pengaju melihat menu tanpa lencana", async () => {
    state.path = "/keuangan/persetujuan-pembatalan";
    state.count.mockResolvedValue({ count: 3 });
    as("bendahara", DEFAULT_ROLE_PERMISSIONS.bendahara);
    expect(screen.getByText("Persetujuan Pembatalan")).toBeInTheDocument();
    // Item menu dan judul grup memakai lencana yang sama (judul disembunyikan lewat CSS saat grup terbuka).
    expect((await screen.findAllByLabelText("3 pengajuan menunggu"))[0]).toHaveTextContent("3");
    cleanup();

    state.count.mockClear();
    as("kasir", DEFAULT_ROLE_PERMISSIONS.kasir);
    expect(screen.getByText("Persetujuan Pembatalan")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText(/pengajuan menunggu/)).not.toBeInTheDocument());
    expect(state.count).not.toHaveBeenCalled();
  });

  it("tanpa izin ajukan maupun setujui, menu Persetujuan Pembatalan tidak tampil", () => {
    state.path = "/keuangan/pembayaran";
    as("kasir", ["keuangan.pembayaran"]);
    expect(screen.getByText("Input Pembayaran")).toBeInTheDocument();
    expect(screen.queryByText("Persetujuan Pembatalan")).not.toBeInTheDocument();
  });

  it("lencana 0 tidak ditampilkan", async () => {
    state.path = "/keuangan/persetujuan-pembatalan";
    state.count.mockResolvedValue({ count: 0 });
    as("bendahara", DEFAULT_ROLE_PERMISSIONS.bendahara);
    await waitFor(() => expect(state.count).toHaveBeenCalled());
    expect(screen.queryByLabelText(/pengajuan menunggu/)).not.toBeInTheDocument();
  });

  it("lencana juga tampil di judul grup saat grup tertutup, supaya penyetuju melihatnya tanpa membuka menu", async () => {
    state.path = "/keuangan";
    state.count.mockResolvedValue({ count: 2 });
    as("sekretaris_yayasan", DEFAULT_ROLE_PERMISSIONS.sekretaris_yayasan);
    expect(screen.queryByText("Persetujuan Pembatalan")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("2 pengajuan menunggu")).toBeInTheDocument();
  });
});
