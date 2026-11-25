import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ role: "keuangan" as string | null, siswa: [] as Array<Record<string, unknown>> }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
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
  utils: { json_to_sheet: vi.fn(), book_new: () => ({}), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));

import DaftarSiswa from "./DaftarSiswa";

beforeEach(() => {
  mocks.role = "keuangan";
  mocks.siswa = [{
    id: "a", nama: "Siswa Satu", nis: null, nisn: null, jenis_kelamin: "L", foto_url: null, status: "aktif",
    departemen_id: null, siswa_detail: null, kelas_siswa: [], angkatan: null, id_santri_pihak3: null,
  }];
});
afterEach(cleanup);

describe("DaftarSiswa: mode baca saja untuk keuangan", () => {
  it("menampilkan daftar dan tombol lihat, tanpa aksi tulis", () => {
    render(<DaftarSiswa />);
    expect(screen.getByText("Siswa Satu")).toBeInTheDocument();
    expect(screen.getByTitle("Lihat data lengkap")).toBeInTheDocument();
    expect(screen.queryByTitle("Edit data lengkap")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Hapus siswa")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tambah Siswa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import Data Siswa/ })).not.toBeInTheDocument();
  });

  it("tetap menyediakan unduhan data (membaca)", () => {
    render(<DaftarSiswa />);
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeInTheDocument();
  });

  it.each(["admin", "admin_tu"])("%s tetap mendapat semua aksi tulis", role => {
    mocks.role = role;
    render(<DaftarSiswa />);
    expect(screen.getByTitle("Edit data lengkap")).toBeInTheDocument();
    expect(screen.getByTitle("Hapus siswa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tambah Siswa/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import Data Siswa/ })).toBeInTheDocument();
  });
});
