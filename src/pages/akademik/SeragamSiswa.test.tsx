import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  siswa: [] as Array<Record<string, unknown>>,
  loading: false,
  navigate: vi.fn(),
}));

vi.mock("@/hooks/useSiswaSeragam", () => ({
  useSiswaSeragamList: () => ({ data: mocks.siswa, isLoading: mocks.loading }),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useDepartemen: () => ({ data: [
    { id: "sd", nama: "SD", kode: "SD" },
    { id: "smp", nama: "SMP", kode: "SMP" },
    { id: "tk", nama: "TK", kode: "TK" },
  ] }),
}));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: ({ data, filename }: { data: unknown[]; filename?: string }) => (
    <button type="button" data-filename={filename}>Ekspor {data.length} baris</button>
  ),
}));

import SeragamSiswa from "./SeragamSiswa";

const FULL = [
  { jenis: "Olah raga", ukuran: "S" },
  { jenis: "Putih Merah", ukuran: "M" },
  { jenis: "Coklat", ukuran: "L" },
  { jenis: "Gamis Biru", ukuran: "XL" },
];

const row = (over: Record<string, unknown>) => ({
  id: "x", nis: null, jenis_kelamin: "L", status: "aktif", departemen_id: "sd",
  siswa_detail: null, kelas_siswa: [], ...over,
});

beforeEach(() => {
  mocks.loading = false;
  mocks.navigate.mockClear();
  mocks.siswa = [
    row({ id: "a", nama: "Ahmad Aktif", nis: "2538001", siswa_detail: { ukuran_seragam: FULL },
      kelas_siswa: [{ aktif: true, kelas: { id: "k1", nama: "1A", departemen_id: "sd" } }] }),
    row({ id: "b", nama: "Bilal Calon", nis: "2538002", status: "diterima", departemen_id: "smp" }),
    row({ id: "c", nama: "Citra Alumni", status: "alumni" }),
    row({ id: "d", nama: "Dina TK", departemen_id: "tk", jenis_kelamin: "P" }),
  ];
});
afterEach(cleanup);

describe("halaman Seragam Siswa", () => {
  it("menampilkan siswa aktif dan calon diterima, tanpa alumni", () => {
    render(<SeragamSiswa />);
    expect(screen.getByText("Ahmad Aktif")).toBeTruthy();
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Citra Alumni")).toBeNull();
    expect(screen.getByText("3 siswa")).toBeTruthy();
  });

  it("menampilkan nama jenis dan ukuran tiap stel, serta penanda belum diisi", () => {
    render(<SeragamSiswa />);
    const ahmad = screen.getByText("Ahmad Aktif").closest("tr") as HTMLElement;
    expect(within(ahmad).getByText("Olah raga: S")).toBeTruthy();
    expect(within(ahmad).getByText("Gamis Biru: XL")).toBeTruthy();
    expect(within(ahmad).getByText("Lengkap")).toBeTruthy();
    const bilal = screen.getByText("Bilal Calon").closest("tr") as HTMLElement;
    expect(within(bilal).getAllByText(/: Belum diisi$/)).toHaveLength(4);
    expect(within(bilal).getByText("Calon diterima")).toBeTruthy();
    expect(within(bilal).getByText("Belum lengkap")).toBeTruthy();
  });

  it("menjelaskan bahwa data seragam TK belum tersedia", () => {
    render(<SeragamSiswa />);
    const tk = screen.getByText("Dina TK").closest("tr") as HTMLElement;
    expect(within(tk).getByText(/Data seragam TK belum tersedia/)).toBeTruthy();
    expect(within(tk).queryByText("Belum lengkap")).toBeNull();
  });

  it("filter status memisahkan siswa aktif dari calon diterima", () => {
    render(<SeragamSiswa />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "diterima" } });
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Ahmad Aktif")).toBeNull();
    expect(screen.getByText("1 siswa")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "aktif" } });
    expect(screen.getByText("Ahmad Aktif")).toBeTruthy();
    expect(screen.queryByText("Bilal Calon")).toBeNull();
  });

  it("pencarian dan filter lembaga/kelengkapan menyaring daftar", () => {
    render(<SeragamSiswa />);
    fireEvent.change(screen.getByLabelText("Cari siswa"), { target: { value: "2538002" } });
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Ahmad Aktif")).toBeNull();
    fireEvent.change(screen.getByLabelText("Cari siswa"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Lembaga"), { target: { value: "sd" } });
    expect(screen.getByText("Ahmad Aktif")).toBeTruthy();
    expect(screen.queryByText("Bilal Calon")).toBeNull();
    fireEvent.change(screen.getByLabelText("Lembaga"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Kelengkapan"), { target: { value: "belum_lengkap" } });
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Ahmad Aktif")).toBeNull();
  });

  it("ekspor mengikuti hasil filter", () => {
    render(<SeragamSiswa />);
    expect(screen.getByRole("button", { name: "Ekspor 3 baris" }).getAttribute("data-filename")).toBe("seragam-siswa");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "diterima" } });
    expect(screen.getByRole("button", { name: "Ekspor 1 baris" })).toBeTruthy();
  });

  it("menampilkan pesan kosong bila tidak ada hasil", () => {
    mocks.siswa = [];
    render(<SeragamSiswa />);
    expect(screen.getByText("Tidak ada siswa yang cocok dengan filter ini")).toBeTruthy();
  });

  it("tombol ubah membuka form siswa tempat ukuran seragam diisi", () => {
    render(<SeragamSiswa />);
    fireEvent.click(screen.getByRole("button", { name: "Ubah seragam Ahmad Aktif" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/akademik/siswa/a/edit");
  });
});
