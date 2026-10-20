import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const m = vi.hoisted(() => ({ submit: vi.fn(), once: false }));
vi.mock("@/hooks/useKeuangan", () => ({
  formatRupiah: (n: number) => `Rp ${n}`,
  useAllJenisPembayaran: () => ({ data: [
    { id: "spp", nama: "SPP Tujuan", tipe: "bulanan", departemen_id: "tujuan", aktif: true },
    { id: "pangkal", nama: "Uang Pangkal", tipe: "sekali", departemen_id: "tujuan", aktif: true },
    { id: "lama", nama: "SPP Asal", tipe: "bulanan", departemen_id: "asal", aktif: true },
  ] }),
}));
vi.mock("@/hooks/useDiskon", () => ({
  useSkemaDiskon: () => ({ data: [{ id: "khusus", nama: "Khusus", kategori: "keringanan", tipe: "nominal", nilai_default: 50000 }] }),
  useAjukanDiskon: () => ({ mutate: m.submit, isPending: false }),
  useKebijakanKeringananAktif: () => ({ data: null }),
  useTagihanDiskonTarget: () => ({ data: m.once ? [{
    id: "tagihan", tahun_akademik_nama: "2027/2028", jatuh_tempo: "2027-07-10",
    periode_mulai: "2027-07-01", periode_selesai: "2027-07-31",
    nominal_bruto: 1000000, nominal_diskon: 0, nominal_netto: 1000000,
  }] : [], isLoading: false }),
  LABEL_KATEGORI: { keringanan: "Keringanan" },
}));
vi.mock("@/components/shared/SiswaCombobox", () => ({
  SiswaCombobox: ({ value, disabled, onChange }: { value: { nama: string } | null; disabled: boolean; onChange: (v: object) => void }) =>
    <button disabled={disabled} onClick={() => onChange({ id: "cari", nama: "Siswa Dicari", departemen_id: "tujuan", nis: null })}>{value?.nama || "Cari siswa"}</button>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}><option value="">Pilih</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
import { DialogAjukan } from "./DialogAjukanKeringanan";
const siswa = { id: "siswa-internal", nama: "Siswa Internal", nis: null, departemen_id: "tujuan" };
beforeEach(() => { vi.clearAllMocks(); m.once = false; });
afterEach(cleanup);
describe("pengajuan keringanan dari rencana siswa baru", () => {
  it("mengunci siswa dan menawarkan jenis pembayaran jenjang tujuan", () => {
    render(<DialogAjukan open onOpenChange={vi.fn()} siswaTetap={siswa} />);
    expect(screen.getByRole("button", { name: siswa.nama })).toBeDisabled();
    expect(screen.getByRole("option", { name: "SPP Tujuan" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "SPP Asal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajukan" })).toBeDisabled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("mengajukan SPP nominal dengan siswa dan periode yang dipilih", () => {
    render(<DialogAjukan open onOpenChange={vi.fn()} siswaTetap={siswa} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "khusus" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "spp" } });
    fireEvent.change(screen.getByLabelText("Mulai Bulan"), { target: { value: "2027-07" } });
    fireEvent.change(screen.getByLabelText("Sampai Bulan"), { target: { value: "2028-06" } });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "nominal" } });
    fireEvent.change(screen.getByLabelText("Nilai Potongan (Rp)"), { target: { value: "75000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajukan" }));
    expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({
      siswa_id: siswa.id, jenis_id: "spp", tipe: "nominal", nilai: 75000,
      periode_mulai: "2027-07-01", periode_selesai: "2028-06-01", tagihan_id: null,
    }), expect.any(Object));
  });
  it("biaya sekali memerlukan tagihan tujuan dan mendukung potongan persen", () => {
    m.once = true;
    render(<DialogAjukan open onOpenChange={vi.fn()} siswaTetap={siswa} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "khusus" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "pangkal" } });
    expect(screen.getByRole("button", { name: "Ajukan" })).toBeDisabled();
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "tagihan" } });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "persen" } });
    fireEvent.change(screen.getByLabelText("Nilai Potongan (%)"), { target: { value: "101" } });
    expect(screen.getByRole("button", { name: "Ajukan" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nilai Potongan (%)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajukan" }));
    expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({
      siswa_id: siswa.id, jenis_id: "pangkal", tagihan_id: "tagihan", tipe: "persen", nilai: 100,
      periode_mulai: "2027-07-01", periode_selesai: "2027-07-31",
    }), expect.any(Object));
  });
  it("form umum tetap mengizinkan pencarian siswa", () => {
    render(<DialogAjukan open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cari siswa" }));
    expect(screen.getByRole("button", { name: "Siswa Dicari" })).toBeEnabled();
  });
});
