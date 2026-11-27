import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalProfil from "./PortalProfil";

const mocks = vi.hoisted(() => ({
  anak: [] as unknown[],
  profile: null as unknown,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "parent", email: "ahmad.sulaiman@email.com" }, signOut: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/server/portalOrtu", () => ({ portalOrtuTambahAnak: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "portal-profile" ? mocks.profile : mocks.anak,
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const anak = (nama: string, nis: string, kelas: string, dept: string, hubungan: string, ayah?: string) => ({
  hubungan,
  siswa: {
    nama,
    nis,
    siswa_detail: ayah ? [{ nama_ayah: ayah, nama_ibu: null }] : [],
    kelas_siswa: [{ aktif: true, kelas: { nama: kelas, departemen: { nama: dept } } }],
  },
});

beforeEach(() => {
  mocks.profile = { email: "ahmad.sulaiman@email.com", role: "orang_tua" };
  mocks.anak = [
    anak("Ahmad Fauzi", "20240117", "4A", "SD Hijrah At-Tauhid", "ayah", "Ahmad Sulaiman"),
    anak("Siti Aisyah Nurul Khoirunnisa", "20250033", "Kelas B", "TK Hijrah At-Tauhid", "ayah"),
  ];
});
afterEach(cleanup);

describe("Profil orang tua", () => {
  it("pita atas memuat nama, email, dan penanda halaman", () => {
    render(<PortalProfil />);
    expect(screen.getByText("Profil Saya")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ahmad Sulaiman" })).toBeInTheDocument();
    expect(screen.getAllByText("ahmad.sulaiman@email.com").length).toBeGreaterThan(0);
  });

  it("Informasi akun tidak lagi menampilkan istilah internal Role", () => {
    render(<PortalProfil />);
    const akun = screen.getByRole("region", { name: "Informasi akun" });
    expect(within(akun).getByText("Nama")).toBeInTheDocument();
    expect(within(akun).getByText("Email")).toBeInTheDocument();
    expect(within(akun).queryByText("Role")).not.toBeInTheDocument();
    expect(within(akun).queryByText("orang_tua")).not.toBeInTheDocument();
  });

  it("anak yang terhubung tampil dengan kelas di samping nama dan hubungan", () => {
    render(<PortalProfil />);
    const daftar = screen.getByRole("region", { name: "Anak yang terhubung" });
    expect(within(daftar).getByText("Ahmad Fauzi")).toBeInTheDocument();
    expect(within(daftar).getByText("Kelas 4A")).toBeInTheDocument();
    expect(within(daftar).getByText("Kelas B")).toBeInTheDocument();
    expect(within(daftar).getByText("SD Hijrah At-Tauhid · NIS 20240117")).toBeInTheDocument();
    expect(within(daftar).getAllByText("Ayah")).toHaveLength(2);
  });

  it("formulir Hubungkan anak lain tertutup sampai tombol Tambah ditekan", () => {
    render(<PortalProfil />);
    expect(screen.queryByLabelText("Nama Lengkap Anak")).not.toBeInTheDocument();
    const tambah = screen.getByRole("button", { name: "Tambah" });
    expect(tambah).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(tambah);
    expect(screen.getByRole("button", { name: "Tutup" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Untuk verifikasi, isi data anak sesuai data yang tercatat di sekolah.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hubungkan Anak" })).toBeInTheDocument();
  });

  it("bagian Hubungkan anak lain berada paling atas, sebelum Informasi akun dan Anak yang terhubung", () => {
    render(<PortalProfil />);
    const urutan = screen
      .getAllByRole("region")
      .map((bagian) => within(bagian).getByRole("heading", { level: 2 }).textContent);
    expect(urutan).toEqual(["Hubungkan anak lain", "Informasi akun", "Anak yang terhubung"]);
  });

  it("tab Keamanan memuat formulir ganti password", () => {
    render(<PortalProfil />);
    const tabKeamanan = screen.getByRole("tab", { name: "Keamanan" });
    fireEvent.mouseDown(tabKeamanan);
    fireEvent.click(tabKeamanan);
    expect(screen.getByRole("tab", { name: "Profil" })).toBeInTheDocument();
    expect(screen.getByText("Ganti Password", { selector: "h2" })).toBeInTheDocument();
  });
});
