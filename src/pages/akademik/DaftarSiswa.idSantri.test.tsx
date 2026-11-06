import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  siswa: [] as Array<Record<string, unknown>>,
  jsonToSheet: vi.fn((rows: unknown) => ({ rows })),
}));

vi.mock("@/hooks/useSiswa", () => ({
  useSiswaList: () => ({ data: mocks.siswa, isLoading: false }),
  useDeleteSiswa: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useDepartemen: () => ({ data: [] }),
  useTingkat: () => ({ data: [] }),
  useKelas: () => ({ data: [] }),
  useTahunAjaran: () => ({ data: [] }),
  useAngkatan: () => ({ data: [] }),
}));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/pages/akademik/ImportSiswaDialog", () => ({ ImportSiswaDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("xlsx", () => ({
  utils: { json_to_sheet: mocks.jsonToSheet, book_new: () => ({}), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));

import DaftarSiswa from "./DaftarSiswa";

const row = (over: Record<string, unknown>) => ({
  id: "x", nis: null, nisn: null, jenis_kelamin: "L", foto_url: null, status: "aktif",
  departemen_id: null, siswa_detail: null, kelas_siswa: [], angkatan: null, id_santri_pihak3: null, ...over,
});

beforeEach(() => {
  mocks.jsonToSheet.mockClear();
  mocks.siswa = [
    row({ id: "a", nama: "Siswa Berisi", nis: "2538001125", id_santri_pihak3: "21.01.001" }),
    row({ id: "b", nama: "Siswa Kosong", nis: "2538002125", id_santri_pihak3: null }),
  ];
});
afterEach(cleanup);

describe("Daftar Siswa: ID Santri", () => {
  it("menampilkan kolom ID Santri beserta nilainya", () => {
    render(<DaftarSiswa />);
    expect(screen.getByRole("columnheader", { name: /ID Santri/ })).toBeInTheDocument();
    expect(screen.getByText("21.01.001")).toBeInTheDocument();
  });

  it("memberi tanda strip pada siswa yang belum punya ID Santri, di sel kolom yang sama", () => {
    render(<DaftarSiswa />);
    const idx = screen.getAllByRole("columnheader").findIndex((h) => /ID Santri/.test(h.textContent || ""));
    expect(idx).toBeGreaterThanOrEqual(0);
    const kosong = screen.getByText("Siswa Kosong").closest("tr") as HTMLElement;
    expect(within(kosong).getAllByRole("cell")[idx]).toHaveTextContent("-");
  });

  it("bisa dicari lewat ID Santri", () => {
    render(<DaftarSiswa />);
    fireEvent.change(screen.getByPlaceholderText(/ID Santri/), { target: { value: "21.01.001" } });
    expect(screen.getByText("Siswa Berisi")).toBeInTheDocument();
    expect(screen.queryByText("Siswa Kosong")).not.toBeInTheDocument();
  });

  it("ikut dalam ekspor Excel; kosong menjadi string kosong", () => {
    render(<DaftarSiswa />);
    fireEvent.click(screen.getByRole("button", { name: /Export Excel/ }));
    expect(mocks.jsonToSheet).toHaveBeenCalledTimes(1);
    const rows = mocks.jsonToSheet.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.map((r) => r["ID Santri"])).toEqual(["21.01.001", ""]);
  });
});
