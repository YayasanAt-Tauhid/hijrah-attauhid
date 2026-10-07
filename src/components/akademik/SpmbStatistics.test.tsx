import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpmbStatistics } from "./SpmbStatistics";

afterEach(cleanup);
const rows = [
  { id: "a", status: "diterima", _spmbInternal: true, _academicStatus: "aktif", departemen_id: "smp" },
  { id: "b", status: "aktif", _spmbInternal: false, _academicStatus: "aktif", departemen_id: "smp" },
  { id: "c", status: "selesai", _spmbInternal: true, _spmbTanggalAktivasi: "2027-07-01", departemen_id: "smp" },
];
function setup(extra = {}) {
  const onOpenList = vi.fn();
  render(<SpmbStatistics rows={rows} departments={[{ id: "smp", nama: "SMP" }]} years={[]} waves={[]} scope={{ departemen: "all", tahun: "all", gelombang: "all" }} onScopeChange={vi.fn()} onOpenList={onOpenList} loading={false} {...extra} />);
  return onOpenList;
}
describe("SPMB statistics navigation", () => {
  it("opens accepted and activation lists with matching filters", () => {
    const open = setup();
    fireEvent.click(screen.getByRole("button", { name: "Diterima: 3. Buka daftar" }));
    expect(open).toHaveBeenLastCalledWith({ status: "diterima" });
    fireEvent.click(screen.getByRole("button", { name: "Belum diaktifkan: 1. Buka daftar" }));
    expect(open).toHaveBeenLastCalledWith({ status: "belum_aktif" });
    fireEvent.click(screen.getByRole("button", { name: "Sudah diaktifkan: 2. Buka daftar" }));
    expect(open).toHaveBeenLastCalledWith({ status: "selesai" });
  });
  it("allows keyboard use of a statistics card", () => {
    const open = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Diterima: 3. Buka daftar" }), { key: "Enter" });
    expect(open).toHaveBeenCalledWith({ status: "diterima" });
  });
  it("shows an error without displaying false zero counts", () => {
    setup({ rows: [], error: new Error("network unavailable") });
    expect(screen.getByRole("alert")).toHaveTextContent("Statistik tidak dapat dimuat");
    expect(screen.queryByRole("button", { name: /Diterima:/ })).not.toBeInTheDocument();
  });
});
