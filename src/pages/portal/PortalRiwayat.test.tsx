import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PortalRiwayat from "./PortalRiwayat";

const mocks = vi.hoisted(() => ({
  download: vi.fn().mockResolvedValue(undefined),
  exportProps: vi.fn(),
  rows: ["pending", "failed", "expired", "paid"].map(status => ({
    key: status, order_id: `ORDER-${status}`, tanggal: "2026-09-30T08:00:00Z",
    status, payment_type: "qris", total_amount: 450000, biaya_admin: 0,
    items: [{ id: status, nama_item: "SPP September", jumlah: 450000 }],
    receipt: { items: [{ id: status, jenisNama: "SPP September", jumlah: 450000, bulan: 0 }],
      tanggalBayar: "2026-09-30T08:00:00Z", nomorBukti: `ORDER-${status}`,
      siswa: { nama: "Anak Contoh", nis: "123" }, kelasNama: "9C", lembagaNama: "SMP", metode: "qris" },
  })),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "parent" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/server/payment", () => ({ syncMidtransPaymentStatus: vi.fn() }));
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
