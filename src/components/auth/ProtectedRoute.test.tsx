import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProtectedRoute } from "./ProtectedRoute";

const mockUseAuth = vi.fn();
let mockPathname = "/keuangan";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/pages/AccessGateway", () => ({
  default: () => <div data-testid="access-gateway">Access Gateway</div>,
}));

// Stub TanStack Router so we can assert exactly which path/branch was rendered.
vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Outlet: () => <div data-testid="outlet">Outlet</div>,
  useMatches: ({ select }: { select: (matches: { pathname: string }[]) => unknown }) => select([{ pathname: mockPathname }]),
}));

function renderWithRouter(allowedRoles?: any[]) {
  return render(<ProtectedRoute allowedRoles={allowedRoles} />);
}

describe("ProtectedRoute", () => {
  it("shows loading spinner when isLoading is true", () => {
    mockUseAuth.mockReturnValue({ user: null, role: null, isLoading: true });
    renderWithRouter();
    expect(screen.getByText("Memuat...")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("shows access gateway at / when user is not authenticated", () => {
    mockPathname = "/";
    mockUseAuth.mockReturnValue({ user: null, role: null, isLoading: false });
    renderWithRouter();
    expect(screen.getByTestId("access-gateway")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("redirects to /login on protected non-root routes when user is not authenticated", () => {
    mockPathname = "/keuangan";
    mockUseAuth.mockReturnValue({ user: null, role: null, isLoading: false });
    renderWithRouter();
    expect(screen.getByTestId("navigate")).toHaveTextContent("/login");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("offers recovery when role lookup has finished without access", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: null,
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Akses akun belum tersedia");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("keeps entry choices available for an unclassified account at home", () => {
    mockPathname = "/";
    mockUseAuth.mockReturnValue({ user: { id: "unclassified" }, role: null, isLoading: false, authError: null });
    renderWithRouter(["admin"]);
    expect(screen.getByTestId("access-gateway")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("does not treat a failed profile lookup as an unclassified account", () => {
    mockPathname = "/";
    mockUseAuth.mockReturnValue({ user: { id: "parent" }, role: null, isLoading: false, authError: "Koneksi gagal" });
    renderWithRouter(["admin"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Koneksi gagal");
    expect(screen.queryByTestId("access-gateway")).not.toBeInTheDocument();
  });

  it("redirects to /unauthorized when user role is not allowed", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: "guru",
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/unauthorized");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("redirects parent users from / to /portal", () => {
    mockPathname = "/";
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: "ortu",
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/portal");
  });

  it("redirects parent users to /portal when staff route is not allowed", () => {
    mockPathname = "/keuangan";
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: "ortu",
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/portal");
  });

  it("renders Outlet when user is authenticated and role is allowed", () => {
    mockPathname = "/";
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: "admin",
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
});
