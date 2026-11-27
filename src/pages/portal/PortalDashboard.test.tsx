import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalDashboard from "./PortalDashboard";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  email: "ayah@example.com",
  data: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "parent", email: mocks.email } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: mocks.data[queryKey[0]] }),
}));

const anak = (id: string, nama: string, nis: string, kelas: string, dept: string, ayah?: string) => ({
  siswa_id: id,
  hubungan: "ortu",
  siswa: {
    id,
    nama,
    nis,
    siswa_detail: ayah ? [{ nama_ayah: ayah, nama_ibu: null }] : [],
    kelas_siswa: [{ aktif: true, kelas: { nama: kelas, departemen: { nama: dept } } }],
  },
});

beforeEach(() => {
  mocks.email = "ayah@example.com";
  mocks.data = {
    "portal-anak": [
      anak("a", "Ahmad Fauzi", "20240117", "4A", "SD Hijrah At-Tauhid", "Ahmad Sulaiman"),
      anak("b", "Siti Aisyah Nurul Khoirunnisa", "20250033", "Kelas B", "TK Hijrah At-Tauhid"),
    ],
    "portal-tagihan-count": 2,
    "portal-notif-dashboard": [
      { id: "n1", judul: "Pembayaran berhasil", pesan: "SPP September 2026 sudah diterima.", dibaca: false, url: "/portal/pembayaran", created_at: "2026-11-26T07:20:00Z" },
      { id: "n2", judul: "Seragam diterima", pesan: "Uang Seragam sudah diterima.", dibaca: true, url: null, created_at: "2026-11-18T03:05:00Z" },
    ],
  };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Beranda portal orang tua", () => {
  it("menyapa dengan nama orang tua dan nama portal", () => {
    render(<PortalDashboard />);
    expect(screen.getByText("Assalamu'alaikum,")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ahmad Sulaiman" })).toBeInTheDocument();
    expect(screen.getByText("Portal Orang Tua Hijrah At-Tauhid")).toBeInTheDocument();
  });

  it("memakai awalan email bila nama orang tua tidak tersedia", () => {
    mocks.data["portal-anak"] = [anak("a", "Ahmad Fauzi", "1", "4A", "SD")];
    render(<PortalDashboard />);
    expect(screen.getByRole("heading", { level: 1, name: "ayah" })).toBeInTheDocument();
  });

  it("kartu Biaya Pendidikan menyebut jumlah biaya jatuh tempo dan membuka halaman biaya", () => {
    render(<PortalDashboard />);
    expect(screen.getByText("Biaya Pendidikan")).toBeInTheDocument();
    expect(screen.getByText("2 biaya sudah jatuh tempo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lihat dan bayar" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/tagihan");
  });

  it("tanpa biaya jatuh tempo, kartu menyatakannya dengan tenang", () => {
    mocks.data["portal-tagihan-count"] = 0;
    render(<PortalDashboard />);
    expect(screen.getByText("Tidak ada biaya yang jatuh tempo")).toBeInTheDocument();
    expect(screen.queryByText(/sudah jatuh tempo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lihat biaya" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/tagihan");
  });

  it("tidak lagi memakai istilah Tunggakan atau Tagihan Belum Bayar", () => {
    render(<PortalDashboard />);
    expect(screen.queryByText("Tunggakan")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tagihan Belum Bayar/)).not.toBeInTheDocument();
  });

  it("daftar anak memuat kelas di samping nama, lembaga, dan NIS", () => {
    render(<PortalDashboard />);
    expect(screen.getByText("2 anak")).toBeInTheDocument();
    expect(screen.getByText("Ahmad Fauzi")).toBeInTheDocument();
    expect(screen.getByText("Kelas 4A")).toBeInTheDocument();
    expect(screen.getByText("SD Hijrah At-Tauhid · NIS 20240117")).toBeInTheDocument();
    // "Kelas B" sudah memuat kata Kelas pada data: jangan digandakan
    expect(screen.getByText("Kelas B")).toBeInTheDocument();
    expect(screen.queryByText(/Kelas Kelas/)).not.toBeInTheDocument();
    expect(screen.getByText("TK Hijrah At-Tauhid · NIS 20250033")).toBeInTheDocument();
  });

  it("menampilkan pesan bila belum ada anak yang terhubung", () => {
    mocks.data["portal-anak"] = [];
    render(<PortalDashboard />);
    expect(screen.getByText("Belum ada data anak yang terhubung. Hubungi admin sekolah.")).toBeInTheDocument();
  });

  it("pintasan membuka Riwayat, Presensi, dan Nilai", () => {
    render(<PortalDashboard />);
    const pintasan = screen.getByRole("region", { name: "Pintasan" });
    fireEvent.click(within(pintasan).getByRole("button", { name: /Riwayat/ }));
    fireEvent.click(within(pintasan).getByRole("button", { name: /Presensi/ }));
    fireEvent.click(within(pintasan).getByRole("button", { name: /Nilai/ }));
    expect(mocks.navigate.mock.calls.map((c) => c[0])).toEqual([
      "/portal/pembayaran",
      "/portal/presensi",
      "/portal/nilai",
    ]);
  });

  it("kabar terbaru menandai yang belum dibaca dengan teks, bukan hanya warna, dan membuka tautannya", () => {
    render(<PortalDashboard />);
    const kabar = screen.getByRole("region", { name: "Kabar terbaru" });
    expect(within(kabar).getAllByText("Belum dibaca")).toHaveLength(1);
    expect(within(kabar).getAllByText("Nov 2026", { exact: false })).toHaveLength(2);
    fireEvent.click(within(kabar).getByRole("button", { name: /Pembayaran berhasil/ }));
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/pembayaran");
  });

  it("menyembunyikan bagian kabar terbaru bila tidak ada notifikasi", () => {
    mocks.data["portal-notif-dashboard"] = [];
    render(<PortalDashboard />);
    expect(screen.queryByRole("region", { name: "Kabar terbaru" })).not.toBeInTheDocument();
  });
});
