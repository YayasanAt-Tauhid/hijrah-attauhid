import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  role: "admin" as string,
  list: vi.fn(),
  update: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role, isLoading: false }) }));
vi.mock("@/server/rolePermissions", () => ({ listRolePermissions: mocks.list, updateRolePermissions: mocks.update }));
vi.mock("@/pages/Unauthorized", () => ({ default: () => <p>Akses Ditolak</p> }));

import HakAksesPeran from "./HakAksesPeran";

const LISTING = {
  roles: {
    keuangan: ["keuangan.pembayaran", "keuangan.laporan"],
    kasir: ["keuangan.pembayaran", "keuangan.rekap_kasir", "keuangan.pembatalan.ajukan"],
    bendahara: ["keuangan.akses_data", "keuangan.pembayaran"],
    sekretaris_yayasan: [],
  },
  log: [{ role: "kasir", granted: ["keuangan.pembatalan.ajukan"], revoked: [], changed_at: "2026-11-04T06:00:00Z" }],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><HakAksesPeran /></QueryClientProvider>);
}
const cell = (permissionLabel: string, roleLabel: string) =>
  screen.getByRole("checkbox", { name: `${permissionLabel} untuk ${roleLabel}` });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.list.mockResolvedValue(LISTING);
  mocks.update.mockResolvedValue({ success: true, granted: [], revoked: [] });
});
afterEach(cleanup);

describe("HakAksesPeran", () => {
  it("menampilkan matriks sesuai izin tersimpan", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Hak Akses Peran" })).toBeInTheDocument();
    await waitFor(() => expect(cell("Pembayaran siswa", "Kasir")).toBeChecked());
    expect(cell("Pembayaran siswa", "Sekretaris")).not.toBeChecked();
    expect(cell("Laporan keuangan", "Keuangan")).toBeChecked();
    expect(cell("Laporan keuangan", "Kasir")).not.toBeChecked();
  });

  it("menolak non-admin tanpa memuat data", () => {
    mocks.role = "kasir";
    setup();
    expect(screen.getByText("Akses Ditolak")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("menyimpan hanya peran yang berubah dengan daftar izin barunya", async () => {
    setup();
    await waitFor(() => expect(cell("Laporan keuangan", "Bendahara")).not.toBeChecked());
    const save = screen.getByRole("button", { name: "Simpan perubahan" });
    expect(save).toBeDisabled();
    fireEvent.click(cell("Laporan keuangan", "Bendahara"));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const payload = mocks.update.mock.calls[0][0].data;
    expect(payload.role).toBe("bendahara");
    expect(payload.permissions).toEqual(expect.arrayContaining(["keuangan.pembayaran", "keuangan.laporan"]));
    expect(payload.permissions).not.toContain("keuangan.akses_data");
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it("tombol Bawaan mengembalikan satu peran ke isian awal", async () => {
    setup();
    await waitFor(() => expect(cell("Pembayaran siswa", "Sekretaris")).not.toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Bawaan Sekretaris" }));
    expect(cell("Pembayaran siswa", "Sekretaris")).toBeChecked();
    expect(cell("Menyetujui pembatalan", "Sekretaris")).toBeChecked();
    expect(cell("Membatalkan langsung", "Sekretaris")).not.toBeChecked();
  });

  it("menampilkan galat bila penyimpanan gagal", async () => {
    mocks.update.mockRejectedValue(new Error("Akses ditolak"));
    setup();
    await waitFor(() => expect(cell("Laporan keuangan", "Kasir")).not.toBeChecked());
    fireEvent.click(cell("Laporan keuangan", "Kasir"));
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Gagal menyimpan hak akses", { description: "Akses ditolak" }));
  });
});
