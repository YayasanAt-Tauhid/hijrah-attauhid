import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UniformStatistics } from "./UniformStatistics";
const exportSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: ({ data }: { data: Record<string, unknown>[] }) => <button onClick={() => exportSpy(data)}>Ekspor uji</button>,
}));
afterEach(() => { cleanup(); exportSpy.mockClear(); });
const departments = [{ id: "smp", nama: "SMP", kode: "SMP" }, { id: "tk", nama: "TK", kode: "TK" }];
const rows = [
  { departemen_id: "smp", jenis_kelamin: "L", _spmbStatusKelulusan: "lulus", _spmbDetail: { ukuran_seragam: [{ jenis: "Putih Biru Ikhwan", ukuran: "S" }] } },
  { departemen_id: "smp", jenis_kelamin: "P", _spmbStatusKelulusan: "lulus", _spmbDetail: { ukuran_seragam: [{ jenis: "Gamis Ungu Khusus", ukuran: "XL" }] } },
  { departemen_id: "smp", jenis_kelamin: "P", _spmbStatusKelulusan: "tidak_lulus", _spmbDetail: { ukuran_seragam: [{ jenis: "Gamis Putri Cadangan", ukuran: "L" }] } },
  { departemen_id: "tk", jenis_kelamin: "P" },
];
describe("statistik seragam", () => {
  it("menampilkan rekap tersimpan serta pengecualian TK, dan mengekspor hasil filter", () => {
    render(<UniformStatistics rows={rows} departments={departments} />);
    expect(screen.getByRole("region", { name: "Statistik seragam" })).toBeInTheDocument();
    expect(screen.getByText("1 pendaftar TK belum dihitung karena data seragam TK belum tersedia.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jenis kelamin seragam"), { target: { value: "P" } });
    fireEvent.change(screen.getByLabelText("Kelulusan untuk rekap"), { target: { value: "lulus" } });
    expect(screen.getByText("Gamis Ungu Khusus")).toBeInTheDocument();
    expect(screen.queryByText("Putih Biru Ikhwan")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamis Putri Cadangan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ekspor uji" }));
    expect(exportSpy).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ jenis: "Gamis Ungu Khusus", ukuran: "XL", jumlah: 1 })]));
    expect(exportSpy.mock.calls[0][0].every((row: Record<string, unknown>) => row.jenisKelamin === "Akhwat")).toBe(true);
  });
  it("pencarian mengekspor hanya rekap yang cocok dan data kosong tidak membuat pesanan palsu", () => {
    render(<UniformStatistics rows={rows.slice(0, 1)} departments={departments} />);
    fireEvent.change(screen.getByPlaceholderText("Cari lembaga, jenis, atau ukuran seragam..."), { target: { value: "Putih Biru Ikhwan" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekspor uji" }));
    expect(exportSpy.mock.calls[0][0]).toHaveLength(1);
    expect(exportSpy.mock.calls[0][0][0]).toMatchObject({ jenis: "Putih Biru Ikhwan", ukuran: "S", jumlah: 1 });
  });
  it("menampilkan keadaan kosong ketika tidak ada pendaftar sesuai filter", () => {
    render(<UniformStatistics rows={[]} departments={departments} />);
    expect(screen.getByText("Belum ada rekap seragam pada filter ini")).toBeInTheDocument();
    expect(screen.getByText(/0 pendaftar dalam perhitungan/)).toBeInTheDocument();
  });
});
