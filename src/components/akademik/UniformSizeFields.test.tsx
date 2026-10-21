import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UniformSizeFields } from "./UniformSizeFields";
import { emptyUniformSizes, type UniformSize } from "@/lib/ukuranSeragam";

afterEach(cleanup);
function Fixture({ department = "SMP", gender = "L", initial = emptyUniformSizes() }: { department?: string; gender?: string; initial?: UniformSize[] }) {
  const [value, setValue] = useState(initial);
  return <><UniformSizeFields department={department} gender={gender} value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}
describe("empat isian seragam", () => {
  it("mengubah ukuran satu stel tanpa mengubah stel lainnya lalu memuat nilai tersimpan", () => {
    const initial = [{ jenis: "PRAMUKA", ukuran: "S" }, { jenis: "PUTIH BIRU", ukuran: "M" }, { jenis: "PRAMUKA", ukuran: "L" }, { jenis: "PUTIH BIRU", ukuran: "XL" }];
    render(<Fixture initial={initial} />);
    expect(screen.getByLabelText("Ukuran stel 4")).toHaveValue("XL");
    fireEvent.change(screen.getByLabelText("Ukuran stel 2"), { target: { value: "XXL" } });
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual([initial[0], { jenis: "PUTIH BIRU", ukuran: "XXL" }, initial[2], initial[3]]);
    fireEvent.click(screen.getByRole("button", { name: "Kosongkan stel 2" }));
    expect(screen.getByLabelText("Jenis seragam stel 2")).toHaveValue("");
    expect(screen.getByLabelText("Ukuran stel 2")).toHaveValue("");
  });
  it("mereset ukuran saat ganti jenis dan mengisi otomatis ukuran tunggal", () => {
    render(<Fixture department="SD" />);
    fireEvent.change(screen.getByLabelText("Jenis seragam stel 1"), { target: { value: "SETELAN OLAH RAGA" } });
    expect(screen.getByLabelText("Ukuran stel 1")).toHaveValue("ALL SIZE");
    fireEvent.change(screen.getByLabelText("Jenis seragam stel 1"), { target: { value: "SETELAN SERAGAM BIRU" } });
    expect(screen.getByLabelText("Ukuran stel 1")).toHaveValue("");
  });
  it("menampilkan keterangan TK dan menonaktifkan pilihan tanpa katalog", () => {
    render(<Fixture department="TK" />);
    expect(screen.getByText("Data jenis dan ukuran seragam TK belum tersedia.")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(8);
    for (const select of screen.getAllByRole("combobox")) expect(select).toBeDisabled();
  });
});
