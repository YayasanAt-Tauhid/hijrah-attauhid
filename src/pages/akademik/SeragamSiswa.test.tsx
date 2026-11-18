import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  siswa: [] as Array<Record<string, unknown>>,
  loading: false,
  navigate: vi.fn(),
  waves: [{ id: "g1", nama: "Gelombang 1" }, { id: "g2", nama: "Gelombang 2" }] as Array<{ id: string; nama: string }>,
  finance: true,
  up: new Map<string, { total: number; paid: number; remaining: number; status: string }>(),
}));

vi.mock("@/hooks/useSiswaSeragam", () => ({
  useSiswaSeragamList: () => ({ data: mocks.siswa, isLoading: mocks.loading }),
  useSpmbGelombang: () => ({ data: mocks.waves }),
  useSeragamUangPangkal: () => ({ allowed: mocks.finance, isLoading: false, error: null, byStudent: mocks.up }),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useDepartemen: () => ({ data: [
    { id: "sd", nama: "SD", kode: "SD" },
    { id: "smp", nama: "SMP", kode: "SMP" },
    { id: "tk", nama: "TK", kode: "TK" },
  ] }),
  useTahunAjaran: () => ({ data: [{ id: "ta1", nama: "2026/2027" }, { id: "ta2", nama: "2025/2026" }] }),
}));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: ({ data, filename, extraSheets, columns }: { data: unknown[]; filename?: string; extraSheets?: Array<{ name: string }>; columns?: unknown[] }) => (
    <button type="button" data-filename={filename} data-sheets={(extraSheets || []).map((sheet) => sheet.name).join("|")} data-columns={columns?.length}>Ekspor {data.length} baris</button>
  ),
}));

import SeragamSiswa from "./SeragamSiswa";

const FULL = [
  { jenis: "Olah raga", ukuran: "S" },
  { jenis: "Putih Merah", ukuran: "M" },
  { jenis: "Coklat", ukuran: "L" },
  { jenis: "Gamis Biru", ukuran: "XL" },
  { jenis: "Pramuka", ukuran: "XXL" },
];

const row = (over: Record<string, unknown>) => ({
  id: "x", nis: null, jenis_kelamin: "L", status: "aktif", departemen_id: "sd",
  siswa_detail: null, kelas_siswa: [], ...over,
});

beforeEach(() => {
  mocks.finance = true;
  mocks.up = new Map([
    ["a", { total: 10_100_000, paid: 2_525_000, remaining: 7_575_000, status: "sebagian" }],
    ["b", { total: 13_100_000, paid: 13_100_000, remaining: 0, status: "lunas" }],
  ]);
  mocks.loading = false;
  mocks.navigate.mockClear();
  mocks.siswa = [
    row({ id: "a", nama: "Ahmad Aktif", nis: "2538001", siswa_detail: { ukuran_seragam: FULL, ukuran_baju: "X3L", tahun_ajaran_id: "ta1", spmb_gelombang_id: "g1" },
      kelas_siswa: [{ aktif: true, kelas: { id: "k1", nama: "1A", departemen_id: "sd" } }] }),
    row({ id: "b", nama: "Bilal Calon", nis: "2538002", status: "diterima", departemen_id: "smp", siswa_detail: { tahun_ajaran_id: "ta2", spmb_gelombang_id: "g2" } }),
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

  it("menampilkan kolom Ukuran Seragam SPMB di antara Stel 5 dan Kelengkapan, '-' bila kosong", () => {
    render(<SeragamSiswa />);
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim() ?? "");
    const index = headers.findIndex((text) => text.startsWith("Ukuran Seragam SPMB"));
    expect(index).toBeGreaterThan(-1);
    expect(headers[index - 1]).toMatch(/^Stel 5/);
    expect(headers[index + 1]).toMatch(/^Kelengkapan/);

    const cellText = (name: string) => {
      const tr = screen.getByText(name).closest("tr") as HTMLElement;
      return within(tr).getAllByRole("cell")[index].textContent?.trim();
    };
    expect(cellText("Ahmad Aktif")).toBe("X3L");
    expect(cellText("Bilal Calon")).toBe("-");
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

  it("menyaring tahun ajaran tujuan dan gelombang seperti di SPMB", () => {
    render(<SeragamSiswa />);
    expect(within(screen.getByLabelText("Tahun ajaran tujuan")).getByRole("option", { name: "2026/2027" })).toBeTruthy();
    expect(within(screen.getByLabelText("Gelombang")).getByRole("option", { name: "Gelombang 2" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tahun ajaran tujuan"), { target: { value: "ta2" } });
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Ahmad Aktif")).toBeNull();
    fireEvent.change(screen.getByLabelText("Tahun ajaran tujuan"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Gelombang"), { target: { value: "g1" } });
    expect(screen.getByText("Ahmad Aktif")).toBeTruthy();
    expect(screen.queryByText("Bilal Calon")).toBeNull();
    expect(screen.getByText("1 siswa")).toBeTruthy();
  });

  it("menampilkan kolom kelima stel, termasuk isinya", () => {
    render(<SeragamSiswa />);
    expect(screen.getByRole("columnheader", { name: /Stel 5/ })).toBeTruthy();
    expect(screen.getByText("Pramuka: XXL")).toBeTruthy();
  });

  it("peran keuangan melihat kolom nominal, dibayar, sisa, dan keterangan uang pangkal", () => {
    render(<SeragamSiswa />);
    expect(screen.getByRole("columnheader", { name: /Nominal Uang Pangkal/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Jumlah Dibayar Uang Pangkal/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Sisa Uang Pangkal/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Keterangan Uang Pangkal/ })).toBeTruthy();
    const ahmad = screen.getByText("Ahmad Aktif").closest("tr") as HTMLElement;
    expect(within(ahmad).getByText("Rp 10.100.000")).toBeTruthy();
    expect(within(ahmad).getByText("Rp 2.525.000")).toBeTruthy();
    expect(within(ahmad).getByText("Rp 7.575.000")).toBeTruthy();
    expect(within(ahmad).getByText("Dibayar sebagian")).toBeTruthy();
    const bilal = screen.getByText("Bilal Calon").closest("tr") as HTMLElement;
    expect(within(bilal).getByText("Lunas")).toBeTruthy();
    const dina = screen.getByText("Dina TK").closest("tr") as HTMLElement;
    expect(within(dina).getByText("Belum ada tagihan")).toBeTruthy();
  });

  it("dropdown status uang pangkal menyaring daftar", () => {
    render(<SeragamSiswa />);
    fireEvent.change(screen.getByLabelText("Uang pangkal"), { target: { value: "sebagian" } });
    expect(screen.getByText("Ahmad Aktif")).toBeTruthy();
    expect(screen.queryByText("Bilal Calon")).toBeNull();
    fireEvent.change(screen.getByLabelText("Uang pangkal"), { target: { value: "lunas" } });
    expect(screen.getByText("Bilal Calon")).toBeTruthy();
    expect(screen.queryByText("Ahmad Aktif")).toBeNull();
  });

  it("ekspor memuat sheet Rekap Seragam untuk semua peran; peran lain tidak melihat data keuangan sama sekali", () => {
    const { unmount } = render(<SeragamSiswa />);
    expect(screen.getByRole("button", { name: /Ekspor/ }).getAttribute("data-sheets")).toBe("Rekap Seragam");
    unmount();
    mocks.finance = false;
    render(<SeragamSiswa />);
    expect(screen.queryByRole("columnheader", { name: /Uang Pangkal/ })).toBeNull();
    expect(screen.queryByLabelText("Uang pangkal")).toBeNull();
    expect(screen.queryByText("Rp 10.100.000")).toBeNull();
    expect(screen.getByRole("button", { name: /Ekspor/ }).getAttribute("data-sheets")).toBe("Rekap Seragam");
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
