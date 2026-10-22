import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalLogin from "./PortalLogin";
import PortalOAuthCallback from "./PortalOAuthCallback";
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), signIn: vi.fn(), google: vi.fn(), signOut: vi.fn(), retryAuth: vi.fn(),
  signUp: vi.fn(), completeGoogle: vi.fn(),
  state: { user: null, role: null, isLoading: false, authError: null } as {
    user: { id: string } | null; role: string | null; isLoading: boolean; authError: string | null;
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    ...mocks.state, signIn: mocks.signIn, signInWithGoogle: mocks.google,
    signOut: mocks.signOut, retryAuth: mocks.retryAuth,
  }),
}));
vi.mock("@/server/portalOrtu", () => ({
  portalOrtuSignUp: mocks.signUp, portalOrtuCompleteGoogleSignup: mocks.completeGoogle,
}));
vi.mock("@/lib/router-compat", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { user: null, role: null, isLoading: false, authError: null };
  mocks.signOut.mockResolvedValue(undefined);
  mocks.google.mockResolvedValue({ error: null });
});
function submitLogin() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "parent@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Masuk", exact: true }));
}
describe("parent sign-in screens", () => {
  it("uses the verified sign-in role without a second network lookup", async () => {
    mocks.signIn.mockResolvedValue({ error: null, role: "ortu" });
    render(<PortalLogin />);
    submitLogin();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/portal", { replace: true }));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("resumes child verification when an unclassified account chooses parent login", async () => {
    mocks.state = { user: { id: "unclassified" }, role: null, isLoading: false, authError: null };
    render(<PortalLogin />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/portal/oauth-callback", { replace: true }));
    expect(mocks.completeGoogle).not.toHaveBeenCalled();
  });
  it.each([
    { isLoading: true, authError: null },
    { isLoading: false, authError: "Koneksi gagal" },
  ])("waits for successful role lookup before resuming verification: %j", state => {
    mocks.state = { user: { id: "parent" }, role: null, ...state };
    render(<PortalLogin />);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("lets an unclassified parent switch to another account", async () => {
    mocks.state = { user: { id: "unclassified" }, role: null, isLoading: false, authError: null };
    render(<PortalOAuthCallback />);
    fireEvent.click(await screen.findByRole("button", { name: "Keluar dan gunakan akun lain" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/portal/login", { replace: true }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.completeGoogle).not.toHaveBeenCalled();
  });
  it("keeps login usable after a failed role lookup", async () => {
    mocks.signIn.mockResolvedValue({ error: "Akun belum berhasil diperiksa." });
    render(<PortalLogin />);
    submitLogin();
    await waitFor(() => expect(screen.getByText("Akun belum berhasil diperiksa.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Masuk", exact: true })).not.toBeDisabled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("rejects a staff account on parent login", async () => {
    mocks.signIn.mockResolvedValue({ error: null, role: "admin_tu" });
    render(<PortalLogin />);
    submitLogin();
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("retains Google sign-in with the portal callback", async () => {
    render(<PortalLogin />);
    fireEvent.click(screen.getByRole("button", { name: "Masuk dengan Google" }));
    expect(mocks.google).toHaveBeenCalledWith(window.location.origin + "/portal/oauth-callback");
  });
  it("waits for the provider to finish restoring a Google session", () => {
    mocks.state = { user: { id: "google" }, role: null, isLoading: true, authError: null };
    render(<PortalOAuthCallback />);
    expect(screen.getByText("Memeriksa akun Anda...")).toBeInTheDocument();
    expect(screen.queryByLabelText("NIS Anak")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("opens the portal for an existing Google parent", async () => {
    mocks.state = { user: { id: "google" }, role: "ortu", isLoading: false, authError: null };
    render(<PortalOAuthCallback />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/portal", { replace: true }));
  });
  it("allows new Google accounts to complete child registration", async () => {
    mocks.state = { user: { id: "google" }, role: null, isLoading: false, authError: null };
    render(<PortalOAuthCallback />);
    expect(await screen.findByLabelText("NIS Anak")).toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("shows recovery rather than registration when Google profile lookup fails", () => {
    mocks.state = { user: { id: "google" }, role: null, isLoading: false, authError: "Koneksi gagal" };
    render(<PortalOAuthCallback />);
    expect(screen.getByRole("alert")).toHaveTextContent("Koneksi gagal");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(mocks.retryAuth).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("NIS Anak")).not.toBeInTheDocument();
  });
});

it("mengirim pilihan NISN untuk verifikasi anak akun Google", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.state = { user: { id: "google" }, role: null, isLoading: false, authError: null };
  mocks.completeGoogle.mockResolvedValue({ success: true, nama: "Anak Uji" });
  mocks.retryAuth.mockResolvedValue(undefined);
  render(<PortalOAuthCallback />);
  const choice = await screen.findByLabelText("Gunakan Identitas Anak");
  fireEvent.keyDown(choice, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "NISN", exact: true }));
  fireEvent.change(screen.getByLabelText("NISN Anak"), { target: { value: "0012345678" } });
  fireEvent.change(screen.getByLabelText("Nama Lengkap Anak"), { target: { value: "Anak Uji" } });
  fireEvent.change(screen.getByLabelText("Tanggal Lahir Anak"), { target: { value: "2014-07-15" } });
  fireEvent.click(screen.getByRole("button", { name: "Selesaikan Pendaftaran" }));
  await waitFor(() => expect(mocks.completeGoogle).toHaveBeenCalledWith({
    data: expect.objectContaining({ jenis_identitas: "nisn", nis: "0012345678", nama_siswa: "Anak Uji", tanggal_lahir_siswa: "2014-07-15" }),
  }));
});
