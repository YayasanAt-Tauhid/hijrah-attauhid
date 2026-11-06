import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PengajuanPembatalan } from "@/server/pembatalanPembayaran";

const m = vi.hoisted(() => ({
  role: "bendahara" as string | null,
  allowed: new Set<string>(["keuangan.pembatalan.setujui", "keuangan.pembatalan.ajukan"]),
  list: vi.fn(), putuskan: vi.fn(), batalkan: vi.fn(), ok: vi.fn(), fail: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: m.role, permissionsLoading: false, can: (k: string) => m.role === "admin" || m.allowed.has(k) }),
}));
vi.mock("@/server/pembatalanPembayaran", () => ({
  listPengajuanPembatalan: m.list, putuskanPengajuanPembatalan: m.putuskan, batalkanPengajuanPembatalan: m.batalkan,
}));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock("sonner", () => ({ toast: { success: m.ok, error: m.fail } }));
vi.mock("@/pages/Unauthorized", () => ({ default: () => <p>Akses Ditolak</p> }));
import PersetujuanPembatalan from "./PersetujuanPembatalan";

const item = (over: Partial<PengajuanPembatalan> = {}): PengajuanPembatalan => ({
  id: "p-1", pembayaran_id: "pay-1",
  snapshot: { siswa_nama: "Aulia Izzatunnisa", siswa_nis: "123", jenis_nama: "SPP", jumlah: 450000, tanggal_bayar: "2026-11-04", nomor_kuitansi: "KWT-1" },
  alasan: "Salah input nominal", status: "menunggu", diajukan_oleh: "kasir-1", diajukan_nama: "Siti Kasir",
  diajukan_at: "2026-11-04T06:00:00Z", diputuskan_oleh: null, diputuskan_nama: null, diputuskan_at: null,
  catatan_keputusan: null, tanggal_pembatalan: null, milik_sendiri: false, dapat_diputuskan: true, ...over,
});

function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PersetujuanPembatalan /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role = "bendahara";
  m.allowed = new Set(["keuangan.pembatalan.setujui", "keuangan.pembatalan.ajukan"]);
  m.list.mockResolvedValue({ items: [item()], canDecide: true });
  m.putuskan.mockResolvedValue({ success: true, jurnal_pembalik_id: "jr-1" });
  m.batalkan.mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe("PersetujuanPembatalan", () => {
  it("menampilkan pengajuan menunggu lengkap dengan siswa, jumlah, alasan, dan pengaju", async () => {
    mount();
    expect(await screen.findByText("Aulia Izzatunnisa")).toBeInTheDocument();
    expect(screen.getByText("Rp 450000")).toBeInTheDocument();
    expect(screen.getByText("Salah input nominal")).toBeInTheDocument();
    expect(screen.getByText(/Siti Kasir/)).toBeInTheDocument();
    expect(m.list).toHaveBeenCalledWith({ data: { status: "menunggu" } });
  });

  it("menyetujui setelah konfirmasi dan menampilkan hasil", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/jurnal pembalik/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Setujui & batalkan pembayaran" }));
    await waitFor(() => expect(m.putuskan).toHaveBeenCalledTimes(1));
    expect(m.putuskan.mock.calls[0][0].data).toMatchObject({ id: "p-1", keputusan: "setujui" });
    await waitFor(() => expect(m.ok).toHaveBeenCalled());
  });

  it("menolak wajib beralasan minimal 5 karakter", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Tolak" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Tolak pengajuan" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Alasan penolakan *"), { target: { value: "Bukti pembayaran valid" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(m.putuskan).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "p-1", keputusan: "tolak", catatan: "Bukti pembayaran valid" }) }));
  });

  it("pengajuan milik sendiri tidak punya tombol setujui/tolak, hanya batalkan pengajuan", async () => {
    m.list.mockResolvedValue({ items: [item({ milik_sendiri: true, dapat_diputuskan: false })], canDecide: true });
    mount();
    await screen.findByText("Aulia Izzatunnisa");
    expect(screen.queryByRole("button", { name: "Setujui" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tolak" })).not.toBeInTheDocument();
    expect(screen.getByText(/tidak dapat menyetujui pengajuan sendiri/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Batalkan pengajuan" }));
    await waitFor(() => expect(m.batalkan).toHaveBeenCalledWith({ data: { id: "p-1" } }));
  });

  it("kasir hanya melihat pengajuannya dan tidak ada tombol keputusan", async () => {
    m.role = "kasir";
    m.allowed = new Set(["keuangan.pembatalan.ajukan"]);
    m.list.mockResolvedValue({ items: [item({ milik_sendiri: true, dapat_diputuskan: false })], canDecide: false });
    mount();
    await screen.findByText("Aulia Izzatunnisa");
    expect(screen.getByRole("heading", { name: "Pengajuan Pembatalan Saya" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setujui" })).not.toBeInTheDocument();
  });

  it("filter Semua memuat riwayat termasuk yang sudah diputuskan", async () => {
    m.list.mockResolvedValue({ items: [item({ status: "ditolak", dapat_diputuskan: false, diputuskan_nama: "Bu Bendahara", catatan_keputusan: "Bukti valid" })], canDecide: true });
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "Semua" }));
    await waitFor(() => expect(m.list).toHaveBeenCalledWith({ data: { status: "semua" } }));
    expect(await screen.findByText("Ditolak")).toBeInTheDocument();
    expect(screen.getByText(/Bukti valid/)).toBeInTheDocument();
  });

  it("menampilkan galat dari server saat persetujuan gagal (mis. periode ditutup)", async () => {
    m.putuskan.mockRejectedValue(new Error("Periode 2026-11-04 sudah ditutup"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Setujui & batalkan pembayaran" }));
    await waitFor(() => expect(m.fail).toHaveBeenCalledWith("Periode 2026-11-04 sudah ditutup"));
  });

  it("peran tanpa izin apa pun ditolak tanpa memuat data", () => {
    m.role = "guru";
    m.allowed = new Set();
    mount();
    expect(screen.getByText("Akses Ditolak")).toBeInTheDocument();
    expect(m.list).not.toHaveBeenCalled();
  });

  it("keadaan kosong", async () => {
    m.list.mockResolvedValue({ items: [], canDecide: true });
    mount();
    expect(await screen.findByText("Tidak ada pengajuan yang menunggu.")).toBeInTheDocument();
  });
});
