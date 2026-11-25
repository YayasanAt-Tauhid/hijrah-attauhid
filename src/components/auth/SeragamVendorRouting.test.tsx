import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { defaultAllows } from "@/test/defaultPermissions";

const state = vi.hoisted(() => ({ role: "admin_tu", departemenId: "tk" as string | null, user: { id: "tu-test" } as { id: string } | null }));
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-router")>(),
  Navigate: ({ to }: { to: string }) => <p>Redirect: {to}</p>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  ...state, isLoading: false, authError: null, retryAuth: vi.fn(),
  permissionsLoading: false, can: (key: string) => defaultAllows(state.role, key as never),
}) }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/layout/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/layout/TopNavbar", () => ({ TopNavbar: () => null }));
vi.mock("@/pages/AccessGateway", () => ({ default: () => <p>Access gateway</p> }));

import { Route as ProtectedFileRoute } from "@/routes/_protected";
import { Route as AppFileRoute } from "@/routes/_protected._app";
import { Route as FinanceFileRoute } from "@/routes/_protected._app.keuangan";

// Rute induk Keuangan dan AppLayout memakai komponen produksi; halaman anaknya
// diganti stub agar yang diuji hanya penjagaan aksesnya.
function mount(url: string, withAppLayout = true) {
  const root = createRootRoute();
  const protectedRoute = createRoute({ getParentRoute: () => root, id: "_protected", component: ProtectedFileRoute.options.component });
  const app = createRoute({ getParentRoute: () => protectedRoute, id: "_app", component: withAppLayout ? AppFileRoute.options.component : undefined });
  const finance = createRoute({ getParentRoute: () => app, path: "keuangan", component: FinanceFileRoute.options.component });
  const seragam = createRoute({ getParentRoute: () => finance, path: "seragam-vendor", component: () => <p>Halaman seragam vendor</p> });
  const cashier = createRoute({ getParentRoute: () => finance, path: "pembayaran", component: () => <p>Cashier page</p> });
  const academic = createRoute({ getParentRoute: () => app, path: "akademik", component: () => <p>Academic page</p> });
  const denied = createRoute({ getParentRoute: () => root, path: "unauthorized", component: () => <p>Akses Ditolak</p> });
  const login = createRoute({ getParentRoute: () => root, path: "login", component: () => <p>Login page</p> });
  const tree = root.addChildren([protectedRoute.addChildren([app.addChildren([finance.addChildren([seragam, cashier]), academic])]), denied, login]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [url] }) });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => { state.role = "admin_tu"; state.departemenId = "tk"; state.user = { id: "tu-test" }; vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });

describe("Biaya Seragam SPMB lewat rute induk produksi", () => {
  it.each(["/keuangan/seragam-vendor", "/keuangan/seragam-vendor/"])("admin TU boleh membuka %s", async url => {
    mount(url);
    expect(await screen.findByText("Halaman seragam vendor")).toBeInTheDocument();
    expect(screen.queryByText("Redirect: /unauthorized")).not.toBeInTheDocument();
  });
  it("guard induk Keuangan sendiri (tanpa AppLayout) tidak menolak admin TU", async () => {
    mount("/keuangan/seragam-vendor", false);
    expect(await screen.findByText("Halaman seragam vendor")).toBeInTheDocument();
  });
  it.each(["admin", "keuangan"])("tetap terbuka untuk %s", async role => {
    state.role = role; mount("/keuangan/seragam-vendor");
    expect(await screen.findByText("Halaman seragam vendor")).toBeInTheDocument();
  });
  it("admin TU tanpa departemen utama tetap ditolak", async () => {
    state.departemenId = null; mount("/keuangan/seragam-vendor");
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
  });
  it("halaman Keuangan lain tetap tertutup bagi admin TU", async () => {
    mount("/keuangan/pembayaran", false);
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
    expect(screen.queryByText("Cashier page")).not.toBeInTheDocument();
  });
  it("guru tetap ditolak", async () => {
    state.role = "guru"; mount("/keuangan/seragam-vendor");
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
  });
});
