import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculatePaymentProgress } from "@/lib/spmbPaymentMonitor";
import type { PaymentMonitorRow } from "@/server/spmbPaymentMonitor";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), navigate: vi.fn(), role: "admin", isLoading: false, params: new URLSearchParams() }));
vi.mock("@/server/spmbPaymentMonitor", () => ({ getSpmbPaymentMonitor: mocks.load, saveSpmbMonitorEvent: mocks.save }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate, useSearchParams: () => [mocks.params] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role, isLoading: mocks.isLoading, user: { id: "test-user" } }) }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n.toLocaleString("id-ID")}` }));
import MonitoringPembayaranSPMB, { PaymentMonitorContent } from "./MonitoringPembayaranSPMB";
function row(id: string, total: number, paid: number, billIds = ["bill"], needsVerification = false): PaymentMonitorRow {
  return { id, siswa_id: id, nama: id, nis: null, status_siswa: "calon", registration: {} as PaymentMonitorRow["registration"],
    departemen_id: "tk", departemen_nama: "TK", tahun_ajaran_id: "2027", tahun_ajaran_nama: "2027/2028",
    status_asrama: null, internal: false, tanggal_lulus: "2026-10-01", skema: null, events: [], unmatchedBills: needsVerification ? 1 : 0,
    nama_ayah: null, nama_ibu: null, kelas_tujuan: null, kelas_asal: null,
    progress: calculatePaymentProgress({ total, billIds, payments: paid ? [{ id: "p", tagihan_id: "bill", jumlah: paid, tanggal_bayar: "2026-10-02" }] : [],
      passedAt: "2026-10-01", scheme: null, today: "2026-10-10", needsVerification }) };
}
const fixtures = [row("Belum Skema", 4200000, 0), row("Sebagian Skema", 4200000, 1000000), row("Lunas Siswa", 4200000, 4200000),
  row("Tanpa Tagihan", 0, 0, []), row("Verifikasi Siswa", 0, 0, [], true)];
function mount(role = "admin", guard = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{guard ? <MonitoringPembayaranSPMB /> : <PaymentMonitorContent role={role} />}</QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); mocks.role = "admin"; mocks.isLoading = false; mocks.params = new URLSearchParams(); mocks.load.mockResolvedValue({ items: fixtures, historyAvailable: true }); });
describe("monitoring payment workflow", () => {
  it("counts unpaid and partial payments without a scheme; excludes missing or unverified bills", async () => {
    mount();
    const summary = screen.getByRole("region", { name: "Ringkasan pembayaran" });
    await within(summary).findByRole("button", { name: "Belum bayar 1" });
    expect(within(summary).getByRole("button", { name: "Dibayar sebagian 1" })).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Lunas 1" })).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole("button", { name: "Belum bayar 1" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 dari 5");
    expect(screen.queryByText("Lunas Siswa")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
    expect(screen.getByRole("status")).toHaveTextContent("5 dari 5");
  });
  it("opens scheme entry directly without saving and protects cashier permissions", async () => {
    mount();
    const buttons = await screen.findAllByRole("button", { name: "Tentukan skema" });
    fireEvent.click(buttons[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Tindakan monitoring" })).toHaveTextContent("Catat / koreksi skema");
    expect(within(dialog).getByRole("combobox", { name: "Skema pembayaran" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Simpan skema" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("cashiers can read details but cannot set a scheme or create bills", async () => {
    mount("kasir");
    await screen.findAllByText("Belum Skema");
    expect(screen.queryByRole("button", { name: "Tentukan skema" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buat tagihan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Detail dan catatan" })[0]);
    expect(within(screen.getByRole("dialog")).queryByRole("combobox", { name: "Skema pembayaran" })).not.toBeInTheDocument();
  });
  it("Admin TU can open the page, read details and history, but sees no write or cashier actions", async () => {
    mocks.role = "admin_tu";
    mount("admin_tu", true);
    await screen.findAllByText("Belum Skema");
    expect(screen.getByText(/Akses baca sesuai lembaga tujuan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentukan skema" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buat tagihan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Detail dan catatan" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Riwayat monitoring")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Tindakan monitoring" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Simpan catatan" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Atur tagihan" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Buka kasir" })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("waits for role resolution before loading monitoring", () => {
    mocks.role = "admin_tu"; mocks.isLoading = true;
    mount("admin_tu", true);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.queryByText("Monitoring Pembayaran SPMB")).not.toBeInTheDocument();
  });
  it("does not imply zero bills are free, prompt paid students for a scheme, or show boarding warnings for TK", async () => {
    mount();
    await screen.findAllByText("Tanpa Tagihan");
    const missing = screen.getByRole("row", { name: /Tanpa Tagihan/ });
    expect(missing).not.toHaveTextContent("Rp 0");
    const paid = screen.getByRole("row", { name: /Lunas Siswa/ });
    expect(paid).toHaveTextContent("Pembayaran selesai");
    expect(within(paid).queryByRole("button", { name: "Tentukan skema" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Asrama belum diisi/)).not.toBeInTheDocument();
  });
  it("paginates the same students in both layouts and resets after searching", async () => {
    mocks.load.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => row(`Siswa ${i + 1}`, 4200000, 0)), historyAvailable: true });
    mount();
    await screen.findAllByText("Siswa 1");
    expect(screen.getAllByText("Siswa 20")).toHaveLength(2);
    expect(screen.queryByText("Siswa 21")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Halaman berikutnya" }));
    expect(screen.getAllByText("Siswa 21")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Nama / NIS / orang tua / kelas"), { target: { value: "Siswa 1" } });
    expect(screen.getAllByText("Siswa 1")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Halaman sebelumnya" })).toBeDisabled();
  });
});
describe("identitas pembeda untuk siswa senama", () => {
  const SEARCH_LABEL = "Nama / NIS / orang tua / kelas";
  const namesakes = (): PaymentMonitorRow[] => [
    { ...row("Ahmad Fauzi", 4200000, 0), id: "d1", siswa_id: "s1", nis: "1001", nama_ayah: "Abdullah", nama_ibu: "Aisyah", kelas_tujuan: "Tingkat 7 · 7A" },
    { ...row("Ahmad Fauzi", 4200000, 0), id: "d2", siswa_id: "s2", nis: null, nama_ayah: "Budi", nama_ibu: null, internal: true, kelas_tujuan: null, kelas_asal: "Tingkat 6 · 6B" },
    row("Siti Aminah", 4200000, 0), row("Rafi", 4200000, 0), row("Dina", 4200000, 0),
  ];
  it("shows parents, NIS and class so students with the same name can be told apart", async () => {
    mocks.load.mockResolvedValue({ items: namesakes(), historyAvailable: true });
    mount();
    await screen.findAllByText("Ayah: Abdullah · Ibu: Aisyah");
    expect(screen.getAllByText("Ayah: Budi · Ibu: —")).toHaveLength(2);
    expect(screen.getAllByText("NIS: 1001")).toHaveLength(2);
    expect(screen.getAllByText("NIS: belum ada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kelas: Tingkat 7 · 7A")).toHaveLength(2);
    expect(screen.getAllByText("Kelas asal: Tingkat 6 · 6B")).toHaveLength(2);
    expect(screen.getAllByText("Kelas: belum ditempatkan").length).toBeGreaterThan(0);
  });
  it("finds students by parent name or class", async () => {
    mocks.load.mockResolvedValue({ items: namesakes(), historyAvailable: true });
    mount();
    await screen.findAllByText("Ahmad Fauzi");
    const search = screen.getByLabelText(SEARCH_LABEL);
    fireEvent.change(search, { target: { value: "abdullah" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 dari 5");
    expect(screen.getAllByText("Ayah: Abdullah · Ibu: Aisyah")).toHaveLength(2);
    fireEvent.change(search, { target: { value: "6B" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 dari 5");
    expect(screen.getAllByText("Ayah: Budi · Ibu: —")).toHaveLength(2);
  });
  it("opens one student from ?siswa= instead of every student with the same name", async () => {
    mocks.params = new URLSearchParams("siswa=s1");
    mocks.load.mockResolvedValue({ items: namesakes(), historyAvailable: true });
    mount();
    const chip = await screen.findByRole("group", { name: "Siswa terpilih" });
    expect(chip).toHaveTextContent("Menampilkan 1 pendaftaran: Ahmad Fauzi");
    expect(screen.getByRole("status")).toHaveTextContent("1 dari 5");
    expect(screen.getAllByText("Ayah: Abdullah · Ibu: Aisyah")).toHaveLength(2);
    expect(screen.queryByText("Ayah: Budi · Ibu: —")).not.toBeInTheDocument();
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveValue("");
    fireEvent.click(within(chip).getByRole("button", { name: "Tampilkan semua" }));
    expect(screen.queryByRole("group", { name: "Siswa terpilih" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("5 dari 5");
  });
  it("says so when the requested student has no registration here and lets the user show everyone", async () => {
    mocks.params = new URLSearchParams("siswa=missing");
    mocks.load.mockResolvedValue({ items: namesakes(), historyAvailable: true });
    mount();
    const chip = await screen.findByRole("group", { name: "Siswa terpilih" });
    expect(chip).toHaveTextContent("Menampilkan 0 pendaftaran");
    expect(screen.getByText("Tidak ada calon siswa yang sesuai filter.")).toBeInTheDocument();
    fireEvent.click(within(chip).getByRole("button", { name: "Tampilkan semua" }));
    expect(screen.getByRole("status")).toHaveTextContent("5 dari 5");
  });
});
