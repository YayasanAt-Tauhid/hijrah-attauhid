import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OAuthCallback from "./OAuthCallback";

type MockUser = { id: string; created_at?: string } | null;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn(),
  retryAuth: vi.fn(),
  state: { user: null, role: null, isLoading: false, authError: null } as {
    user: MockUser; role: string | null; isLoading: boolean; authError: string | null;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ ...mocks.state, signOut: mocks.signOut, retryAuth: mocks.retryAuth }),
}));
vi.mock("@/lib/router-compat", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const menitLalu = (menit: number) => new Date(Date.now() - menit * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { user: null, role: null, isLoading: false, authError: null };
  mocks.signOut.mockResolvedValue(undefined);
});

describe("callback login Google untuk staff", () => {
  it("meloloskan staff yang akunnya baru dibuat admin (belum 10 menit)", async () => {
    mocks.state = {
      user: { id: "staff", created_at: menitLalu(1) }, role: "admin", isLoading: false, authError: null,
    };
    render(<OAuthCallback />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("meloloskan staff lama", async () => {
    mocks.state = {
      user: { id: "staff", created_at: menitLalu(60 * 24 * 30) }, role: "guru", isLoading: false, authError: null,
    };
    render(<OAuthCallback />);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("menolak akun Google tanpa role (belum didaftarkan admin)", async () => {
    mocks.state = {
      user: { id: "asing", created_at: menitLalu(0) }, role: null, isLoading: false, authError: null,
    };
    render(<OAuthCallback />);
    expect(await screen.findByText(/belum terdaftar sebagai staff/i)).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("menolak akun orang tua dan mengarahkan ke Portal Orang Tua", async () => {
    mocks.state = {
      user: { id: "ortu", created_at: menitLalu(60 * 24) }, role: "ortu", isLoading: false, authError: null,
    };
    render(<OAuthCallback />);
    expect(await screen.findByText(/akun orang tua/i)).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("menampilkan kegagalan jika tidak ada sesi Google", async () => {
    render(<OAuthCallback />);
    expect(await screen.findByText(/Gagal masuk dengan Google/i)).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
