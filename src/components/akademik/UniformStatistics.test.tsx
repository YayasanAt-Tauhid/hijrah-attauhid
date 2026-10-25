
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { UniformStatistics } from "./UniformStatistics";
const exportSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/shared/ExportButton", () => ({
  ExportButton: ({ data, columns, filename }: { data: Record<string, unknown>[]; columns: {key:string;label:string}[]; filename:string }) =>
    <button onClick={() => exportSpy({data, columns})}>{filename === "total-seragam-spmb" ? "Ekspor total" : "Ekspor rincian"}</button>,
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
  it("menempatkan lembaga/jenis kelamin/jenis horizontal, ukuran vertikal, dan mengekspor hasil filter", () => {
    render(<UniformStatistics rows={rows} departments={departments} />);
    const detail = within(screen.getByRole("table", { name: "Rincian seragam per lembaga dan jenis kelamin" }));
    for (const size of ["S", "M", "L", "XL", "XXL", "3XL", "4XL", "ALL SIZE"]) {
      expect(detail.getByRole("rowheader", { name: size, exact: true })).toBeInTheDocument();
      expect(detail.queryByRole("columnheader", { name: size, exact: true })).not.toBeInTheDocument();
    }
    expect(detail.getByRole("columnheader", { name: "SMP", exact: true })).toHaveAttribute("colspan", "9");
    expect(detail.getByRole("columnheader", { name: "Ikhwan", exact: true })).toBeInTheDocument();
    expect(detail.getByRole("columnheader", { name: "Gamis Ungu Khusus", exact: true })).toBeInTheDocument();
    expect(screen.getByText("1 pendaftar TK belum dihitung karena data seragam TK belum tersedia.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jenis kelamin seragam"), { target: { value: "P" } });
    fireEvent.change(screen.getByLabelText("Kelulusan untuk rekap"), { target: { value: "lulus" } });
    expect(detail.getByRole("columnheader", { name: "Gamis Ungu Khusus" })).toBeInTheDocument();
    expect(detail.queryByRole("columnheader", { name: "Putih Biru Ikhwan" })).not.toBeInTheDocument();
    expect(detail.queryByRole("columnheader", { name: "Gamis Putri Cadangan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ekspor rincian" }));
    const saved = exportSpy.mock.calls[0][0];
    expect(saved.data).toEqual(expect.arrayContaining([expect.objectContaining({ ukuran: "XL", jumlah: 1 })]));
    expect(saved.columns.slice(1, -1).every((column: {label:string}) => column.label.includes("Akhwat"))).toBe(true);
  });
  it("pencarian menyaring kolom rincian dan total ekspornya tanpa mengubah rekap gabungan", () => {
    render(<UniformStatistics rows={rows.slice(0, 1)} departments={departments} />);
    fireEvent.change(screen.getByPlaceholderText("Cari lembaga, jenis kelamin, atau jenis seragam..."), { target: { value: "Putih Biru Ikhwan" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekspor rincian" }));
    const saved = exportSpy.mock.calls[0][0];
    expect(saved.columns.map((column: {label:string}) => column.label)).toEqual(["Ukuran", "SMP / Ikhwan / Putih Biru Ikhwan", "Total per ukuran"]);
    expect(saved.data.find((row: {ukuran:string}) => row.ukuran === "S")).toMatchObject({column_0:1,jumlah:1});
    expect(saved.data.at(-1)).toMatchObject({ukuran:"Total per jenis",column_0:1,jumlah:1});
    expect(screen.getByRole("table", { name: "Rekap total seragam" })).toBeInTheDocument();
  });
  it("menampilkan keadaan kosong dan total nol tanpa membuat pesanan palsu", () => {
    render(<UniformStatistics rows={[]} departments={departments} />);
    expect(screen.getAllByText("Belum ada rekap seragam pada filter ini")).toHaveLength(2);
    expect(screen.getByText(/0 pendaftar dalam perhitungan/)).toBeInTheDocument();
    const totalRow = within(screen.getByRole("table", { name: "Rekap total seragam" })).getByRole("row", {name:"Total per jenis 0"});
    expect(totalRow).toBeInTheDocument();
  });
  it("menampilkan total per ukuran di kanan dan total tiap jenis di bawah, serta mengikuti filter", () => {
    const sameType = [
      { departemen_id:"smp",jenis_kelamin:"L",_spmbStatusKelulusan:"lulus",_spmbDetail:{ukuran_seragam:[{jenis:"Olah raga",ukuran:"S"}]} },
      { departemen_id:"smp",jenis_kelamin:"P",_spmbStatusKelulusan:"lulus",_spmbDetail:{ukuran_seragam:[{jenis:"Olah raga",ukuran:"M"}]} },
    ];
    render(<UniformStatistics rows={sameType} departments={departments} />);
    const totals = within(screen.getByRole("table",{name:"Rekap total seragam"}));
    expect(totals.getByRole("row",{name:/^S /})).toHaveTextContent(/1$/);
    expect(totals.getByRole("row",{name:/^M /})).toHaveTextContent(/1$/);
    expect(totals.getByRole("row",{name:/^Total per jenis /})).toHaveTextContent(/2$/);
    fireEvent.change(screen.getByLabelText("Jenis kelamin seragam"),{target:{value:"P"}});
    expect(totals.getByRole("row",{name:/^Total per jenis /})).toHaveTextContent(/1$/);
    fireEvent.click(screen.getByRole("button",{name:"Ekspor total"}));
    expect(exportSpy.mock.calls[0][0].data.at(-1)).toMatchObject({ukuran:"Total per jenis",jumlah:1});
  });
});
