import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SpmbStatistics } from "./SpmbStatistics";

afterEach(cleanup);
const rows = [
  { id: "a", status: "diterima", _spmbStatusKelulusan: "lulus", departemen_id: "smp" },
  { id: "b", status: "aktif", _spmbStatusKelulusan: "lulus", departemen_id: "smp" },
  { id: "c", status: "calon", _spmbStatusKelulusan: "tidak_lulus", departemen_id: "sd" },
  { id: "d", status: "calon", _spmbStatusKelulusan: null, departemen_id: "smp" },
];
function setup(extra = {}) {
  const onOpenList = vi.fn();
  render(<SpmbStatistics rows={rows} departments={[{ id: "smp", nama: "SMP" }, { id: "sd", nama: "SD" }]} years={[]} waves={[]} scope={{ departemen: "all", tahun: "all", gelombang: "all" }} onScopeChange={vi.fn()} onOpenList={onOpenList} loading={false} {...extra} />);
  return onOpenList;
}
describe("SPMB statistics graduation", () => {
  it("opens graduation lists and removes acceptance/activation cards and columns", () => {
    const open = setup();
    for (const [label, count, kelulusan] of [["Lulus tes", 2, "lulus"], ["Tidak lulus tes", 1, "tidak_lulus"], ["Belum ditentukan", 1, "belum"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label + ": " + count + ". Buka daftar" }));
      expect(open).toHaveBeenLastCalledWith({ kelulusan });
    }
    for (const label of ["Diterima", "Belum diaktifkan", "Sudah diaktifkan"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    const smp = screen.getAllByRole("row").find((row) => within(row).queryByText("SMP"))!;
    expect(within(smp).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["SMP", "3", "2", "0", "1"]);
  });
  it("allows keyboard navigation of graduation cards", () => {
    const open = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Lulus tes: 2. Buka daftar" }), { key: "Enter" });
    expect(open).toHaveBeenCalledWith({ kelulusan: "lulus" });
  });
  it("uses only scoped rows and explicit graduation results", () => {
    setup({ rows: [{ id: "accepted-without-result", status: "aktif", departemen_id: "sd" }] });
    expect(screen.getByRole("button", { name: "Lulus tes: 0. Buka daftar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Belum ditentukan: 1. Buka daftar" })).toBeInTheDocument();
  });
  it("shows errors and loading without false zero counts", () => {
    setup({ rows: [], error: new Error("network unavailable") });
    expect(screen.getByRole("alert")).toHaveTextContent("Statistik tidak dapat dimuat");
    expect(screen.queryByRole("button", { name: /Lulus tes:/ })).not.toBeInTheDocument();
  });
});
