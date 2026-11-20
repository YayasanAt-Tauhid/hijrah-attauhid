import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UangPangkalInfo } from "@/lib/seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const mocks = vi.hoisted(() => ({ allowed: true, pangkalLoading: false, pangkalError: null as unknown }));

const pangkal = (paid: number): UangPangkalInfo => ({ total: 4000000, paid, remaining: 4000000 - paid, status: paid ? "sebagian" : "belum_bayar" });
const kosong = [{ jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }];
const siswa = (id: string, nama: string, stel: { jenis: string; ukuran: string }) => ({
  id, nama, nis: "", jenis_kelamin: "L", status: "diterima", departemen_id: TK, kelas_siswa: [],
  siswa_detail: {
    ukuran_seragam: [stel, ...kosong], spmb_departemen_tujuan_id: TK, tahun_ajaran_id: TA, spmb_gelombang_id: "g1",
  },
});

vi.mock("@/hooks/useAkademikData", () => ({
  useTahunAjaran: () => ({ data: [{ id: TA, nama: "2027/2028" }, { id: "ta-2026", nama: "2026/2027" }] }),
  useDepartemen: () => ({ data: [{ id: TK, nama: "Taman Kanak-kanak", kode: "TK" }] }),
}));
vi.mock("@/hooks/useSiswaSeragam", () => ({
  useSpmbGelombang: () => ({ data: [{ id: "g1", nama: "Gelombang 1" }] }),
  useSiswaSeragamList: () => ({
    isLoading: false,
    data: [
      siswa("a", "Ahmad", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("b", "Budi", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("c", "Candra", { jenis: "Set Gamis Hijau", ukuran: "S" }),
    ],
  }),
  useSeragamUangPangkal: () => ({
    allowed: mocks.allowed, isLoading: mocks.pangkalLoading, error: mocks.pangkalError,
    byStudent: new Map([["a", pangkal(1000000)], ["b", pangkal(400000)], ["c", pangkal(2000000)]]),
  }),
}));
vi.mock("@/hooks/useHargaSeragamVendor", () => ({
  useHargaSeragamVendor: () => ({
    isLoading: false, error: null,
    data: [{ id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah", ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true }],
  }),
}));
vi.mock("./BiayaSeragamHargaTab", () => ({ default: () => <div>Isi tab harga</div> }));
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: (p: { data: unknown[]; extraSheets?: Array<{ name: string }> }) => (
    <div data-testid="ekspor" data-jumlah={p.data.length} data-sheet={p.extraSheets?.map((s) => s.name).join(",")} />
  ),
}));

import BiayaSeragamSPMB from "./BiayaSeragamSPMB";

const ringkasan = () => screen.getByRole("region", { name: "Ringkasan pesanan" });
beforeEach(() => { mocks.allowed = true; mocks.pangkalLoading = false; mocks.pangkalError = null; });
afterEach(cleanup);

describe("Biaya Seragam SPMB", () => {
  it("ringkasan: layak dipesan, belum memenuhi 25%, dan perlu dilengkapi", () => {
    render(<BiayaSeragamSPMB />);
    expect(within(ringkasan()).getByText("Layak dipesan: 2")).toBeInTheDocument();
    expect(within(ringkasan()).getByText("Belum memenuhi 25%: 1")).toBeInTheDocument();
    expect(within(ringkasan()).getByText("Perlu dilengkapi: 1")).toBeInTheDocument();
  });

  it("daftar pesanan memuat siswa layak dengan total, dan menandai harga yang belum ada; siswa <25% tidak tampil", () => {
    render(<BiayaSeragamSPMB />);
    expect(screen.getByText("Ahmad")).toBeInTheDocument();
    expect(screen.getByText("Candra")).toBeInTheDocument();
    expect(screen.queryByText("Budi")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rp 170.000").length).toBeGreaterThan(0);
    expect(screen.getByText("Harga belum ada: Set Gamis Hijau (S)")).toBeInTheDocument();
  });

  it("rekap vendor menampilkan total pembayaran dan stel tanpa harga terpisah", async () => {
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Total pembayaran vendor: Rp 170.000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Harga belum ada" })).toBeInTheDocument();
    expect(screen.getByText("Set Gamis Hijau")).toBeInTheDocument();
  });

  it("ekspor Excel membawa daftar pesanan dan sheet Rekap Vendor", () => {
    render(<BiayaSeragamSPMB />);
    const ekspor = screen.getByTestId("ekspor");
    expect(ekspor).toHaveAttribute("data-jumlah", "2");
    expect(ekspor).toHaveAttribute("data-sheet", "Rekap Vendor");
  });

  it("tab Harga memuat komponen harga", async () => {
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Harga" }));
    expect(await screen.findByText("Isi tab harga")).toBeInTheDocument();
  });

  it("data uang pangkal masih memuat: tidak ada hitungan 0 palsu dan tidak ada ekspor", () => {
    mocks.pangkalLoading = true;
    render(<BiayaSeragamSPMB />);
    expect(screen.queryByText(/Layak dipesan:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ringkasan pesanan" })).not.toBeInTheDocument();
    expect(screen.getByText("Ringkasan belum tersedia.")).toBeInTheDocument();
    expect(screen.queryByTestId("ekspor")).not.toBeInTheDocument();
  });

  it("data uang pangkal gagal dimuat: tidak ada hitungan, tidak ada daftar, peringatan tetap tampil", async () => {
    mocks.pangkalError = new Error("gagal");
    render(<BiayaSeragamSPMB />);
    expect(screen.getByRole("alert")).toHaveTextContent("Data uang pangkal belum dapat dimuat");
    expect(screen.queryByText(/Layak dipesan:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ahmad")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ekspor")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Ringkasan belum tersedia.")).toBeInTheDocument();
    expect(screen.queryByText(/Total pembayaran vendor:/)).not.toBeInTheDocument();
  });

  it("rekap vendor saat data uang pangkal memuat: tidak ada total pembayaran", async () => {
    mocks.pangkalLoading = true;
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Ringkasan belum tersedia.")).toBeInTheDocument();
    expect(screen.queryByText(/Total pembayaran vendor:/)).not.toBeInTheDocument();
  });

  it("tanpa izin data uang pangkal: pesan peringatan dan tidak ada daftar", () => {
    mocks.allowed = false;
    render(<BiayaSeragamSPMB />);
    expect(screen.getByRole("alert")).toHaveTextContent("Anda tidak memiliki izin melihat data uang pangkal SPMB.");
    expect(screen.queryByText("Ahmad")).not.toBeInTheDocument();
  });
});
