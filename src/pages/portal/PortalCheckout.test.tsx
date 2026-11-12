import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalCheckout from "./PortalCheckout";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadMidtrans: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent", email: "ortu@example.com" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
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

const SARAN_VA = /Virtual Account \(VA\)/;

const klikBayar = () =>
  fireEvent.click(screen.getByRole("button", { name: /Lanjutkan Pembayaran/ }));

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  // Tanpa sesi login, handleBayar berhenti lebih awal; cukup untuk membuktikan ia dipanggil.
  mocks.getSession.mockResolvedValue({ data: { session: null } });
});

describe("PortalCheckout pop up saran VA untuk total di atas Rp628.000", () => {
  it("tidak menampilkan saran VA sebagai kartu di halaman", () => {
    renderWithCart([item(1500000)]);
    expect(screen.queryByText(SARAN_VA)).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("langsung memproses pembayaran tanpa pop up untuk total di bawah batas", async () => {
    renderWithCart([item(450000)]);
    klikBayar();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
  });

  it("langsung memproses pembayaran tanpa pop up tepat di Rp628.000", async () => {
    renderWithCart([item(628000)]);
    klikBayar();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
  });

  it("menampilkan pop up begitu total melebihi Rp628.000, tanpa memulai pembayaran", () => {
    renderWithCart([item(628001)]);
    klikBayar();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Saran metode pembayaran");
    expect(dialog).toHaveTextContent(SARAN_VA);
    expect(dialog.textContent).toMatch(/QRIS/);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("menjumlahkan semua item keranjang sebelum membandingkan dengan batas", () => {
    renderWithCart([item(450000, 7), item(200000, 8)]);
    klikBayar();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("tombol Kembali menutup pop up tanpa memulai pembayaran", async () => {
    renderWithCart([item(1500000)]);
    klikBayar();
    fireEvent.click(screen.getByRole("button", { name: "Kembali" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("tombol Lanjut ke Midtrans meneruskan ke pembayaran (QRIS tetap bisa dipilih)", async () => {
    renderWithCart([item(1500000)]);
    klikBayar();
    fireEvent.click(screen.getByRole("button", { name: "Lanjut ke Midtrans" }));
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
  });
});
