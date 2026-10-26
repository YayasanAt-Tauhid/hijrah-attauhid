import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "admin_tu", departemenId: "tk" as string | null, pathname: "/keuangan/monitoring-spmb" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: state.pathname }),
  Navigate: ({ to }: { to: string }) => <p>Redirect: {to}</p>,
  Outlet: () => <p>Protected content</p>,
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("./TopNavbar", () => ({ TopNavbar: () => null }));
import { AppLayout } from "./AppLayout";

beforeEach(() => { state.role = "admin_tu"; state.departemenId = "tk"; state.pathname = "/keuangan/monitoring-spmb"; });
describe("Admin TU navigation", () => {
  it.each(["/keuangan/monitoring-spmb", "/keuangan/monitoring-spmb/", "/akademik/spmb", "/pengajuan-penghapusan", "/pengajuan-penghapusan/"])("allows %s", pathname => {
    state.pathname = pathname; render(<AppLayout />);
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
  it.each(["/keuangan/pembayaran", "/keuangan/piutang", "/keuangan/monitoring-spmb/other", "/keuangan/monitoring-spmb-fake"])("keeps %s outside Admin TU navigation", pathname => {
    state.pathname = pathname; render(<AppLayout />);
    expect(screen.getByText("Redirect: /akademik")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });
  it("keeps the primary department requirement", () => {
    state.departemenId = null; render(<AppLayout />);
    expect(screen.getByText("Redirect: /unauthorized")).toBeInTheDocument();
  });
  it("keeps other staff navigation unchanged", () => {
    state.role = "keuangan"; state.pathname = "/keuangan/pembayaran"; render(<AppLayout />);
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});
