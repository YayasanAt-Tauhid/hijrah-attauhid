import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ajukan: vi.fn(), close: vi.fn(), ok: vi.fn(), fail: vi.fn() }));
vi.mock("@/server/pembatalanPembayaran", () => ({ ajukanPembatalanPembayaran: m.ajukan }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock("sonner", () => ({ toast: { success: m.ok, error: m.fail } }));
import { DialogAjukanPembatalan } from "./DialogAjukanPembatalan";

const target = { id: "pay-1", label: "SPP (Juli 2026)", jumlah: 450000, tanggal: "2026-11-04" };

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DialogAjukanPembatalan target={target} onClose={m.close} />
    </QueryClientProvider>,
  );
}
const submit = () => screen.getByRole("button", { name: "Kirim pengajuan" });
const type = (value: string) => fireEvent.change(screen.getByLabelText("Alasan pembatalan *"), { target: { value } });

beforeEach(() => { vi.clearAllMocks(); m.ajukan.mockResolvedValue({ id: "pengajuan-1" }); });
afterEach(cleanup);

describe("DialogAjukanPembatalan", () => {
  it("menjelaskan bahwa pembayaran tidak berubah sampai disetujui dan menampilkan ringkasan pembayaran", () => {
    mount();
    expect(screen.getByText(/belum dibatalkan/i)).toBeInTheDocument();
    expect(screen.getByText("SPP (Juli 2026)")).toBeInTheDocument();
    expect(screen.getByText("Rp 450000")).toBeInTheDocument();
  });

  it("tombol kirim nonaktif sampai alasan minimal 5 karakter", () => {
    mount();
    expect(submit()).toBeDisabled();
    type("abc");
    expect(submit()).toBeDisabled();
    type("Salah input nominal");
    expect(submit()).toBeEnabled();
  });

  it("mengirim pengajuan dengan alasan yang dipangkas lalu menutup dialog", async () => {
    mount();
    type("  Salah input nominal  ");
    fireEvent.click(submit());
    await waitFor(() => expect(m.ajukan).toHaveBeenCalledWith({ data: { pembayaran_id: "pay-1", alasan: "Salah input nominal" } }));
    await waitFor(() => expect(m.close).toHaveBeenCalled());
    expect(m.ok).toHaveBeenCalledWith("Pengajuan pembatalan terkirim", expect.objectContaining({ description: expect.stringContaining("persetujuan") }));
  });

  it("menampilkan galat dan tetap membuka dialog bila pengajuan gagal", async () => {
    m.ajukan.mockRejectedValue(new Error("Pembayaran ini sudah memiliki pengajuan pembatalan yang menunggu keputusan"));
    mount();
    type("Salah input nominal");
    fireEvent.click(submit());
    await waitFor(() => expect(m.fail).toHaveBeenCalledWith("Pembayaran ini sudah memiliki pengajuan pembatalan yang menunggu keputusan"));
    expect(m.close).not.toHaveBeenCalled();
  });
});
