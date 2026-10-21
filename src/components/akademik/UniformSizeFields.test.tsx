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
    expect(screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value)).toEqual(["Olah raga", "Putih Biru", "Coklat", "Gamis Ungu"]);
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });
  it("mengedit nama tanpa menghilangkan ukuran, dan perubahan tetap per stel", () => {
    const initial = defaultUniformSizes(null, "SMP", "L").map((item, index) => ({ ...item, ukuran: ["S", "M", "L", "XL"][index] }));
    render(<Fixture initial={initial} />);
    fireEvent.change(screen.getByLabelText("Nama jenis seragam stel 2"), { target: { value: "Putih Biru Khusus" } });
    expect(screen.getByLabelText("Ukuran stel 2")).toHaveValue("M");
    fireEvent.change(screen.getByLabelText("Ukuran stel 2"), { target: { value: "XXL" } });
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual([initial[0], { jenis: "Putih Biru Khusus", ukuran: "XXL" }, initial[2], initial[3]]);
    fireEvent.click(screen.getByRole("button", { name: "Kosongkan ukuran stel 2" }));
    expect(screen.getByLabelText("Nama jenis seragam stel 2")).toHaveValue("Putih Biru Khusus");
    expect(screen.getByLabelText("Ukuran stel 2")).toHaveValue("");
  });
  it("menonaktifkan isian TK sampai datanya tersedia", () => {
    render(<Fixture department="TK" />);
    expect(screen.getByText("Data jenis dan ukuran seragam TK belum tersedia.")).toBeInTheDocument();
    for (const input of [...screen.getAllByRole("combobox"), ...screen.getAllByRole("textbox")]) expect(input).toBeDisabled();
  });
});
