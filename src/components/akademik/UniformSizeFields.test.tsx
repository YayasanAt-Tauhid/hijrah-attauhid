import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UniformSizeFields } from "./UniformSizeFields";
import { defaultUniformSizes, type UniformSize } from "@/lib/ukuranSeragam";

afterEach(cleanup);
function Fixture({ department = "SMP", gender = "L", initial }: { department?: string; gender?: string; initial?: UniformSize[] }) {
  const [value, setValue] = useState(initial || defaultUniformSizes(null, department, gender));
  return <><UniformSizeFields department={department} gender={gender} value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}
describe("nama dan ukuran empat jenis seragam", () => {
  it("menampilkan empat nama sesuai akhwat SMP, tanpa dropdown jenis tambahan", () => {
    render(<Fixture gender="P" />);
    expect(screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value)).toEqual(["Olah raga", "Putih Biru", "Coklat", "Gamis Ungu", ""]);
    expect(screen.getAllByRole("combobox")).toHaveLength(5);
  });
  it("mengedit nama tanpa menghilangkan ukuran, dan perubahan tetap per stel", () => {
    const initial = defaultUniformSizes(null, "SMP", "L").map((item, index) => ({ ...item, ukuran: ["S", "M", "L", "XL", ""][index] }));
    render(<Fixture initial={initial} />);
    fireEvent.change(screen.getByLabelText("Nama jenis seragam stel 2"), { target: { value: "Putih Biru Khusus" } });
    expect(screen.getByLabelText("Ukuran stel 2")).toHaveValue("M");
    fireEvent.change(screen.getByLabelText("Ukuran stel 2"), { target: { value: "XXL" } });
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual([initial[0], { jenis: "Putih Biru Khusus", ukuran: "XXL" }, initial[2], initial[3], initial[4]]);
    fireEvent.click(screen.getByRole("button", { name: "Kosongkan ukuran stel 2" }));
    expect(screen.getByLabelText("Nama jenis seragam stel 2")).toHaveValue("Putih Biru Khusus");
    expect(screen.getByLabelText("Ukuran stel 2")).toHaveValue("");
  });
  it("membuka isian TK tanpa nama bawaan agar nama dan ukuran bisa diisi manual", () => {
    render(<Fixture department="TK" gender="P" />);
    expect(screen.queryByText("Data jenis dan ukuran seragam TK belum tersedia.")).not.toBeInTheDocument();
    expect(screen.getByText(/Nama seragam TK belum ditetapkan/)).toBeInTheDocument();
    for (const input of [...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox")]) expect(input).toBeEnabled();
    expect(screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value)).toEqual(["", "", "", "", ""]);
    fireEvent.change(screen.getByLabelText("Nama jenis seragam stel 5"), { target: { value: "Pramuka TK" } });
    expect(JSON.parse(screen.getByTestId("value").textContent!)[4]).toEqual({ jenis: "Pramuka TK", ukuran: "" });
    fireEvent.change(screen.getByLabelText("Nama jenis seragam stel 1"), { target: { value: "Batik TK" } });
    fireEvent.change(screen.getByLabelText("Ukuran stel 1"), { target: { value: "M" } });
    expect(JSON.parse(screen.getByTestId("value").textContent!)[0]).toEqual({ jenis: "Batik TK", ukuran: "M" });
  });
  it("tetap menonaktifkan isian untuk lembaga yang tidak dikenal atau jenis kelamin kosong", () => {
    const { unmount } = render(<Fixture department="" gender="P" />);
    for (const input of [...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox")]) expect(input).toBeDisabled();
    unmount();
    render(<Fixture department="TK" gender="" />);
    for (const input of [...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox")]) expect(input).toBeDisabled();
  });
});
