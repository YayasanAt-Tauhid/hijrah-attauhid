import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SearchableSelect } from "./SearchableSelect";

const options = [
  {
    value: "tk",
    label: (
      <>
        UANG PANGKAL <strong>TK</strong>
      </>
    ),
  },
  { value: "sd", label: "UANG PANGKAL SD" },
  { value: "legacy", label: "SALDO UANG PANGKAL LAMA TK" },
  { value: "disabled", label: "SPP TK terkunci", disabled: true },
];

function Example() {
  const [value, setValue] = useState("sd");
  return (
    <>
      <SearchableSelect
        value={value}
        onValueChange={setValue}
        options={options}
        placeholder="Jenis tagihan"
        groupPaymentTypes
      />
      <output aria-label="Pilihan tersimpan">{value}</output>
    </>
  );
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("SearchableSelect", () => {
  it("filters labels with multiple words and selects by keyboard", async () => {
    render(<Example />);
    const trigger = screen.getByRole("combobox", { name: "Jenis tagihan" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = await screen.findByPlaceholderText("Cari pilihan...");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "pangkal tk" } });
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "UANG PANGKAL SD" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("option", { name: "UANG PANGKAL TK" }),
    ).toBeVisible();
    fireEvent.keyDown(search, { key: "ArrowDown", keyCode: 40 });
    fireEvent.keyDown(search, { key: "ArrowUp", keyCode: 38 });
    fireEvent.keyDown(search, { key: "Enter", keyCode: 13 });
    await waitFor(() =>
      expect(screen.getByLabelText("Pilihan tersimpan")).toHaveTextContent(
        "tk",
      ),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows an empty result and preserves the selection when dismissed", async () => {
    render(<Example />);
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis tagihan" }));
    const search = await screen.findByPlaceholderText("Cari pilihan...");
    fireEvent.change(search, { target: { value: "tidak ada jenis ini" } });
    expect(await screen.findByText("Pilihan tidak ditemukan.")).toBeVisible();
    fireEvent.keyDown(search, { key: "Escape", keyCode: 27 });
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText("Cari pilihan..."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Pilihan tersimpan")).toHaveTextContent("sd");
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis tagihan" }));
    expect(await screen.findByPlaceholderText("Cari pilihan...")).toHaveValue(
      "",
    );
  });

  it("groups historical types and prevents disabled options from being selected", async () => {
    render(<Example />);
    fireEvent.click(screen.getByRole("combobox", { name: "Jenis tagihan" }));
    expect(await screen.findByText("Tagihan historis")).toBeVisible();
    expect(screen.getByText("Tagihan operasional")).toBeVisible();
    const disabled = screen.getByRole("option", { name: "SPP TK terkunci" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(disabled);
    expect(screen.getByLabelText("Pilihan tersimpan")).toHaveTextContent("sd");
  });
});
