import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import TabTarifTagihan from "./TabTarifTagihan";

const {
  save,
  jenisData,
  tahunBukuData,
  lembagaData,
  tahunAjaranData,
  emptyData,
} = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue({ success: true }),
  jenisData: [
    {
      id: "pangkal-tk",
      nama: "UANG PANGKAL TK",
      tipe: "sekali",
      departemen_id: "tk",
    },
  ],
  tahunBukuData: [
    {
      id: "tb2026",
      nama: "Tahun 2026",
      tanggal_mulai: "2026-01-01",
      tanggal_selesai: "2026-12-31",
    },
    {
      id: "tb2027",
      nama: "Tahun 2027",
      tanggal_mulai: "2027-01-01",
      tanggal_selesai: "2027-12-31",
    },
  ],
  lembagaData: [{ id: "tk", nama: "TK", kode: "TK" }],
  tahunAjaranData: [
    {
      id: "ta2026",
      nama: "2026/2027",
      aktif: true,
      tanggal_mulai: "2026-07-01",
      tanggal_selesai: "2027-06-30",
    },
  ],
  emptyData: [],
}));
vi.mock("@/hooks/useKeuangan", () => ({
  useAllJenisPembayaran: () => ({ data: jenisData }),
  useTahunBuku: () => ({ data: tahunBukuData }),
  useLembaga: () => ({ data: lembagaData }),
  formatRupiah: (value: number) => `Rp ${value}`,
  namaBulan: (value: number) => String(value),
  namaBulanTahun: (value: number) => String(value),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useKelas: () => ({ data: emptyData }),
  useAngkatan: () => ({ data: emptyData }),
  useTahunAjaran: () => ({ data: tahunAjaranData }),
}));
vi.mock("@/hooks/useTarifTagihan", () => ({
  useAllTarifTagihan: () => ({ data: emptyData }),
  useCreateTarifTagihan: () => ({ isPending: false }),
  useUpdateTarifTagihan: () => ({ isPending: false }),
  useNonaktifkanTarifTagihan: () => ({ isPending: false }),
}));
vi.mock("@/hooks/useTarifGenerateAtomik", () => ({
  useSimpanTarifGenerateAtomik: () => ({ isPending: false, mutateAsync: save }),
}));
vi.mock("@/hooks/useTagihan", () => ({
  useTagihanList: () => ({ data: emptyData }),
}));
vi.mock("@/components/shared/DataTable", () => ({ DataTable: () => null }));
vi.mock("./TarifMassalDialog", () => ({ default: () => null }));
vi.mock("@/components/shared/SiswaCombobox", () => ({
  SiswaCombobox: () => null,
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => save.mockClear());
afterEach(cleanup);

describe("Tambah Tagihan dari siswa terpilih", () => {
  const siswa = {
    id: "ahmad",
    nama: "Ahmad Uwais",
    nis: "26-01-001",
    departemen_id: "tk",
  };

  it("prefills the student and academic year, and creates only a single one-time bill", async () => {
    const onClose = vi.fn();
    render(
      <TabTarifTagihan dialogOnly initialSiswa={siswa} onClose={onClose} />,
    );
    expect(screen.getByText("NIS: 26-01-001 · TK")).toBeVisible();
    expect(screen.queryByText("Kelas (opsional)")).not.toBeInTheDocument();
    expect(screen.queryByText("Daftar Tagihan")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Pilih jenis pembayaran..." }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "UANG PANGKAL TK" }),
    );
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "4200000" },
    });
    const submit = screen.getByRole("button", {
      name: "Simpan & Buat Tagihan",
    });
    await waitFor(() => {
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        siswa_id: "ahmad",
        departemen_id: "tk",
        tahun_akademik_id: "ta2026",
        jenis_id: "pangkal-tk",
        tarif_rows: [
          {
            jenis_id: "pangkal-tk",
            siswa_id: "ahmad",
            kelas_id: null,
            angkatan_id: null,
            tahun_ajaran_id: "tb2026",
            nominal: 4200000,
            keterangan: null,
          },
        ],
        generate_groups: [{ tahun_buku_id: "tb2026", bulan_list: [null] }],
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes without creating a bill when cancelled", () => {
    const onClose = vi.fn();
    render(
      <TabTarifTagihan dialogOnly initialSiswa={siswa} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
