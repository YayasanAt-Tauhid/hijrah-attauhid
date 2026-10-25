
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SpmbFieldVerification } from "./SpmbFieldVerification";
afterEach(cleanup);
it("membedakan ceklis wajib dan opsional tanpa mengubah nilai tersimpan", () => {
  render(<>
    <SpmbFieldVerification fieldKey="nama" checked required onCheckedChange={vi.fn()} />
    <SpmbFieldVerification fieldKey="asal_sekolah" checked={false} label="Sudah diperiksa (opsional)" onCheckedChange={vi.fn()} />
  </>);
  expect(screen.getByRole("checkbox", { name: "Sudah diperiksa *" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sudah diperiksa (opsional)" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Sudah diperiksa (opsional) *" })).not.toBeInTheDocument();
});
