import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UangPangkalInfo } from "@/lib/seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const mocks = vi.hoisted(() => ({
  role: "keuangan" as string,
  allowed: true, pangkalLoading: false, pangkalError: null as unknown, lengkap: false, campur: false,
  unduh: vi.fn(), unduhPdf: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn(),
}));

const pangkal = (paid: number): UangPangkalInfo => ({ total: 4000000, paid, remaining: 4000000 - paid, status: paid ? "sebagian" : "belum_bayar" });
const kosong = [{ jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }, { jenis: "", ukuran: "" }];
const siswaLengkap = (id: string, nama: string) => ({
  id, nama, nis: "", jenis_kelamin: "L", status: "diterima", departemen_id: TK, kelas_siswa: [],
  siswa_detail: {
    ukuran_seragam: Array.from({ length: 5 }, () => ({ jenis: "Set Gamis Merah", ukuran: "S" })),
    spmb_departemen_tujuan_id: TK, tahun_ajaran_id: TA, spmb_gelombang_id: "g1",
  },
});
const siswa = (id: string, nama: string, stel: { jenis: string; ukuran: string }, jenisKelamin = "L") => ({
  id, nama, nis: "", jenis_kelamin: jenisKelamin, status: "diterima", departemen_id: TK, kelas_siswa: [],
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
    data: mocks.campur ? [
      siswa("a", "Ahmad", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("p", "Putri", { jenis: "Set Gamis Merah", ukuran: "S" }, "P"),
    ] : mocks.lengkap ? [siswaLengkap("a", "Ahmad")] : [
      siswa("a", "Ahmad", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("b", "Budi", { jenis: "Set Gamis Merah", ukuran: "S" }),
      siswa("c", "Candra", { jenis: "Set Gamis Hijau", ukuran: "S" }),
    ],
  }),
  useSeragamUangPangkal: () => ({
    allowed: mocks.allowed, isLoading: mocks.pangkalLoading, error: mocks.pangkalError,
    byStudent: new Map([["a", pangkal(1000000)], ["b", pangkal(400000)], ["c", pangkal(2000000)], ["p", pangkal(1000000)]]),
  }),
}));
vi.mock("@/hooks/useHargaSeragamVendor", () => ({
  useHargaSeragamVendor: () => ({
    isLoading: false, error: null,
    // Skenario campuran: satu baris "semua" membuat ikhwan dan akhwat berharga sama, supaya terlihat bila rekap menggabungkannya.
    data: [{ id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: mocks.campur ? "semua" : "L", nama_stel: "Set Gamis Merah", ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true }],
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("./BiayaSeragamHargaTab", () => ({
  default: (p: { bacaSaja?: boolean }) => <div data-baca-saja={String(Boolean(p.bacaSaja))}>Isi tab harga</div>,
}));
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: (p: { data: unknown[]; extraSheets?: Array<{ name: string }> }) => (
    <div data-testid="ekspor" data-jumlah={p.data.length} data-sheet={p.extraSheets?.map((s) => s.name).join(",")} />
  ),
}));

vi.mock("sonner", () => ({ toast: { warning: mocks.warning, success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/seragamVendorPdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seragamVendorPdf")>()),
  unduhBerkasPdf: mocks.unduhPdf,
}));
vi.mock("@/lib/seragamVendorEkspor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seragamVendorEkspor")>()),
  unduhBerkasXlsx: mocks.unduh,
}));

import BiayaSeragamSPMB from "./BiayaSeragamSPMB";

const ringkasan = () => screen.getByRole("region", { name: "Ringkasan pesanan" });
beforeEach(() => {
  mocks.role = "keuangan";
  mocks.allowed = true; mocks.pangkalLoading = false; mocks.pangkalError = null; mocks.lengkap = false; mocks.campur = false;
  mocks.unduh.mockClear(); mocks.warning.mockClear(); mocks.success.mockClear();
  mocks.unduhPdf.mockReset(); mocks.unduhPdf.mockResolvedValue(undefined); mocks.error.mockClear();
});
afterEach(cleanup);

describe("Biaya Seragam SPMB", () => {
  it("ringkasan: layak dipesan, belum memenuhi 25%, dan perlu dilengkapi", () => {
    render(<BiayaSeragamSPMB />);
    expect(within(ringkasan()).getByText("Layak dipesan: 2")).toBeInTheDocument();
    expect(within(ringkasan()).getByText("Belum memenuhi 25%: 1")).toBeInTheDocument();
    // Candra: harga belum ada. Ahmad: baru 1 dari 5 stel TK diisi.
    expect(within(ringkasan()).getByText("Perlu dilengkapi: 2")).toBeInTheDocument();
  });

  it("daftar pesanan memuat siswa layak dengan total, dan menandai harga yang belum ada; siswa <25% tidak tampil", () => {
    render(<BiayaSeragamSPMB />);
    expect(screen.getByText("Ahmad")).toBeInTheDocument();
    expect(screen.getByText("Candra")).toBeInTheDocument();
    expect(screen.queryByText("Budi")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rp 170.000").length).toBeGreaterThan(0);
    expect(screen.getByText(/Harga belum ada: Set Gamis Hijau \(S\)/)).toBeInTheDocument();
  });

  it("rekap vendor menampilkan total pembayaran dan stel tanpa harga terpisah", async () => {
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Total pembayaran vendor: Rp 170.000")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Harga belum ada" })).toBeInTheDocument();
    expect(screen.getByText("Set Gamis Hijau")).toBeInTheDocument();
  });

  it("daftar pesanan memuat kolom Jenis kelamin (Ikhwan/Akhwat)", () => {
    mocks.campur = true;
    render(<BiayaSeragamSPMB />);
    expect(screen.getByRole("columnheader", { name: /Jenis kelamin/ })).toBeInTheDocument();
    const barisAhmad = screen.getByText("Ahmad").closest("tr") as HTMLElement;
    const barisPutri = screen.getByText("Putri").closest("tr") as HTMLElement;
    expect(within(barisAhmad).getByText("Ikhwan")).toBeInTheDocument();
    expect(within(barisPutri).getByText("Akhwat")).toBeInTheDocument();
  });

  it("rekap vendor memisahkan ikhwan dan akhwat meski stel, ukuran, dan harganya sama", async () => {
    mocks.campur = true;
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rekap Vendor" }));
    expect(await screen.findByText("Total pembayaran vendor: Rp 340.000")).toBeInTheDocument();
    const baris = screen.getAllByRole("row").filter((r) => within(r).queryByText("Set Gamis Merah"));
    expect(baris).toHaveLength(2);
    expect(within(baris[0]).getByText("Ikhwan")).toBeInTheDocument();
    expect(within(baris[1]).getByText("Akhwat")).toBeInTheDocument();
    for (const b of baris) expect(within(b).getByText("1")).toBeInTheDocument();
  });

  it("ekspor Excel membawa daftar pesanan dan sheet Rekap Vendor", () => {
    render(<BiayaSeragamSPMB />);
    const ekspor = screen.getByTestId("ekspor");
    expect(ekspor).toHaveAttribute("data-jumlah", "2");
    expect(ekspor).toHaveAttribute("data-sheet", "Rekap Vendor");
  });

  it.each([["admin_tu", "true"], ["keuangan", "false"], ["admin", "false"]])("tab Harga untuk %s: bacaSaja=%s", async (role, bacaSaja) => {
    mocks.role = role;
    render(<BiayaSeragamSPMB />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Harga" }));
    expect(await screen.findByText("Isi tab harga")).toHaveAttribute("data-baca-saja", bacaSaja);
  });

  it("admin TU tetap bisa melihat daftar pesanan dan mengekspor", () => {
    mocks.role = "admin_tu";
    render(<BiayaSeragamSPMB />);
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
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

  describe("menu Export (berkas vendor dan internal)", () => {
    const klikEkspor = (nama: string) => {
      fireEvent.keyDown(screen.getByRole("button", { name: /Export/ }), { key: "Enter" });
      fireEvent.click(screen.getByRole("menuitem", { name: nama }));
    };

    it("berkas vendor: diunduh dengan nama dari tahun ajaran dan lembaga, lalu peringatan karena satu stel belum berharga", () => {
      render(<BiayaSeragamSPMB />);
      klikEkspor("Berkas untuk vendor (.xlsx)");
      expect(mocks.unduh).toHaveBeenCalledTimes(1);
      const berkas = mocks.unduh.mock.calls[0][0];
      expect(berkas.filename).toBe("pesanan-seragam-vendor-2027-2028-semua-lembaga");
      expect(berkas.sheets.map((s: { name: string }) => s.name)).toEqual(["Rekap", "Daftar Nama"]);
      expect(mocks.warning).toHaveBeenCalledTimes(1);
      expect(mocks.warning.mock.calls[0][0]).toContain("1 entri stel");
      expect(mocks.success).not.toHaveBeenCalled();
    });

    it("berkas vendor PDF: model per lembaga dengan nama berkas sama seperti Excel, lalu peringatan yang sama", async () => {
      render(<BiayaSeragamSPMB />);
      klikEkspor("Berkas untuk vendor (.pdf)");
      await waitFor(() => expect(mocks.unduhPdf).toHaveBeenCalledTimes(1));
      const model = mocks.unduhPdf.mock.calls[0][0];
      expect(model.filename).toBe("pesanan-seragam-vendor-2027-2028-semua-lembaga");
      expect(model.lembaga.map((l: { lembaga: string }) => l.lembaga)).toEqual(["TK"]);
      expect(mocks.unduh).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
      expect(mocks.warning.mock.calls[0][0]).toContain("1 entri stel");
      expect(mocks.success).not.toHaveBeenCalled();
    });

    it("berkas vendor PDF: bila pembuatan PDF gagal, tampil pesan galat dan tidak ada pesan berhasil", async () => {
      mocks.unduhPdf.mockRejectedValue(new Error("gagal"));
      render(<BiayaSeragamSPMB />);
      klikEkspor("Berkas untuk vendor (.pdf)");
      await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
      expect(mocks.error.mock.calls[0][0]).toContain("PDF");
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.warning).not.toHaveBeenCalled();
    });

    it("berkas internal: tiga sheet dan tanpa peringatan", () => {
      render(<BiayaSeragamSPMB />);
      klikEkspor("Berkas internal yayasan (.xlsx)");
      expect(mocks.unduh).toHaveBeenCalledTimes(1);
      const berkas = mocks.unduh.mock.calls[0][0];
      expect(berkas.filename).toBe("pesanan-seragam-internal-2027-2028-semua-lembaga");
      expect(berkas.sheets.map((s: { name: string }) => s.name)).toEqual(["Ringkasan", "Daftar Pesanan", "Rekap Vendor"]);
      expect(mocks.warning).not.toHaveBeenCalled();
    });

    it("daftar belum lengkap: diunduh hanya berisi siswa layak yang stelnya belum lengkap", () => {
      render(<BiayaSeragamSPMB />);
      klikEkspor("Daftar belum lengkap (internal)");
      expect(mocks.unduh).toHaveBeenCalledTimes(1);
      const berkas = mocks.unduh.mock.calls[0][0];
      expect(berkas.filename).toBe("pesanan-seragam-belum-lengkap-2027-2028-semua-lembaga");
      expect(berkas.sheets.map((s: { name: string }) => s.name)).toEqual(["Belum Lengkap"]);
      const nama = berkas.sheets[0].rows.map((r: unknown[]) => r[2]);
      expect(nama).toContain("Ahmad");
      expect(nama).toContain("Candra");
      expect(nama).not.toContain("Budi");
      expect(mocks.success.mock.calls[0][0]).toContain("2 siswa");
    });

    it("daftar belum lengkap: bila semua lengkap tidak ada berkas, hanya pemberitahuan", () => {
      mocks.lengkap = true;
      render(<BiayaSeragamSPMB />);
      klikEkspor("Daftar belum lengkap (internal)");
      expect(mocks.unduh).not.toHaveBeenCalled();
      expect(mocks.success.mock.calls[0][0]).toContain("sudah lengkap");
    });

    it("tidak ada menu Export selama data uang pangkal memuat", () => {
      mocks.pangkalLoading = true;
      render(<BiayaSeragamSPMB />);
      expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
    });
  });
});
