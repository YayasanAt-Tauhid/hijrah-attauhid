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
  useLocation: () => ({ pathname: mockPathname }),
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

  it("fails closed while an authenticated user's role is unresolved", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "1" },
      role: null,
      isLoading: false,
    });
    renderWithRouter(["admin"]);
    expect(screen.getByText("Memuat...")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
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
