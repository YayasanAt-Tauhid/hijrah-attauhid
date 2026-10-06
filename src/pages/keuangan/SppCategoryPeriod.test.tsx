import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import SppCategoryPeriod from "./SppCategoryPeriod";
const mocks = vi.hoisted(() => ({ role: "admin", options: vi.fn(), operation: vi.fn(), history: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: mocks.role }) }));
vi.mock("@/server/sppPeriod", () => ({ getSppPeriodOptions: mocks.options, previewOrApplySppPeriod: mocks.operation, getSppPeriodHistory: mocks.history }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) => <select disabled={disabled} value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => <option value="">Pilih</option>, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
vi.mock("@/components/shared/ConfirmDialog", () => ({
  ConfirmDialog: ({ open, description, onConfirm }: { open: boolean; description: string; onConfirm: () => void }) => open ? <div role="dialog"><p>{description}</p><button onClick={onConfirm}>Konfirmasi simpan</button></div> : null,
}));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (value: number) => "Rp " + value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const preview = {
  preview_hash: "a".repeat(32), bulan_dapat_disesuaikan: 1, applied: false, tagihan_diubah: 0, audit_id: null,
  rows: [
    { periode: "2026-11-01", tagihan_id: "bill-one", nominal: 450000, nominal_bruto_lama: 450000, nominal_bruto_baru: 1300000, nominal_diskon_lama: 0, nominal_diskon_baru: 100000, nominal_netto_lama: 450000, nominal_netto_baru: 1200000, tarif_referensi: 450000, kategori_lama: "asrama", kategori_baru: "non_asrama", aksi: "ubah_tagihan", alasan: null },
    { periode: "2026-12-01", tagihan_id: "bill-paid", nominal: 450000, nominal_bruto_lama: 450000, nominal_bruto_baru: 1300000, nominal_diskon_lama: 0, nominal_diskon_baru: 100000, nominal_netto_lama: 450000, nominal_netto_baru: 1200000, tarif_referensi: 450000, kategori_lama: "asrama", kategori_baru: "non_asrama", aksi: "terkunci", alasan: "Tagihan sudah memiliki pembayaran, jurnal, atau koreksi" },
  ],
};
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.role = "admin"; });
function mount() {
  mocks.options.mockResolvedValue({ siswa: [{ id: "00000000-0000-0000-0000-000000000911", nama: "Siswa Uji", nis: "26-03-001", departemen_id: "dept", lembaga: "SMP" }], jenis: [{ id: "00000000-0000-0000-0000-000000000912", nama: "SPP SMP", departemen_id: "dept" }] });
  mocks.history.mockResolvedValue([]);
  mocks.operation.mockImplementation(({ data }: { data: { apply: boolean } }) => Promise.resolve(data.apply ? { ...preview, applied: true, tagihan_diubah: 1, audit_id: "audit" } : preview));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SppCategoryPeriod /></QueryClientProvider>);
}
async function chooseStudent() {
  fireEvent.change(screen.getByLabelText("Cari siswa aktif SMP / SMA / MTA"), { target: { value: "Siswa" } });
  await screen.findByRole("option", { name: /Siswa Uji/ });
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "00000000-0000-0000-0000-000000000911" } });
  fireEvent.change(screen.getByLabelText("Nominal SPP bruto per bulan"), { target: { value: "1300000" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Lihat pratinjau" })).not.toBeDisabled());
}
describe("pratinjau penyesuaian kategori SPP", () => {
  it("menampilkan bulan terkunci dan menyimpan setelah alasan serta konfirmasi", async () => {
    mount(); await chooseStudent();
    fireEvent.click(screen.getByRole("button", { name: "Lihat pratinjau" }));
    await screen.findByText("Terkunci");
    expect(screen.getByText("Tagihan sudah memiliki pembayaran, jurnal, atau koreksi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan penyesuaian" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Alasan perubahan"), { target: { value: "Pindah non asrama sesuai wali siswa" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan penyesuaian" }));
    expect(mocks.operation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("1 bulan");
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi simpan" }));
    await waitFor(() => expect(mocks.operation).toHaveBeenCalledTimes(2));
    expect(mocks.operation.mock.calls[1][0].data).toMatchObject({ apply: true, preview_hash: "a".repeat(32), nominal_bruto: 1300000 });
  });
  it("membuang pratinjau saat bulan berubah", async () => {
    mount(); await chooseStudent();
    fireEvent.click(screen.getByRole("button", { name: "Lihat pratinjau" }));
    await screen.findByText("Terkunci");
    fireEvent.change(screen.getByLabelText("Bulan akhir"), { target: { value: "2027-06" } });
    expect(screen.queryByRole("button", { name: "Simpan penyesuaian" })).not.toBeInTheDocument();
  });
  it("tidak menampilkan aksi penyesuaian untuk kasir", () => {
    mocks.role = "kasir"; mount();
    expect(screen.queryByRole("button", { name: "Lihat pratinjau" })).not.toBeInTheDocument();
  });
});
