import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AnakPtk from "./AnakPtk";

const mocks = vi.hoisted(() => ({ role: "admin", fetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role, user: { id: "fixture-user" } }) }));
vi.mock("@/server/anakPtk", () => ({ getAnakPtkData: mocks.fetch }));
vi.mock("@/components/shared/SearchableSelect", () => ({
  SearchableSelect: ({ options, onValueChange, value, placeholder }: { options: { value: string; label: string }[]; onValueChange: (value: string) => void; value: string; placeholder: string }) =>
    <select aria-label={placeholder} value={value || ""} onChange={event => onValueChange(event.target.value)}><option value="">Pilih</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock("@/components/shared/ExportButton", () => ({ ExportButton: () => <button>Export daftar</button> }));

const fixture = () => ({
  selection: { tahunAjaranId: "ta", tahunBukuId: "tb", jenisId: "jenis" },
  options: {
    tahunAjaran: [{ id: "ta", nama: "2026/2027", aktif: true }],
    tahunBuku: [{ id: "tb", nama: "2027", aktif: false }],
    jenis: [{ id: "jenis", nama: "UANG DAFTAR ULANG TK", departemen_id: "tk" }],
    departemen: [{ id: "tk", nama: "TK", kode: "TK" }, { id: "sd", nama: "SD", kode: "SD" }],
  },
  coverage: { siswaAktif: 3, siswaTanpaNikOrangtuaValid: 1, pegawaiAktif: 2, pegawaiAktifTanpaNik: 0 },
  dibacaPada: "2026-10-01T13:00:00Z",
  items: [
    { siswaId: "s1", nama: "Fixture TK", nis: "fixture-tk", departemenId: "tk", kelas: "TK A1", orangTua: [{ pegawaiId: "p", nama: "Fixture Ayah", hubungan: "ayah", status: "aktif" }], tarifStatus: "belum_diisi", nominalTarif: null, tarifUmumTersedia: true, peringatan: [] },
    { siswaId: "s2", nama: "Fixture SD", nis: "fixture-sd", departemenId: "sd", kelas: "1A", orangTua: [{ pegawaiId: "p", nama: "Fixture Ayah", hubungan: "ayah", status: "aktif" }], tarifStatus: "sudah_diisi", nominalTarif: 100, tarifUmumTersedia: false, peringatan: [] },
  ],
});
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AnakPtk /></QueryClientProvider>);
}

describe("halaman kandidat anak PTK", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = "admin"; mocks.fetch.mockResolvedValue(fixture()); });
  it("guru tidak memanggil laporan", () => {
    mocks.role = "guru"; mount();
    expect(screen.getByRole("alert")).toHaveTextContent("hanya tersedia untuk admin");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("mengikuti lembaga jenis tagihan dan bisa menampilkan semua lembaga", async () => {
    mount();
    await screen.findByText("Fixture TK");
    expect(screen.queryByText("Fixture SD")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pilih lembaga"), { target: { value: "all" } });
    expect(screen.getByText("Fixture SD")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pilih kesiapan tarif"), { target: { value: "belum_diisi" } });
    expect(screen.queryByText("Fixture SD")).not.toBeInTheDocument();
    expect(screen.getByText(/Tarif umum tersedia; tarif per siswa/)).toBeInTheDocument();
  });
  it("kesalahan baca tidak ditampilkan sebagai tidak ada anak PTK", async () => {
    mocks.fetch.mockRejectedValue(new Error("fixture gagal"));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Fixture TK")).not.toBeInTheDocument();
    expect(screen.getByText("Laporan belum tersedia.")).toBeInTheDocument();
  });
  it("mengirim TA dan Tahun Buku sebagai pilihan terpisah", async () => {
    mount(); await screen.findByText("Fixture TK");
    fireEvent.change(screen.getByLabelText("Pilih Tahun Buku"), { target: { value: "tb" } });
    expect(mocks.fetch).toHaveBeenLastCalledWith({ data: { tahunAjaranId: "ta", tahunBukuId: "tb", jenisId: "jenis" } });
  });
});
