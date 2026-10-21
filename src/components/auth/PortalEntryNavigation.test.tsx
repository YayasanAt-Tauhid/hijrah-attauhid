import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, role: null, isLoading: false, authError: null }),
}));

function createTestRouter(initialEntry = "/") {
  const root = createRootRoute({ component: Outlet });
  const guard = createRoute({
    getParentRoute: () => root,
    id: "_protected",
    component: () => <ProtectedRoute allowedRoles={["admin"]} />,
  });
  const home = createRoute({ getParentRoute: () => guard, path: "/", component: () => <div>Dashboard</div> });
  const staffPage = createRoute({ getParentRoute: () => guard, path: "/keuangan", component: () => <div>Finance</div> });
  let finishPortalLoad: () => void = () => {};
  const loading = new Promise<void>(resolve => { finishPortalLoad = resolve; });
  const portalLogin = createRoute({
    getParentRoute: () => root,
    path: "/portal/login",
    loader: () => loading,
    component: () => <h1>Login Portal Orang Tua</h1>,
  });
  const staffLogin = createRoute({
    getParentRoute: () => root,
    path: "/login",
    component: () => <h1>Login Pegawai</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([guard.addChildren([home, staffPage]), portalLogin, staffLogin]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultPreload: false,
  });
  return { router, finishPortalLoad };
}

beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });

describe("public portal entry navigation", () => {
  it("keeps the portal destination when leaving the home gateway while the login page loads", async () => {
    const { router, finishPortalLoad } = createTestRouter();
    render(<RouterProvider router={router} />);
    const link = await screen.findByRole("link", { name: "Masuk Portal Orang Tua" });
    expect(link).toHaveAttribute("href", "/portal/login");
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe("/portal/login"));
    // The gateway is still presented while the destination loader is pending.
    await act(async () => { finishPortalLoad(); });
    expect(await screen.findByRole("heading", { name: "Login Portal Orang Tua" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/portal/login");
    expect(screen.queryByRole("heading", { name: "Login Pegawai" })).not.toBeInTheDocument();
  });

  it("still sends a signed-out visitor on a protected school page to staff login", async () => {
    const { router } = createTestRouter("/keuangan");
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Login Pegawai" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.queryByText("Finance")).not.toBeInTheDocument();
  });
});
