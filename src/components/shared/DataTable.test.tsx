import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataTable } from "./DataTable";

afterEach(cleanup);
describe("DataTable compact columns", () => {
  it("still finds an applicant by NIS when NIS is nested under the name", () => {
    render(<DataTable columns={[{ key: "nama", label: "Nama" }]} searchKeys={["nama", "nis"]} data={[{ nama: "Alya", nis: "27-01-008" }, { nama: "Budi", nis: "27-02-001" }]} />);
    fireEvent.change(screen.getByPlaceholderText("Cari..."), { target: { value: "27-01-008" } });
    expect(screen.getByText("Alya")).toBeInTheDocument();
    expect(screen.queryByText("Budi")).not.toBeInTheDocument();
  });
  it("keeps rows visible when a filter reduces the number of pages", () => {
    const columns = [{ key: "nama", label: "Nama" }];
    const { container, rerender } = render(<DataTable columns={columns} data={Array.from({ length: 30 }, (_, i) => ({ nama: `Siswa ${i + 1}` }))} pageSize={10} />);
    const paginationButtons = container.querySelectorAll("button");
    fireEvent.click(paginationButtons[paginationButtons.length - 1]);
    expect(screen.getByText("Siswa 30")).toBeInTheDocument();
    rerender(<DataTable columns={columns} data={[{ nama: "Siswa 1" }]} pageSize={10} />);
    expect(screen.getByText("Siswa 1")).toBeInTheDocument();
    expect(screen.getByText("Hal 1/1")).toBeInTheDocument();
  });
});
