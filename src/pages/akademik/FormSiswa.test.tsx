import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FormSiswa from "./FormSiswa";
import { generateNis } from "@/server/nis";

const mocks = vi.hoisted(() => {
  const dept = { id: "00000000-0000-4000-8000-000000000001", kode: "SD", nama: "SD" };
  const sizes = [{ jenis: "SETELAN SERAGAM BIRU", ukuran: "S" }, { jenis: "SETELAN SERAGAM (MERAH PUTIH DAN COKLAT)", ukuran: "M" }, { jenis: "SETELAN OLAH RAGA", ukuran: "ALL SIZE" }, { jenis: "", ukuran: "" }];
  return {
    dept, sizes, departments: [dept], empty: [],
    siswa: { id: "student", nama: "Siswa Uji", jenis_kelamin: "L", status: "aktif", angkatan_id: "00000000-0000-4000-8000-000000000002", departemen_id: dept.id },
    detail: { ukuran_seragam: sizes, ukuran_baju: "X3L" },
    update: vi.fn().mockResolvedValue(undefined),
    client: { invalidateQueries: vi.fn().mockResolvedValue(undefined), setQueryData: vi.fn() },
  };
});
vi.mock("@/lib/router-compat", () => ({ useParams: () => ({ id: "student" }), useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => mocks.client }));
vi.mock("@/hooks/useSiswa", () => ({
  useSiswaDetail: () => ({ data: mocks.siswa }),
  useSiswaDetailOrangtua: () => ({ data: mocks.detail }),
  useCreateSiswa: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateSiswa: () => ({ isPending: false, mutateAsync: mocks.update }),
}));
vi.mock("@/hooks/useAkademikData", () => ({
  useDepartemenPendidikan: () => ({ data: mocks.departments }),
  useAngkatan: () => ({ data: mocks.empty }),
  useTahunAjaran: () => ({ data: mocks.empty }),
  useTingkat: () => ({ data: mocks.empty }),
  useKelas: () => ({ data: mocks.empty }),
}));
vi.mock("@/components/akademik/SpmbNisField", () => ({ SpmbNisField: () => null }));
vi.mock("@/server/nis", () => ({ generateNis: vi.fn() }));
vi.mock("@/hooks/useSpmbVerification", () => ({
  useSpmbVerificationState: () => ({}),
  fetchSpmbVerificationState: vi.fn(),
  saveSpmbVerificationFields: vi.fn(),
  spmbVerificationQueryKey: (id: string) => ["verification", id],
}));
vi.mock("@/components/shared/FileUpload", () => ({ FileUpload: () => null }));
vi.mock("@/components/akademik/SpmbDocumentUpload", () => ({ SpmbDocumentUpload: () => null }));
vi.mock("@/components/akademik/SpmbFieldVerification", () => ({ SpmbFieldVerification: () => null }));
beforeEach(() => mocks.update.mockClear());
afterEach(cleanup);

function openUniformTab() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Ukuran Seragam" }), { button: 0, ctrlKey: false });
}
it("memuat ukuran tersimpan, menyimpan empat stel bersama data siswa, dan mempertahankan ukuran lama", async () => {
  render(<FormSiswa />);
  openUniformTab();
  expect(await screen.findByLabelText("Ukuran stel 2")).toHaveValue("M");
  fireEvent.change(screen.getByLabelText("Ukuran stel 2"), { target: { value: "XXL" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  const saved = mocks.update.mock.calls[0][0];
  expect(saved.detail.ukuran_seragam).toEqual([mocks.sizes[0], { ...mocks.sizes[1], ukuran: "XXL" }, mocks.sizes[2], { jenis: "Gamis Biru", ukuran: "" }]);
  expect(saved.detail.ukuran_baju).toBe("X3L");
});
it("perubahan data lain tidak menimpa ukuran seragam yang tersimpan", async () => {
  render(<FormSiswa />);
  fireEvent.change(await screen.findByLabelText("Nama Lengkap *"), { target: { value: "Nama Diperbarui" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  expect(mocks.update.mock.calls[0][0].detail).not.toHaveProperty("ukuran_seragam");
});
it("menyimpan nama jenis seragam yang diedit meskipun ukuran belum diisi", async () => {
  render(<FormSiswa />);
  openUniformTab();
  fireEvent.change(await screen.findByLabelText("Nama jenis seragam stel 4"), { target: { value: "Gamis Biru Pesanan" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  expect(mocks.update.mock.calls[0][0].detail.ukuran_seragam[3]).toEqual({ jenis: "Gamis Biru Pesanan", ukuran: "" });
});
it("ukuran tanpa nama ditolak sebelum mengirim data", async () => {
  render(<FormSiswa />);
  openUniformTab();
  fireEvent.change(await screen.findByLabelText("Nama jenis seragam stel 1"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  expect(await screen.findByText("Isi nama jenis seragam stel 1.")).toBeInTheDocument();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("siswa tanpa ukuran tersimpan mendapat empat nama bawaan yang bisa disimpan", async () => {
  const original = mocks.detail.ukuran_seragam;
  mocks.detail.ukuran_seragam = null;
  try {
    render(<FormSiswa />);
    openUniformTab();
    expect(await screen.findByLabelText("Nama jenis seragam stel 1")).toHaveValue("Olah raga");
    fireEvent.change(screen.getByLabelText("Ukuran stel 3"), { target: { value: "L" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0].detail.ukuran_seragam.map((item: { jenis: string }) => item.jenis)).toEqual(["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]);
  } finally { mocks.detail.ukuran_seragam = original; }
});

it("membuat NIS tanpa kelas ketika lembaga dan angkatan sudah tersedia", async () => {
  vi.mocked(generateNis).mockResolvedValue({ success: true, nis: "2602001" });
  render(<FormSiswa />);
  const button = await screen.findByRole("button", { name: "Generate NIS", exact: true });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(generateNis).toHaveBeenCalledWith({
    data: expect.objectContaining({
      siswa_id: "student",
      departemen_id: mocks.dept.id,
      angkatan_id: "00000000-0000-4000-8000-000000000002",
      kelas_id: "",
    }),
  }));
  await waitFor(() => expect(screen.getByLabelText("NIS", { exact: true })).toHaveValue("2602001"));
});
