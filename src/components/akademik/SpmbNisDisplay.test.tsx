import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpmbNisDisplay } from "./SpmbNisDisplay";
import { DataTable } from "@/components/shared/DataTable";

afterEach(cleanup);
const internal = {
  nama: "Siswa Internal", _academicNis: "2538023125", nis: null,
  _academicDepartemenId: "sd", departemen_id: "smp",
  _academicLembagaKode: "SD", _lembagaKode: "SMP",
};
it("keeps the old SD NIS visible when an SMP NIS has not been assigned", () => {
  render(<SpmbNisDisplay row={internal} />);
  expect(screen.getByText("2538023125")).toBeInTheDocument();
  expect(screen.getByText("NIS asal (SD):")).toBeInTheDocument();
  expect(screen.getByText("NIS tujuan (SMP):")).toHaveTextContent("Belum dibuat");
});
it("shows both numbers when the destination NIS is available", () => {
  render(<SpmbNisDisplay row={{ ...internal, nis: "2703013" }} />);
  expect(screen.getByText("NIS asal (SD):")).toHaveTextContent("2538023125");
  expect(screen.getByText("NIS tujuan (SMP):")).toHaveTextContent("2703013");
});
it("shows Abdullah's saved destination NIS even when the current-school NIS is empty", () => {
  render(<SpmbNisDisplay row={{ ...internal, _academicNis: null, nis: "2703013" }} />);
  expect(screen.getByText("NIS asal (SD):")).toHaveTextContent("Belum ada");
  expect(screen.getByText("NIS tujuan (SMP):")).toHaveTextContent("2703013");
});
it("shows a single number for a student already in the destination school", () => {
  render(<SpmbNisDisplay row={{ ...internal, _academicDepartemenId: "smp", _academicNis: "2703013", nis: "2703013" }} />);
  expect(screen.getAllByText("2703013")).toHaveLength(1);
  expect(screen.queryByText("NIS asal (SD):")).not.toBeInTheDocument();
});
it.each(["2538023125", "2703013"])("finds the same applicant by either school NIS: %s", nis => {
  render(<DataTable
    columns={[{ key: "nama", label: "Nama", render: (value, row) => <span>{String(value)}<SpmbNisDisplay row={row} /></span> }]}
    searchKeys={["nama", "nis", "_academicNis"]}
    data={[{ ...internal, nis: "2703013" }, { nama: "Siswa Lain", nis: "2703099", _academicNis: "2538023999" }]}
  />);
  fireEvent.change(screen.getByPlaceholderText("Cari..."), { target: { value: nis } });
  expect(screen.getByText("Siswa Internal")).toBeInTheDocument();
  expect(screen.queryByText("Siswa Lain")).not.toBeInTheDocument();
});
