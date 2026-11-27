import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortalTagihan from "./PortalTagihan";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rows: [
    { tagihan_id: "monthly", siswa_id: "student-a", nama_siswa: "Anak Pertama", jenis_id: "spp", jenis_nama: "SPP SMP", bulan: 7, nominal: 450000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: true, jatuh_tempo: "2026-07-10", departemen_id: "smp", departemen_nama: "SMP", kelas_nama: "9C", nis: "123" },
    { tagihan_id: "one-time", siswa_id: "student-a", nama_siswa: "Anak Pertama", jenis_id: "pangkal", jenis_nama: "UANG PANGKAL SMP", bulan: 0, nominal: 1500000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: true, jatuh_tempo: "2026-07-10", departemen_id: "smp", departemen_nama: "SMP", kelas_nama: "9C", nis: "123" },
    { tagihan_id: "other", siswa_id: "student-b", nama_siswa: "Anak Kedua", jenis_id: "spp", jenis_nama: "SPP SD", bulan: 11, nominal: 200000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "belum_bayar", menunggak: false, jatuh_tempo: "2026-11-10", departemen_id: "sd", departemen_nama: "SD", kelas_nama: "5C", nis: "456" },
    { tagihan_id: "other-next", siswa_id: "student-b", nama_siswa: "Anak Kedua", jenis_id: "spp", jenis_nama: "SPP SD", bulan: 1, nominal: 200000, tahun_ajaran_id: "year", tahun_ajaran_nama: "2026/2027", tahun_ajaran_mulai: "2026-07-01", status: "terjadwal", menunggak: false, jatuh_tempo: "2027-01-10", departemen_id: "sd", departemen_nama: "SD", kelas_nama: "5C", nis: "456" },
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

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  // Penggolongan "bulan ini" / "selanjutnya" bergantung pada tanggal hari ini.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T03:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LIHAT_SELANJUTNYA = /Lihat biaya pendidikan sampai akhir tahun ajaran/;
const lihatSelanjutnya = (index = 0) =>
  fireEvent.click(screen.getAllByRole("button", { name: LIHAT_SELANJUTNYA })[index]);
const pilihSemua = (nama: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`Pilih semua biaya ${nama}`) });
const tombolLanjut = () => screen.getByRole("button", { name: /Lanjut ke Pembayaran/ });

describe("PortalTagihan layout and copy", () => {
  it("uses the Biaya Pendidikan wording and drops totals, due dates and the late badge", () => {
    render(<PortalTagihan />);
    expect(screen.getByRole("heading", { level: 1, name: "Biaya Pendidikan" })).toBeInTheDocument();
    expect(screen.queryByText(/Total tersedia/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Perlu dibayar sekarang/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Terlambat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jatuh tempo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pembayaran SPP Cepat|Bayar SPP sekaligus/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Tunggakan|Bulan Ini|Mendatang/ })).not.toBeInTheDocument();
  });

  it("puts the class beside the student name and does not repeat the word Kelas", () => {
    mocks.rows[0].kelas_nama = "Kelas 9C";
    try {
      render(<PortalTagihan />);
      expect(screen.getByText("Kelas 9C")).toBeInTheDocument();
      expect(screen.queryByText("Kelas Kelas 9C")).not.toBeInTheDocument();
      expect(screen.getByText("Kelas 5C")).toBeInTheDocument();
      expect(screen.queryByText(/NIS/)).not.toBeInTheDocument();
    } finally {
      mocks.rows[0].kelas_nama = "9C";
    }
  });

  it("shows arrears and bills due this month first and keeps later bills behind a per-child button", () => {
    render(<PortalTagihan />);
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD November 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /SPP SD Januari 2027/ })).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: LIHAT_SELANJUTNYA })).toHaveLength(1);
    lihatSelanjutnya();
    expect(screen.getByRole("checkbox", { name: /SPP SD Januari 2027/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LIHAT_SELANJUTNYA })).toBeInTheDocument();
  });

  it("keeps a child with only later bills visible with a short note", () => {
    const original = mocks.rows.slice(0, 2).map((row) => ({ ...row }));
    mocks.rows.slice(0, 2).forEach((row) =>
      Object.assign(row, { menunggak: false, status: "terjadwal", jatuh_tempo: "2027-01-10" }),
    );

    try {
      render(<PortalTagihan />);
      expect(screen.getByText("Anak Pertama")).toBeInTheDocument();
      expect(screen.getByText("Belum ada biaya yang jatuh tempo.")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /Pilih SPP SMP/ })).not.toBeInTheDocument();
      lihatSelanjutnya();
      expect(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ })).toBeInTheDocument();
    } finally {
      mocks.rows.slice(0, 2).forEach((row, i) => Object.assign(row, original[i]));
    }
  });

  it("says plainly when there is nothing to pay", () => {
    const original = mocks.rows.splice(0);
    try {
      render(<PortalTagihan />);
      expect(screen.getByText(/Tidak ada biaya pendidikan yang belum dibayar/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Lanjut ke Pembayaran/ })).not.toBeInTheDocument();
    } finally {
      mocks.rows.push(...original);
    }
  });
});

describe("PortalTagihan selection and installment checkout", () => {
  it("keeps the checkout action visible but disabled before a bill is selected", () => {
    render(<PortalTagihan />);
    expect(screen.getByText("Belum ada biaya dipilih")).toBeInTheDocument();
    expect(tombolLanjut()).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ }));
    expect(tombolLanjut()).not.toBeDisabled();
  });

  it("allows installments for a future scheduled Uang Pangkal bill", () => {
    const original = { ...mocks.rows[1] };
    Object.assign(mocks.rows[1], {
      status: "terjadwal",
      menunggak: false,
      jatuh_tempo: "2027-07-01",
      tahun_ajaran_nama: "2027/2028",
      tahun_ajaran_mulai: "2027-07-01",
    });

    try {
      render(<PortalTagihan />);
      lihatSelanjutnya(0);
      fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
      expect(screen.getByLabelText("Bayar cicilan")).toHaveValue("1.500.000");
      fireEvent.change(screen.getByLabelText("Bayar cicilan"), { target: { value: "500.000" } });
      expect(screen.getByLabelText("Bayar cicilan")).toHaveValue("500.000");
    } finally {
      Object.assign(mocks.rows[1], original);
    }
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
    expect(screen.getByText("Dipilih: 2 biaya · 1 anak")).toBeInTheDocument();
    fireEvent.click(tombolLanjut());
    const cart = JSON.parse(sessionStorage.getItem("keranjang_tagihan")!);
    expect(cart.map((item: { tagihan_id: string; jumlah: number }) => [item.tagihan_id, item.jumlah])).toEqual([["monthly", 450000], ["one-time", 500000]]);
    expect(mocks.navigate).toHaveBeenCalledWith("/portal/checkout");
  });

  it("selects each child's bills independently with the select-all checkbox", () => {
    render(<PortalTagihan />);
    expect(pilihSemua("Anak Pertama")).not.toBeChecked();

    fireEvent.click(pilihSemua("Anak Pertama"));
    expect(pilihSemua("Anak Pertama")).toBeChecked();
    expect(pilihSemua("Anak Kedua")).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD November 2026/ })).not.toBeChecked();
    expect(screen.getByText("Dipilih: 2 biaya · 1 anak")).toBeInTheDocument();

    fireEvent.click(pilihSemua("Anak Kedua"));
    expect(screen.getByText("Dipilih: 3 biaya · 2 anak")).toBeInTheDocument();

    fireEvent.click(pilihSemua("Anak Pertama"));
    expect(pilihSemua("Anak Pertama")).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD November 2026/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SMP/ })).not.toBeChecked();
    expect(screen.getByText("Dipilih: 1 biaya · 1 anak")).toBeInTheDocument();

    fireEvent.click(tombolLanjut());
    const cart = JSON.parse(sessionStorage.getItem("keranjang_tagihan")!);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ tagihan_id: "other", jumlah: 200000 });
  });

  it("only selects the bills that are shown and picks up later bills once they are opened", () => {
    render(<PortalTagihan />);
    fireEvent.click(pilihSemua("Anak Kedua"));
    expect(screen.getByRole("checkbox", { name: /Pilih SPP SD November 2026/ })).toBeChecked();
    expect(screen.getByText("Dipilih: 1 biaya · 1 anak")).toBeInTheDocument();

    lihatSelanjutnya();
    expect(pilihSemua("Anak Kedua")).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /SPP SD Januari 2027/ })).not.toBeChecked();

    fireEvent.click(pilihSemua("Anak Kedua"));
    expect(pilihSemua("Anak Kedua")).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /SPP SD Januari 2027/ })).toBeChecked();
    expect(screen.getByText("Dipilih: 2 biaya · 1 anak")).toBeInTheDocument();
  });

  it("preserves an installment amount when the bill is selected again", () => {
    render(<PortalTagihan />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    fireEvent.change(screen.getByLabelText("Bayar cicilan"), { target: { value: "250.000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    expect(screen.queryByLabelText("Bayar cicilan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    expect(screen.getByLabelText("Bayar cicilan")).toHaveValue("250.000");
  });

  it("locks a month until the earlier month is selected and releases later months together", () => {
    render(<PortalTagihan />);
    lihatSelanjutnya();
    const november = screen.getByRole("checkbox", { name: /SPP SD November 2026/ });
    const january = screen.getByRole("checkbox", { name: /SPP SD Januari 2027/ });
    expect(january).toBeDisabled();

    fireEvent.click(november);
    expect(january).not.toBeDisabled();
    fireEvent.click(january);
    expect(january).toBeChecked();

    fireEvent.click(november);
    expect(november).not.toBeChecked();
    expect(january).not.toBeChecked();
    expect(january).toBeDisabled();
  });

  it("treats SPP bills from different financial books as one sequence", () => {
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
      lihatSelanjutnya(0);
      const january = screen.getByRole("checkbox", { name: /SPP SMP Januari 2027/ });
      expect(january).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: /SPP SMP Juli 2026/ }));
      expect(january).not.toBeDisabled();
      fireEvent.click(january);
      expect(screen.getByText("Dipilih: 2 biaya · 1 anak")).toBeInTheDocument();
    } finally {
      mocks.rows.pop();
    }
  });

  it("does not proceed to checkout with a zero installment", () => {
    render(<PortalTagihan />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Pilih UANG PANGKAL SMP/ }));
    fireEvent.change(screen.getByLabelText("Bayar cicilan"), { target: { value: "" } });
    fireEvent.click(tombolLanjut());
    expect(sessionStorage.getItem("keranjang_tagihan")).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
