import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HargaSeragamVendor } from "@/lib/seragamVendor";

const mocks = vi.hoisted(() => ({
  simpan: vi.fn(), ubahAktif: vi.fn(), salin: vi.fn(),
  sumber: { data: [] as unknown[], isLoading: false, error: null as unknown },
}));
vi.mock("@/hooks/useHargaSeragamVendor", () => ({
  useHargaSeragamVendor: () => mocks.sumber,
  useSimpanHargaSeragamVendor: () => ({ mutateAsync: mocks.simpan, isPending: false }),
  useUbahAktifHarga: () => ({ mutateAsync: mocks.ubahAktif, isPending: false }),
  useSalinHargaSeragam: () => ({ mutateAsync: mocks.salin, isPending: false }),
}));

import BiayaSeragamHargaTab from "./BiayaSeragamHargaTab";

const TA = "ta-2027";
const TK = "dept-tk";
const harga: HargaSeragamVendor[] = [
  { id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah", ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true },
  { id: "h2", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "semua", nama_stel: "Pramuka", ukuran: [], harga: 260000, catatan: null, aktif: false },
];
const props = {
  tahunAjaranId: TA,
  tahunList: [{ id: TA, nama: "2027/2028" }, { id: "ta-2026", nama: "2026/2027" }],
  departemenList: [{ id: TK, nama: "Taman Kanak-kanak", kode: "TK" }],
  harga,
  loading: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.simpan.mockResolvedValue(undefined);
  mocks.ubahAktif.mockResolvedValue(undefined);
  mocks.sumber.data = [];
  mocks.sumber.isLoading = false;
  mocks.sumber.error = null;
});
afterEach(cleanup);

describe("tab Harga", () => {
  it("menampilkan harga, ukuran, dan status aktif/nonaktif", () => {
    render(<BiayaSeragamHargaTab {...props} />);
    expect(screen.getByText("Set Gamis Merah")).toBeInTheDocument();
    expect(screen.getByText("Rp 170.000")).toBeInTheDocument();
    expect(screen.getByText("S, M")).toBeInTheDocument();
    expect(screen.getByText("Semua ukuran")).toBeInTheDocument();
    expect(screen.getByText("Nonaktif")).toBeInTheDocument();
  });

  it("menambah harga baru: ukuran dipisah koma dan dikirim ternormalisasi", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Jenis kelamin"), { target: { value: "P" } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Set Gamis Hijau" } });
    fireEvent.change(within(dialog).getByLabelText("Ukuran (pisahkan dengan koma, kosong = semua)"), { target: { value: "x4l, s" } });
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "185000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
    expect(mocks.simpan.mock.calls[0][0]).toMatchObject({
      tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "P", nama_stel: "Set Gamis Hijau",
      ukuran: ["S", "4XL"], harga: 185000, aktif: true,
    });
    expect(mocks.simpan.mock.calls[0][0].id).toBeUndefined();
  });

  it("menolak harga yang bertabrakan dengan baris aktif tanpa memanggil basis data", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Jenis kelamin"), { target: { value: "semua" } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "set gamis merah" } });
    fireEvent.change(within(dialog).getByLabelText("Ukuran (pisahkan dengan koma, kosong = semua)"), { target: { value: "S" } });
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "170000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/bertabrakan/i);
    expect(mocks.simpan).not.toHaveBeenCalled();
  });

  it("menolak isian tidak valid (harga kosong)", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Stel Baru" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Isi harga.");
    expect(mocks.simpan).not.toHaveBeenCalled();
  });

  it("mengubah baris: form terisi dan id ikut dikirim", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah Set Gamis Merah" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nama stel")).toHaveValue("Set Gamis Merah");
    fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "175000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
    expect(mocks.simpan.mock.calls[0][0]).toMatchObject({ id: "h1", harga: 175000, aktif: true });
  });

  it("menonaktifkan dan mengaktifkan kembali tanpa menghapus", async () => {
    render(<BiayaSeragamHargaTab {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan Set Gamis Merah" }));
    await waitFor(() => expect(mocks.ubahAktif).toHaveBeenCalledWith({ id: "h1", aktif: false }));
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan Pramuka" }));
    await waitFor(() => expect(mocks.ubahAktif).toHaveBeenCalledWith({ id: "h2", aktif: true }));
    expect(screen.queryByRole("button", { name: /hapus/i })).not.toBeInTheDocument();
  });

  it("menyalin dari tahun sebelumnya hanya untuk lembaga yang masih kosong di tahun tujuan", async () => {
    mocks.salin.mockResolvedValue(undefined);
    mocks.sumber.data = [
      { id: "s1", tahun_ajaran_id: "ta-2026", departemen_id: "dept-sd", jenis_kelamin: "L", nama_stel: "Olah raga", ukuran: [], harga: 100000, catatan: null, aktif: true },
    ];
    render(<BiayaSeragamHargaTab {...props} departemenList={[...props.departemenList, { id: "dept-sd", nama: "SD", kode: "SD" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Salin dari tahun lain" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Salin dari tahun ajaran"), { target: { value: "ta-2026" } });
    // TK sudah punya baris di tahun tujuan → tidak ada yang disalin
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/sudah punya harga|tidak ada yang bisa disalin/i);
    expect(mocks.salin).not.toHaveBeenCalled();
    // SD kosong di tahun tujuan → tersalin
    fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: "dept-sd" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
    await waitFor(() => expect(mocks.salin).toHaveBeenCalledTimes(1));
    expect(mocks.salin.mock.calls[0][0]).toHaveLength(1);
    expect(mocks.salin.mock.calls[0][0][0]).toMatchObject({ tahun_ajaran_id: TA, departemen_id: "dept-sd", nama_stel: "Olah raga" });
    mocks.sumber.data = [];
  });

  describe("filter lembaga hanya untuk tampilan", () => {
    const SD = "dept-sd";
    const hargaSd: HargaSeragamVendor = {
      id: "h3", tahun_ajaran_id: TA, departemen_id: SD, jenis_kelamin: "semua", nama_stel: "Seragam SD Biru", ukuran: ["S"], harga: 120000, catatan: null, aktif: true,
    };
    const propsFilter = {
      ...props,
      departemenList: [...props.departemenList, { id: SD, nama: "SD", kode: "SD" }],
      harga: [...harga, hargaSd],
      lembagaId: TK,
    };

    afterEach(() => { mocks.sumber.data = []; });

    it("hanya menampilkan baris lembaga yang dipilih", () => {
      render(<BiayaSeragamHargaTab {...propsFilter} />);
      expect(screen.getByText("Set Gamis Merah")).toBeInTheDocument();
      expect(screen.queryByText("Seragam SD Biru")).not.toBeInTheDocument();
    });

    it("menolak salin ke lembaga lain yang sudah punya harga di tahun tujuan walau tidak tampil di tabel", async () => {
      mocks.salin.mockResolvedValue(undefined);
      mocks.sumber.data = [
        { id: "s2", tahun_ajaran_id: "ta-2026", departemen_id: SD, jenis_kelamin: "L", nama_stel: "Olah raga", ukuran: [], harga: 100000, catatan: null, aktif: true },
      ];
      render(<BiayaSeragamHargaTab {...propsFilter} />);
      fireEvent.click(screen.getByRole("button", { name: "Salin dari tahun lain" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Salin dari tahun ajaran"), { target: { value: "ta-2026" } });
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: SD } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(/sudah punya harga|tidak ada yang bisa disalin/i);
      expect(mocks.salin).not.toHaveBeenCalled();
    });

    it("tetap mendeteksi tabrakan dengan baris aktif lembaga lain yang tersaring dari tampilan", async () => {
      render(<BiayaSeragamHargaTab {...propsFilter} />);
      fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: SD } });
      fireEvent.change(within(dialog).getByLabelText("Jenis kelamin"), { target: { value: "semua" } });
      fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "seragam sd biru" } });
      fireEvent.change(within(dialog).getByLabelText("Ukuran (pisahkan dengan koma, kosong = semua)"), { target: { value: "S" } });
      fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "120000" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(/bertabrakan/i);
      expect(mocks.simpan).not.toHaveBeenCalled();
    });
  });

  describe("pengisian harga dengan titik ribuan", () => {
    async function isiFormDenganHarga(isian: string) {
      render(<BiayaSeragamHargaTab {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
      fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Stel Titik" } });
      fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: isian } });
      return dialog;
    }

    it.each([
      ["170.000", 170000],
      ["1.250.000", 1250000],
      ["Rp 185.000", 185000],
      ["185000", 185000],
    ])("menerima %s sebagai %i", async (isian, nilai) => {
      const dialog = await isiFormDenganHarga(isian);
      fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
      await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
      expect(mocks.simpan.mock.calls[0][0].harga).toBe(nilai);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it.each(["170,000", "17.5"])("menolak %s tanpa memanggil basis data", async (isian) => {
      const dialog = await isiFormDenganHarga(isian);
      fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
      expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
      expect(mocks.simpan).not.toHaveBeenCalled();
    });

    it("menerima tepat batas atas Rp 100.000.000", async () => {
      const dialog = await isiFormDenganHarga("100.000.000");
      fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
      await waitFor(() => expect(mocks.simpan).toHaveBeenCalledTimes(1));
      expect(mocks.simpan.mock.calls[0][0].harga).toBe(100000000);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it.each(["100.000.001", "999999999999999999"])("menolak %s karena melewati batas atas", async (isian) => {
      const dialog = await isiFormDenganHarga(isian);
      fireEvent.click(within(dialog).getByRole("button", { name: "Simpan" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Harga terlalu besar (maksimal Rp 100.000.000).");
      expect(mocks.simpan).not.toHaveBeenCalled();
    });
  });

  describe("data harga belum siap (memuat atau gagal dimuat)", () => {
    it("saat memuat: Tambah harga dan Salin dari tahun lain nonaktif", () => {
      render(<BiayaSeragamHargaTab {...props} harga={[]} loading />);
      expect(screen.getByRole("button", { name: "Tambah harga" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Salin dari tahun lain" })).toBeDisabled();
      expect(screen.getByText("Harga tahun ajaran ini belum selesai dimuat.")).toBeInTheDocument();
      expect(mocks.simpan).not.toHaveBeenCalled();
      expect(mocks.salin).not.toHaveBeenCalled();
    });

    it("saat gagal dimuat: semua aksi nonaktif, termasuk Ubah dan Nonaktifkan/Aktifkan per baris", () => {
      render(<BiayaSeragamHargaTab {...props} error />);
      expect(screen.getByRole("button", { name: "Tambah harga" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Salin dari tahun lain" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Ubah Set Gamis Merah" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Nonaktifkan Set Gamis Merah" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Aktifkan Pramuka" })).toBeDisabled();
      expect(screen.getByText("Harga vendor belum dapat dimuat.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan Set Gamis Merah" }));
      expect(mocks.ubahAktif).not.toHaveBeenCalled();
    });

    it("dialog yang sudah terbuka: Simpan nonaktif bila data berubah menjadi gagal dimuat", async () => {
      const { rerender } = render(<BiayaSeragamHargaTab {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Tambah harga" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: TK } });
      fireEvent.change(within(dialog).getByLabelText("Nama stel"), { target: { value: "Stel Baru" } });
      fireEvent.change(within(dialog).getByLabelText("Harga (Rp)"), { target: { value: "150000" } });
      rerender(<BiayaSeragamHargaTab {...props} error />);
      const simpanTombol = within(await screen.findByRole("dialog")).getByRole("button", { name: "Simpan" });
      expect(simpanTombol).toBeDisabled();
      fireEvent.click(simpanTombol);
      expect(mocks.simpan).not.toHaveBeenCalled();
    });

    it("tahun sumber salin masih memuat: Salin nonaktif dengan pesan yang jelas", async () => {
      mocks.sumber.isLoading = true;
      render(<BiayaSeragamHargaTab {...props} departemenList={[...props.departemenList, { id: "dept-sd", nama: "SD", kode: "SD" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "Salin dari tahun lain" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Salin dari tahun ajaran"), { target: { value: "ta-2026" } });
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: "dept-sd" } });
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Harga tahun sumber belum selesai dimuat.");
      expect(within(dialog).getByRole("button", { name: "Salin" })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Salin" }));
      expect(mocks.salin).not.toHaveBeenCalled();
    });

    it("tahun sumber gagal dimuat: pesan galat sumber, bukan pesan 'sumbernya kosong'", async () => {
      mocks.sumber.error = new Error("gagal");
      render(<BiayaSeragamHargaTab {...props} departemenList={[...props.departemenList, { id: "dept-sd", nama: "SD", kode: "SD" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "Salin dari tahun lain" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Salin dari tahun ajaran"), { target: { value: "ta-2026" } });
      fireEvent.change(within(dialog).getByLabelText("Lembaga"), { target: { value: "dept-sd" } });
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("Harga tahun sumber belum dapat dimuat.");
      expect(alert).not.toHaveTextContent(/sumbernya kosong/i);
      expect(within(dialog).getByRole("button", { name: "Salin" })).toBeDisabled();
      expect(mocks.salin).not.toHaveBeenCalled();
    });
  });
});
