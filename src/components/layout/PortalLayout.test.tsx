import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalLayout from "./PortalLayout";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/portal",
  unread: 2,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "parent", email: "ayah@example.com" }, signOut: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/router-compat", () => ({
  Outlet: () => <div>isi halaman</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "notif-unread-count" ? mocks.unread : [],
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/shared/BrandLogo", () => ({ BrandLogo: () => <span /> }));

beforeEach(() => {
  mocks.pathname = "/portal";
  mocks.unread = 2;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const menuPonsel = () => screen.getByRole("navigation", { name: "Menu utama (ponsel)" });

describe("Portal orang tua — header dan menu", () => {
  it("menu memakai Biaya sebagai pengganti Tagihan", () => {
    render(<PortalLayout />);
    const nav = within(menuPonsel());
    for (const label of ["Beranda", "Biaya", "Riwayat", "Presensi", "Nilai", "Profil"]) {
      expect(nav.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(nav.queryByRole("button", { name: "Tagihan" })).not.toBeInTheDocument();
  });

  it("menu Biaya tetap membuka halaman /portal/tagihan", () => {
    render(<PortalLayout />);
    fireEvent.click(within(menuPonsel()).getByRole("button", { name: "Biaya" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/tagihan");
  });

  it("menandai halaman aktif dengan aria-current pada kedua menu", () => {
    mocks.pathname = "/portal/presensi";
    render(<PortalLayout />);
    const desktop = within(screen.getByRole("navigation", { name: "Menu utama" }));
    for (const nav of [within(menuPonsel()), desktop]) {
      expect(nav.getByRole("button", { name: "Presensi" })).toHaveAttribute("aria-current", "page");
      expect(nav.getByRole("button", { name: "Beranda" })).not.toHaveAttribute("aria-current");
    }
  });

  it("Beranda hanya aktif pada alamat /portal persis", () => {
    mocks.pathname = "/portal/tagihan";
    render(<PortalLayout />);
    const nav = within(menuPonsel());
    expect(nav.getByRole("button", { name: "Beranda" })).not.toHaveAttribute("aria-current");
    expect(nav.getByRole("button", { name: "Biaya" })).toHaveAttribute("aria-current", "page");
  });

  it("lonceng menyebut jumlah notifikasi belum dibaca untuk pembaca layar", () => {
    render(<PortalLayout />);
    expect(screen.getByRole("button", { name: "Notifikasi, 2 belum dibaca" })).toBeInTheDocument();
    cleanup();
    mocks.unread = 0;
    render(<PortalLayout />);
    expect(screen.getByRole("button", { name: "Notifikasi" })).toBeInTheDocument();
  });

  it("menyediakan menu akun dan tetap merender isi halaman", () => {
    render(<PortalLayout />);
    expect(screen.getByRole("button", { name: "Menu akun" })).toBeInTheDocument();
    expect(screen.getByText("isi halaman")).toBeInTheDocument();
  });
});
