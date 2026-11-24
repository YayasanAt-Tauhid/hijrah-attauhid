// Uji render halaman Proyeksi Tagihan SPP: kartu ringkasan, tabel lembaga x bulan, tampilan tahunan,
// penerusan filter tahun/lembaga ke hook, serta keadaan kosong, memuat, dan galat.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BarisRingkasan } from "@/lib/proyeksiTagihan";

const m = vi.hoisted(() => ({ useRingkasan: vi.fn() }));
vi.mock("@/hooks/useProyeksiTagihan", () => ({ useRingkasanTagihanPeriode: m.useRingkasan }));
vi.mock("@/hooks/useKeuangan", () => ({
  useLembaga: () => ({ data: [
    { id: "d-sd", kode: "SD", nama: "SD Islam" },
    { id: "d-smp", kode: "SMP", nama: "SMP Islam" },
  ] }),
  formatRupiah: (n: number) => `Rp ${n}`,
  namaBulan: (n: number) => `Bulan-${n}`,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));

import ProyeksiTagihan from "./ProyeksiTagihan";

const tahunIni = new Date().getFullYear();
const baris = (o: Partial<BarisRingkasan>): BarisRingkasan => ({
  departemen_id: "d-sd", departemen_kode: "SD", tahun: tahunIni, bulan: 1,
  jumlah_siswa: 10, jumlah_tagihan: 10, bruto: 0, potongan: 0, neto: 0, terbayar: 0, sisa: 0, ...o,
});
const contoh: BarisRingkasan[] = [
  baris({ bulan: 1, neto: 100, bruto: 120, potongan: 20, jumlah_tagihan: 12 }),
  baris({ bulan: 2, neto: 200, bruto: 210, potongan: 10, terbayar: 40, sisa: 160, jumlah_tagihan: 20 }),
  baris({ departemen_id: "d-smp", departemen_kode: "SMP", bulan: 1, neto: 50, bruto: 60, potongan: 10, jumlah_tagihan: 5 }),
];
const hasil = (data: BarisRingkasan[], extra: object = {}) => ({ data, isLoading: false, isError: false, error: null, ...extra });

const sel = (r: HTMLElement) => within(r).queryAllByRole("cell").map((c) => c.textContent);
const barisTabel = (kode: string) => {
  const r = within(screen.getByRole("table")).getAllByRole("row").find((row) => sel(row)[0] === kode);
  if (!r) throw new Error(`baris ${kode} tidak ada`);
  return sel(r);
};

beforeEach(() => {
  vi.clearAllMocks();
  m.useRingkasan.mockReturnValue(hasil(contoh));
});
afterEach(cleanup);

describe("Proyeksi Tagihan SPP", () => {
  it("menampilkan judul dan kartu ringkasan setahun", () => {
    render(<ProyeksiTagihan />);
    expect(screen.getByRole("heading", { name: "Proyeksi Tagihan SPP" })).toBeInTheDocument();
    expect(within(screen.getByTestId("kartu-total-neto")).getByText("Rp 350")).toBeInTheDocument();
    expect(within(screen.getByTestId("kartu-rata-rata")).getByText("Rp 175")).toBeInTheDocument();
    const tertinggi = screen.getByTestId("kartu-bulan-tertinggi");
    expect(within(tertinggi).getByText("Bulan-2")).toBeInTheDocument();
    expect(within(tertinggi).getByText("Rp 200")).toBeInTheDocument();
    // peringatan: neto = tagihan terjadwal, bukan uang masuk
    expect(screen.getByText(/belum tentu sudah dibayar/i)).toBeInTheDocument();
  });

  it("tabel bulanan: satu baris per lembaga, 12 bulan, kolom total, dan baris total semua lembaga", () => {
    render(<ProyeksiTagihan />);
    const kepala = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(kepala).toEqual(["Lembaga", ...Array.from({ length: 12 }, (_, i) => `Bulan-${i + 1}`), "Total"]);
    const sd = barisTabel("SD");
    expect(sd.slice(1, 4)).toEqual(["Rp 100", "Rp 200", "–"]);
    expect(sd[sd.length - 1]).toBe("Rp 300");
    expect(barisTabel("SMP")[1]).toBe("Rp 50");
    const total = barisTabel("Total");
    expect(total.slice(1, 3)).toEqual(["Rp 150", "Rp 200"]);
    expect(total[total.length - 1]).toBe("Rp 350");
  });

  it("tampilan Tahunan menampilkan jumlah tagihan, bruto, potongan, neto, terbayar, dan sisa", () => {
    render(<ProyeksiTagihan />);
    fireEvent.click(screen.getByRole("button", { name: "Tahunan" }));
    const kepala = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(kepala).toEqual(["Lembaga", "Tagihan", "Bruto", "Potongan", "Neto", "Terbayar", "Sisa"]);
    expect(barisTabel("SD")).toEqual(["SD", "32", "Rp 330", "Rp 30", "Rp 300", "Rp 40", "Rp 160"]);
    expect(barisTabel("Total")).toEqual(["Total", "37", "Rp 390", "Rp 40", "Rp 350", "Rp 40", "Rp 160"]);
  });

  it("meneruskan pilihan tahun dan lembaga ke hook", () => {
    render(<ProyeksiTagihan />);
    expect(m.useRingkasan).toHaveBeenLastCalledWith({ tahun: tahunIni, departemenId: undefined });
    const [pilihTahun, pilihLembaga] = screen.getAllByRole("combobox");
    fireEvent.change(pilihTahun, { target: { value: String(tahunIni + 1) } });
    expect(m.useRingkasan).toHaveBeenLastCalledWith({ tahun: tahunIni + 1, departemenId: undefined });
    fireEvent.change(pilihLembaga, { target: { value: "d-smp" } });
    expect(m.useRingkasan).toHaveBeenLastCalledWith({ tahun: tahunIni + 1, departemenId: "d-smp" });
    fireEvent.change(pilihLembaga, { target: { value: "semua" } });
    expect(m.useRingkasan).toHaveBeenLastCalledWith({ tahun: tahunIni + 1, departemenId: undefined });
  });

  it("tombol Export tersedia bila ada data", () => {
    render(<ProyeksiTagihan />);
    expect(screen.getByRole("button", { name: /export/i })).toBeEnabled();
  });

  it("tanpa data: pesan kosong, tanpa tabel, Export nonaktif", () => {
    m.useRingkasan.mockReturnValue(hasil([]));
    render(<ProyeksiTagihan />);
    expect(screen.getByText(/belum ada tagihan spp/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
  });

  it("memuat: tidak menampilkan tabel", () => {
    m.useRingkasan.mockReturnValue(hasil([], { isLoading: true }));
    render(<ProyeksiTagihan />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/belum ada tagihan spp/i)).not.toBeInTheDocument();
  });

  it("galat: menampilkan pesan galat, bukan 'belum ada tagihan'", () => {
    m.useRingkasan.mockReturnValue(hasil([], { isError: true, error: new Error("Tidak diizinkan mengakses proyeksi tagihan") }));
    render(<ProyeksiTagihan />);
    expect(screen.getByText(/gagal memuat proyeksi tagihan/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak diizinkan mengakses proyeksi tagihan/i)).toBeInTheDocument();
    expect(screen.queryByText(/belum ada tagihan spp/i)).not.toBeInTheDocument();
  });
});
