import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalTagihan from "./PortalTagihan";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rows: [
    { tagihan_id: "monthly", siswa_id: "student-a", nama_siswa: "Anak Pertama", jenis_id: "spp", jenis_nama: "SPP SMP", bulan: 7, nominal: 450000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: true, jatuh_tempo: "2026-07-10", departemen_id: "smp", departemen_nama: "SMP", kelas_nama: "9C", nis: "123" },
    { tagihan_id: "one-time", siswa_id: "student-a", nama_siswa: "Anak Pertama", jenis_id: "pangkal", jenis_nama: "UANG PANGKAL SMP", bulan: 0, nominal: 1500000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: true, jatuh_tempo: "2026-07-10", departemen_id: "smp", departemen_nama: "SMP", kelas_nama: "9C", nis: "123" },
    { tagihan_id: "other", siswa_id: "student-b", nama_siswa: "Anak Kedua", jenis_id: "spp", jenis_nama: "SPP SD", bulan: 8, nominal: 200000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: false, jatuh_tempo: "2026-08-10", departemen_id: "sd", departemen_nama: "SD", kelas_nama: "5C", nis: "456" },
  ],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/useKeuangan", () => ({ BULAN_ORDER_AKADEMIK: [7,8,9,10,11,12,1,2,3,4,5,6] }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "portal-anak-ids" ? { data: ["student-a", "student-b"] } : { data: mocks.rows, isLoading: false },
}));

afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

describe("PortalTagihan selection and installment checkout", () => {
  it("keeps the cart action visible but disabled before a bill is selected", () => {
    render(<PortalTagihan />);
    const buttons = screen.getAllByRole("button", { name: /Masukkan ke Keranjang/ });
    expect(buttons).toHaveLength(1);
    buttons.forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ }));
    screen.getAllByRole("button", { name: /Masukkan ke Keranjang/ }).forEach((button) =>
      expect(button).not.toBeDisabled(),
    );
  });

  it("keeps formatted installment amounts and selected items intact in the cart", () => {
    render(<PortalTagihan />);
    expect(screen.queryByLabelText("Bayar cicilan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    const input = screen.getByLabelText("Bayar cicilan");
    expect(input).toHaveValue("1.500.000");
    fireEvent.change(input, { target: { value: "500.000" } });
    expect(input).toHaveValue("500.000");
    expect(screen.getByText(/2 tagihan dari 1 anak dipilih/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /Masukkan ke Keranjang/ });
    fireEvent.click(buttons[buttons.length - 1]);
    const cart = JSON.parse(sessionStorage.getItem("keranjang_tagihan")!);
    expect(cart.map((item: { tagihan_id: string; jumlah: number }) => [item.tagihan_id, item.jumlah])).toEqual([["monthly", 450000], ["one-time", 500000]]);
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/checkout");
  });

  it("selects each child's bills independently and preserves an installment when reselected", () => {
    render(<PortalTagihan />);
    fireEvent.click(screen.getByRole("button", { name: /Pilih semua tagihan Anak Pertama/ }));
    expect(screen.getByText(/2 tagihan dari 1 anak dipilih/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Buka tagihan Anak Kedua/ }));
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Bayar cicilan"), { target: { value: "250.000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    expect(screen.queryByLabelText("Bayar cicilan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    expect(screen.getByLabelText("Bayar cicilan")).toHaveValue("250.000");
  });

  it("selects and clears only the chosen child's bills and updates its button label", () => {
    render(<PortalTagihan />);
    expect(screen.getByText("0 dari 2 tagihan dipilih")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ }));
    expect(screen.getByText("1 dari 2 tagihan dipilih")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pilih semua tagihan Anak Pertama/ }));
    expect(screen.getByText("2 dari 2 tagihan dipilih")).toBeInTheDocument();
    const clearFirst = screen.getByRole("button", { name: /Batalkan pilihan Anak Pertama/ });
    expect(clearFirst).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Buka tagihan Anak Kedua/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pilih semua tagihan Anak Kedua/ }));
    fireEvent.click(clearFirst);
    expect(screen.getByText("0 dari 2 tagihan dipilih")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Pilih semua tagihan Anak Pertama/ })).toHaveAttribute("aria-pressed", "false");
    const checkout = screen.getAllByRole("button", { name: /Masukkan ke Keranjang/ });
    fireEvent.click(checkout[checkout.length - 1]);
    const cart = JSON.parse(sessionStorage.getItem("keranjang_tagihan")!);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ tagihan_id: "other", jumlah: 200000 });
  });

  it("selects SPP for the academic year without including one-time bills", () => {
    render(<PortalTagihan />);
    const yearButtons = screen.getAllByRole("button", { name: /2 Semester · Jul–Jun/ });
    fireEvent.click(yearButtons[0]);

    expect(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ })).not.toBeChecked();
    expect(screen.getByText(/1 tagihan dari 1 anak dipilih/)).toBeInTheDocument();
  });

  it("keeps one academic-year SPP group across different financial books", () => {
    mocks.rows.push({
      tagihan_id: "monthly-jan",
      siswa_id: "student-a",
      nama_siswa: "Anak Pertama",
      jenis_id: "spp",
      jenis_nama: "SPP SMP",
      bulan: 1,
      nominal: 450000,
      tahun_ajaran_id: "book-next",
      tahun_ajaran_nama: "2026/2027",
      tahun_ajaran_mulai: "2026-07-01",
      status: "terjadwal",
      menunggak: false,
      jatuh_tempo: "2027-01-10",
      departemen_id: "smp",
      departemen_nama: "SMP",
      kelas_nama: "9C",
      nis: "123",
    });

    try {
      render(<PortalTagihan />);
      const yearButtons = screen.getAllByRole("button", { name: /2 Semester · Jul–Jun/ });
      fireEvent.click(yearButtons[0]);

      expect(screen.getByRole("checkbox", { name: /SPP SMP Juli 2026/ })).toBeChecked();
      const sppGroups = screen.getAllByRole("button", { name: /SPP SMP 1 tagihan/ });
      fireEvent.click(sppGroups[sppGroups.length - 1]);
      expect(screen.getByRole("checkbox", { name: /SPP SMP Januari 2027/ })).toBeChecked();
      expect(screen.getByText(/2 tagihan dari 1 anak dipilih/)).toBeInTheDocument();
    } finally {
      mocks.rows.pop();
    }
  });

  it("does not proceed to checkout with a zero installment", () => {
    render(<PortalTagihan />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    fireEvent.change(screen.getByLabelText("Bayar cicilan"), { target: { value: "" } });
    const buttons = screen.getAllByRole("button", { name: /Masukkan ke Keranjang/ });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(sessionStorage.getItem("keranjang_tagihan")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
