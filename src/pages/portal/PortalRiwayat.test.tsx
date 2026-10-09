import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PortalRiwayat from "./PortalRiwayat";

const mocks = vi.hoisted(() => ({
  download: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue({ success: true, snap_token: "EXISTING-SNAP-TOKEN", order_id: "ORDER-pending" }),
  cancel: vi.fn().mockResolvedValue({ success: true, order_id: "ORDER-pending" }),
  loadMidtrans: vi.fn().mockResolvedValue(undefined),
  exportProps: vi.fn(),
  rows: ["pending", "failed", "expired", "paid"].map(status => ({
    key: status, order_id: `ORDER-${status}`, tanggal: "2026-09-30T08:00:00Z",
    status, payment_type: "qris", total_amount: 450000, biaya_admin: 0,
    expired_at: "2099-12-31T08:00:00Z", gateway_closed_at: null, has_snap_token: true,
    items: [{ id: status, nama_item: "SPP September", jumlah: 450000 }],
    receipt: { items: [{ id: status, jenisNama: "SPP September", jumlah: 450000, bulan: 0 }],
      tanggalBayar: "2026-09-30T08:00:00Z", nomorBukti: `ORDER-${status}`,
      siswa: { nama: "Anak Contoh", nis: "123" }, kelasNama: "9C", lembagaNama: "SMP", metode: "qris" },
  })),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/server/payment", () => ({ syncMidtransPaymentStatus: vi.fn(), resumePendingMidtransPayment: mocks.resume, cancelPendingMidtransPayment: mocks.cancel }));
vi.mock("@/hooks/useMidtrans", () => ({ useMidtrans: () => ({ loadMidtrans: mocks.loadMidtrans }) }));
vi.mock("@/lib/router-compat", () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "portal-anak-ids" ? ["student"] : mocks.rows, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/receiptDownload", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/receiptDownload")>(),
  downloadReceiptPdf: mocks.download,
}));
vi.mock("@/components/shared/PrintKuitansiGabungan", () => ({
  PrintKuitansiGabungan: (props: { onExportReady: (el: HTMLElement) => void }) => {
    mocks.exportProps(props);
    useEffect(() => { props.onExportReady(document.createElement("div")); }, [props.onExportReady]);
    return null;
  },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Portal receipt eligibility", () => {
  it.each(["pending", "failed", "expired"])("does not offer a receipt for a %s payment", status => {
    render(<PortalRiwayat />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`ORDER-${status}`) }));
    expect(screen.queryByRole("button", { name: "Download kwitansi" })).not.toBeInTheDocument();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("reopens the same pending Snap token and order id instead of creating a new payment", async () => {
    const pay = vi.fn();
    Object.defineProperty(window, "snap", { configurable: true, value: { pay } });
    render(<PortalRiwayat />);
    fireEvent.click(screen.getByRole("button", { name: /ORDER-pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan Pembayaran" }));
    await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith({ data: { order_id: "ORDER-pending" } }));
    await waitFor(() => expect(pay).toHaveBeenCalledWith("EXISTING-SNAP-TOKEN", expect.any(Object)));
    delete (window as any).snap;
  });

  it("requires explicit confirmation before calling the server-side cancellation", async () => {
    render(<PortalRiwayat />);
    fireEvent.click(screen.getByRole("button", { name: /ORDER-pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Batalkan Pembayaran" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ya, Batalkan Pembayaran" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ data: { order_id: "ORDER-pending" } }));
  });

  it("downloads a paid transaction with the shared cashier receipt and no print popup", async () => {
    render(<PortalRiwayat />);
    const open = vi.spyOn(window, "open");
    fireEvent.click(screen.getByRole("button", { name: /ORDER-paid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Download kwitansi" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.any(HTMLElement), "ORDER-paid"));
    expect(mocks.exportProps).toHaveBeenCalledWith(expect.objectContaining({
      exportMode: true, nomorBukti: "ORDER-paid", siswa: { nama: "Anak Contoh", nis: "123" },
      items: [{ id: "paid", jenisNama: "SPP September", jumlah: 450000, bulan: 0 }],
    }));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
