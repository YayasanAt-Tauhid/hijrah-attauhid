import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  role: "admin_tu", departemenId: "tk" as string | null,
  user: { id: "tu-test" } as { id: string } | null, load: vi.fn(), save: vi.fn(),
}));
// Keep the real nested route matching and Outlet chain. Record redirects
// instead of exercising Navigate's layout-effect scheduling in jsdom.
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-router")>(),
  Navigate: ({ to }: { to: string }) => <p>Redirect: {to}</p>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  ...state, isLoading: false, authError: null, retryAuth: vi.fn(),
}) }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/layout/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/layout/TopNavbar", () => ({ TopNavbar: () => null }));
vi.mock("@/server/spmbPaymentMonitor", () => ({ getSpmbPaymentMonitor: state.load, saveSpmbMonitorEvent: state.save }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (value: number) => String(value) }));
vi.mock("@/pages/AccessGateway", () => ({ default: () => <p>Access gateway</p> }));

import { Route as ProtectedFileRoute } from "@/routes/_protected";
import { Route as AppFileRoute } from "@/routes/_protected._app";
import { Route as FinanceFileRoute } from "@/routes/_protected._app.keuangan";
import { Route as MonitorFileRoute } from "@/routes/_protected._app.keuangan.monitoring-spmb";

// Use the production route components with a real nested router. Testing only
// the page misses an ancestor ProtectedRoute that rejects the current role.
function mount(url = "/keuangan/monitoring-spmb", withAppLayout = true) {
  const root = createRootRoute();
  const protectedRoute = createRoute({ getParentRoute: () => root, id: "_protected", component: ProtectedFileRoute.options.component });
  const app = createRoute({ getParentRoute: () => protectedRoute, id: "_app", component: withAppLayout ? AppFileRoute.options.component : undefined });
  const finance = createRoute({ getParentRoute: () => app, path: "keuangan", component: FinanceFileRoute.options.component });
  const monitor = createRoute({ getParentRoute: () => finance, path: "monitoring-spmb", component: MonitorFileRoute.options.component });
  const cashier = createRoute({ getParentRoute: () => finance, path: "pembayaran", component: () => <p>Cashier page</p> });
  const academic = createRoute({ getParentRoute: () => app, path: "akademik", component: () => <p>Academic page</p> });
  const denied = createRoute({ getParentRoute: () => root, path: "unauthorized", component: () => <p>Akses Ditolak</p> });
  const login = createRoute({ getParentRoute: () => root, path: "login", component: () => <p>Login page</p> });
  const portal = createRoute({ getParentRoute: () => root, path: "portal", component: () => <p>Parent portal</p> });
  const tree = root.addChildren([protectedRoute.addChildren([app.addChildren([finance.addChildren([monitor, cashier]), academic])]), denied, login, portal]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [url] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}
beforeEach(() => {
  state.role = "admin_tu"; state.departemenId = "tk"; state.user = { id: "tu-test" };
  vi.clearAllMocks(); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); state.load.mockResolvedValue({ items: [], historyAvailable: true });
});
describe("SPMB monitoring access through production ancestor routes", () => {
  it.each(["/keuangan/monitoring-spmb", "/keuangan/monitoring-spmb?siswa=example", "/keuangan/monitoring-spmb/"])("lets Admin TU reach %s", async url => {
    mount(url);
    expect(await screen.findByRole("heading", { name: "Monitoring Pembayaran SPMB" })).toBeInTheDocument();
    expect(await screen.findByText(/0 dari 0 calon siswa/)).toBeInTheDocument();
    expect(state.load).toHaveBeenCalled();
    expect(screen.queryByText("Redirect: /unauthorized")).not.toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["admin", "keuangan", "kasir"])("preserves monitoring access for %s", async role => {
    state.role = role; mount();
    expect(await screen.findByRole("heading", { name: "Monitoring Pembayaran SPMB" })).toBeInTheDocument();
  });
  it("still rejects an Admin TU without a primary department", async () => {
    state.departemenId = null; mount();
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
    expect(state.load).not.toHaveBeenCalled();
  });
  it("keeps other finance pages closed to Admin TU even without the AppLayout restriction", async () => {
    mount("/keuangan/pembayaran", false);
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
    expect(screen.queryByText("Cashier page")).not.toBeInTheDocument();
  });
  it("keeps the AppLayout redirect for Admin TU on other finance pages", async () => {
    mount("/keuangan/pembayaran");
    expect(await screen.findByText("Redirect: /akademik")).toBeInTheDocument();
    expect(screen.queryByText("Cashier page")).not.toBeInTheDocument();
  });
  it("keeps the finance parent restriction for teachers", async () => {
    state.role = "guru"; mount();
    expect(await screen.findByText("Redirect: /unauthorized")).toBeInTheDocument();
    expect(state.load).not.toHaveBeenCalled();
  });
  it("requires a signed-in session", async () => {
    state.user = null; mount();
    expect(await screen.findByText("Redirect: /login")).toBeInTheDocument();
    expect(state.load).not.toHaveBeenCalled();
  });
});
