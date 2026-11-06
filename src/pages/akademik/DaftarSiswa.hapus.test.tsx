import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  siswa: [] as Array<Record<string, unknown>>,
  mutate: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/hooks/useSiswa", () => ({
  useSiswaList: () => ({ data: mocks.siswa, isLoading: false }),
  useDeleteSiswa: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useDepartemen: () => ({ data: [] }),
  useTingkat: () => ({ data: [] }),
  useKelas: () => ({ data: [] }),
  useTahunAjaran: () => ({ data: [] }),
  useAngkatan: () => ({ data: [] }),
}));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/pages/akademik/ImportSiswaDialog", () => ({ ImportSiswaDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("xlsx", () => ({
  utils: { json_to_sheet: vi.fn(), book_new: () => ({}), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));

import DaftarSiswa from "./DaftarSiswa";
import { SiswaPunyaRiwayatError } from "@/lib/siswaDeletion";

const row = (over: Record<string, unknown>) => ({
  id: "x", nis: null, nisn: null, jenis_kelamin: "L", foto_url: null, status: "aktif",
  departemen_id: null, siswa_detail: null, kelas_siswa: [], angkatan: null, id_santri_pihak3: null, ...over,
});

const RIWAYAT = [
  { tabel: "tagihan", jumlah: 3 },
  { tabel: "pembayaran", jumlah: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.siswa = [
    row({ id: "a", nama: "Siswa Berisi", status: "aktif" }),
    row({ id: "c", nama: "Calon Budi", status: "calon" }),
  ];
});
afterEach(cleanup);

function klikHapus(nama: string) {
  const tr = screen.getByText(nama).closest("tr") as HTMLElement;
  fireEvent.click(within(tr).getByTitle("Hapus siswa"));
  fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
}

function galatDariMutate(error: Error) {
  const options = mocks.mutate.mock.calls[0][1] as { onError: (err: Error) => void };
  act(() => options.onError(error));
}

describe("Daftar Siswa: hapus siswa", () => {
  it("meneruskan id siswa dan penanganan galat ke mutate", () => {
    render(<DaftarSiswa />);
    klikHapus("Siswa Berisi");

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toBe("a");
    expect(mocks.mutate.mock.calls[0][1]).toEqual(expect.objectContaining({ onError: expect.any(Function) }));
  });

  it("menjelaskan mengapa siswa tidak bisa dihapus bila punya riwayat", () => {
    render(<DaftarSiswa />);
    klikHapus("Siswa Berisi");
    galatDariMutate(new SiswaPunyaRiwayatError(RIWAYAT));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /tidak dapat dihapus/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/Siswa Berisi/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Tagihan \(3\), Pembayaran \(2\)/)).toBeInTheDocument();
  });

  it("untuk siswa aktif menawarkan 'Ubah status' yang membuka form edit", () => {
    render(<DaftarSiswa />);
    klikHapus("Siswa Berisi");
    galatDariMutate(new SiswaPunyaRiwayatError(RIWAYAT));

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Ubah status/ }));

    expect(mocks.navigate).toHaveBeenCalledWith("/akademik/siswa/a/edit");
  });

  it("untuk calon/diterima mengarahkan ke pengunduran diri SPMB, bukan form edit", () => {
    render(<DaftarSiswa />);
    klikHapus("Calon Budi");
    galatDariMutate(new SiswaPunyaRiwayatError(RIWAYAT));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: /Ubah status/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/pengunduran diri/i)).toBeInTheDocument();
  });

  it("galat lain tidak membuka dialog riwayat", async () => {
    render(<DaftarSiswa />);
    klikHapus("Siswa Berisi");
    galatDariMutate(new Error("boom"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
