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

// Pemeriksaan kesiapan (RPC spmb_readiness_list) bisa lambat, terutama untuk Admin TU.
// Angka statistik tidak boleh ikut menunggunya; hanya kartu "Calon belum lengkap" yang bergantung padanya.
describe("SPMB statistics readiness is independent from the counts", () => {
  it("shows every count while readiness is still loading, without a page-level spinner", () => {
    setup({ readinessLoading: true });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Total Pendaftar: 4. Buka daftar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lulus tes: 2. Buka daftar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Belum tes: 0. Buka daftar" })).toBeInTheDocument();
  });

  it("does not show a guessed number for incomplete candidates while readiness is loading", () => {
    setup({ readinessLoading: true });
    expect(screen.getByText("Calon belum lengkap")).toBeInTheDocument();
    expect(screen.getByText("Memeriksa…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Calon belum lengkap/ })).not.toBeInTheDocument();
  });

  it("keeps the counts and marks only the readiness card unavailable when readiness fails", () => {
    setup({ readinessError: new Error("timeout") });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lulus tes: 2. Buka daftar" })).toBeInTheDocument();
    expect(screen.getByText("Tidak tersedia")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Calon belum lengkap/ })).not.toBeInTheDocument();
  });

  it("still blocks the whole page while the main list is loading", () => {
    setup({ rows: [], loading: true });
    expect(screen.getByRole("status")).toHaveTextContent("Memuat statistik SPMB");
    expect(screen.queryByRole("button", { name: /Lulus tes:/ })).not.toBeInTheDocument();
  });

  it("counts incomplete candidates from readiness once it is available", () => {
    const open = setup();
    fireEvent.click(screen.getByRole("button", { name: "Calon belum lengkap: 2. Buka daftar" }));
    expect(open).toHaveBeenLastCalledWith({ status: "calon", kesiapan: "belum" });
  });
});
