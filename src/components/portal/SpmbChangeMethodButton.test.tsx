import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/pmbChangeMethod", () => ({ pmbChangePaymentMethod: mocks.change }));

import { SpmbChangeMethodButton } from "./SpmbChangeMethodButton";

function setup() {
  const onRedirect = vi.fn();
  render(<SpmbChangeMethodButton paymentToken="tok-1" onRedirect={onRedirect} />);
  return { onRedirect };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.change.mockResolvedValue({
    success: true,
    redirect_url: "https://app.midtrans.com/snap/v2/vtweb/baru",
    perubahan_tersisa: 2,
  });
});
afterEach(cleanup);

describe("SpmbChangeMethodButton", () => {
  it("meminta konfirmasi dulu dan menjelaskan nomor VA/QR lama akan mati", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Ganti Metode Pembayaran" }));
    expect(screen.getByText(/jangan transfer ke nomor atau kode lama/i)).toBeInTheDocument();
    expect(screen.getByText(/maksimal 3 kali/i)).toBeInTheDocument();
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it("membatalkan dialog tanpa memanggil server", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Ganti Metode Pembayaran" }));
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it("setelah konfirmasi memanggil server dengan token dan mengarahkan ke pembayaran baru", async () => {
    const { onRedirect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Ganti Metode Pembayaran" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, ganti metode" }));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith("https://app.midtrans.com/snap/v2/vtweb/baru"));
    expect(mocks.change).toHaveBeenCalledWith({ data: { payment_token: "tok-1" } });
  });

  it("menampilkan pesan error dan tidak mengarahkan bila server menolak", async () => {
    mocks.change.mockRejectedValue(new Error("Pembayaran sudah berhasil di Midtrans"));
    const { onRedirect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Ganti Metode Pembayaran" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, ganti metode" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Gagal mengganti metode pembayaran", {
        description: "Pembayaran sudah berhasil di Midtrans",
      }),
    );
    expect(onRedirect).not.toHaveBeenCalled();
  });
});
