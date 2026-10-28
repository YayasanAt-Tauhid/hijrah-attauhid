import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalCheckout from "./PortalCheckout";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadMidtrans: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent", email: "ortu@example.com" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/server/payment", () => ({ createPayment: vi.fn() }));
vi.mock("@/hooks/useMidtrans", () => ({
  useMidtrans: () => ({
    isReady: true,
    isLoading: false,
    error: null,
    loadMidtrans: mocks.loadMidtrans,
  }),
}));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));

const item = (jumlah: number, bulan = 7) => ({
  siswa_id: "student-a",
  nama_siswa: "Anak Pertama",
  jenis_id: "spp",
  jenis_nama: "SPP SMP",
  bulan,
  jumlah,
  tahun_ajaran_nama: "2026/2027",
});

const renderWithCart = (items: ReturnType<typeof item>[]) => {
  sessionStorage.setItem("keranjang_tagihan", JSON.stringify(items));
  return render(<PortalCheckout />);
};

const IMBAUAN_VA = /Virtual Account \(VA\)/;

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("PortalCheckout imbauan VA untuk total di atas Rp628.000", () => {
  it("tidak menampilkan imbauan VA untuk total di bawah batas", () => {
    renderWithCart([item(450000)]);
    expect(screen.queryByText(IMBAUAN_VA)).not.toBeInTheDocument();
  });

  it("tidak menampilkan imbauan VA tepat di Rp628.000", () => {
    renderWithCart([item(628000)]);
    expect(screen.queryByText(IMBAUAN_VA)).not.toBeInTheDocument();
  });

  it("menampilkan imbauan VA begitu total melebihi Rp628.000", () => {
    renderWithCart([item(628001)]);
    const imbauan = screen.getByText(IMBAUAN_VA);
    expect(imbauan).toBeInTheDocument();
    expect(imbauan.textContent).toMatch(/QRIS/);
  });

  it("menjumlahkan semua item keranjang sebelum membandingkan dengan batas", () => {
    renderWithCart([item(450000, 7), item(200000, 8)]);
    expect(screen.getByText(IMBAUAN_VA)).toBeInTheDocument();
  });

  it("tetap menampilkan tombol Lanjutkan Pembayaran aktif saat imbauan tampil", () => {
    renderWithCart([item(1500000)]);
    expect(screen.getByText(IMBAUAN_VA)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lanjutkan Pembayaran/ })).not.toBeDisabled();
  });
});
