import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedPortalRoute from "./ProtectedPortalRoute";
const useAuth = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Outlet: () => <div data-testid="outlet">Portal</div>,
}));
beforeEach(() => vi.clearAllMocks());
describe("parent portal route", () => {
  it("does not redirect while the role is loading", () => {
    useAuth.mockReturnValue({ user: { id: "parent" }, role: null, isLoading: true });
    render(<ProtectedPortalRoute />);
    expect(screen.getByText("Memuat...")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
  it("shows retry on failure without exposing the portal", () => {
    const retryAuth = vi.fn();
    useAuth.mockReturnValue({ user: { id: "parent" }, role: null, isLoading: false, authError: "Koneksi gagal", retryAuth });
    render(<ProtectedPortalRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(retryAuth).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
  it("offers recovery when a profile has no role", () => {
    useAuth.mockReturnValue({ user: { id: "parent" }, role: null, isLoading: false });
    render(<ProtectedPortalRoute />);
    expect(screen.getByRole("alert")).toHaveTextContent("Akses akun belum tersedia");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });
  it("redirects a signed-out user", () => {
    useAuth.mockReturnValue({ user: null, role: null, isLoading: false });
    render(<ProtectedPortalRoute />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/portal/login");
  });
  it("does not grant a staff account access", () => {
    useAuth.mockReturnValue({ user: { id: "staff" }, role: "admin", isLoading: false });
    render(<ProtectedPortalRoute />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/portal/login");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });
  it("renders the portal for a verified parent", () => {
    useAuth.mockReturnValue({ user: { id: "parent" }, role: "ortu", isLoading: false });
    render(<ProtectedPortalRoute />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });
});
