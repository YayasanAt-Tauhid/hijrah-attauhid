import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpmbInputStatus, SpmbInputTagihan } from "@/lib/spmbBillingStatus";
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
import { SpmbBillingInputStatus } from "./SpmbBillingInputStatus";

const bill = (id: string, status = "dibatalkan", periode: string | null = "2027-07-01"): SpmbInputTagihan =>
  ({ id, jenis_id: "j", nama: "SPP SMP", nominal: 1350000, status, periode });
const status = (over: Partial<SpmbInputStatus>): SpmbInputStatus =>
  ({ status: "perlu_diperiksa", nominal: 0, dibatalkan: 1, tagihan: [], dibatalkan_tagihan: [], ...over });
afterEach(cleanup);

describe("status input biaya SPMB: aksi terbitkan ulang", () => {
  it("menampilkan tombol hanya untuk tagihan dibatalkan (bukan dihapusbuku) dan mengirim tagihannya", () => {
    const onReissue = vi.fn();
    render(<SpmbBillingInputStatus onReissue={onReissue}
      value={status({ dibatalkan: 2, dibatalkan_tagihan: [bill("a"), bill("b", "dihapusbuku", "2027-08-01")] })} />);
    const buttons = screen.getAllByRole("button", { name: /Terbitkan ulang/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Juli 2027/);
    fireEvent.click(buttons[0]);
    expect(onReissue).toHaveBeenCalledWith(expect.objectContaining({ id: "a", status: "dibatalkan" }));
  });
  it("uang pangkal tanpa periode memakai label polos", () => {
    render(<SpmbBillingInputStatus onReissue={vi.fn()} value={status({ dibatalkan_tagihan: [bill("p", "dibatalkan", null)] })} />);
    expect(screen.getByRole("button", { name: "Terbitkan ulang" })).toBeInTheDocument();
  });
  it("tanpa handler tidak ada tombol", () => {
    render(<SpmbBillingInputStatus value={status({ dibatalkan_tagihan: [bill("a")] })} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("tidak ada tombol bila sudah ada tagihan aktif", () => {
    render(<SpmbBillingInputStatus onReissue={vi.fn()} value={status({ status: "sudah_diinput", nominal: 500000, tagihan: [bill("x", "terjadwal")], dibatalkan_tagihan: [bill("a")] })} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("tetap aman untuk data lama tanpa daftar dibatalkan", () => {
    const old = { status: "perlu_diperiksa", nominal: 0, dibatalkan: 1, tagihan: [] } as unknown as SpmbInputStatus;
    render(<SpmbBillingInputStatus onReissue={vi.fn()} value={old} />);
    expect(screen.getByText("Perlu diperiksa")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
