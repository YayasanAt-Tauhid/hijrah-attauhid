// Uji render halaman Buku Besar: memilih satu akun harus menampilkan tabel mutasi, saldo awal, total,
// dan Export; memilih "Semua akun rekening" harus menampilkan ringkasan dan memuat mutasi rinci
// hanya saat baris dibuka. (Regresi #248: kartu tabel satu akun hilang tanpa terdeteksi tes.)
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kas = { id: "a1", kode: "1101", nama: "KAS BENDAHARA YAYASAN", saldo_normal: "D", jenis: "aset", aktif: true };
const mutasi = [
  { tanggal: "2026-03-05", nomor: "JU-001", lembaga: "SMP", keterangan: "Setoran SPP", debit: 100000, kredit: 0, tipe: "normal" },
  { tanggal: "2026-03-06", nomor: "JU-002", lembaga: "SMP", keterangan: "Biaya ATK", debit: 0, kredit: 30000, tipe: "normal" },
];

const m = vi.hoisted(() => ({ useBukuBesar: vi.fn(), useBukuBesarRingkasanSemua: vi.fn() }));
vi.mock("@/hooks/useJurnal", () => ({
  useAkunRekening: () => ({ data: [kas] }),
  useAkunRekeningSemua: () => ({ data: [kas] }),
  useBukuBesar: m.useBukuBesar,
  useBukuBesarRingkasanSemua: m.useBukuBesarRingkasanSemua,
  fetchBukuBesarSemuaRinci: vi.fn(),
}));
vi.mock("@/hooks/useISAK35", () => ({
  useDepartemenGroups: () => ({ data: { pendidikanDepts: [], usahaDepts: [], pendidikanIds: [], usahaIds: [] } }),
}));
vi.mock("@/hooks/useKeuangan", () => ({
  formatRupiah: (n: number) => `Rp ${n}`,
  namaBulan: (n: number) => `Bulan-${n}`,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import BukuBesar from "./BukuBesar";

// cmdk/Radix membutuhkan API browser yang tidak ada di jsdom.
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  m.useBukuBesar.mockReturnValue({ data: { saldoAwal: 5330400, mutasi }, isLoading: false, isError: false, error: null });
  m.useBukuBesarRingkasanSemua.mockReturnValue({
    data: { saldoAwal: { a1: 5330400 }, ringkasan: [{ akun_id: "a1", total_debit: 100000, total_kredit: 30000, jumlah: 2 }] },
    isLoading: false, isError: false, error: null,
  });
});
afterEach(cleanup);

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BukuBesar />
    </QueryClientProvider>,
  );

async function pilihAkun(nama: string) {
  fireEvent.click(screen.getAllByRole("combobox")[0]);
  fireEvent.click(await screen.findByText(nama));
}

describe("Buku Besar: satu akun rekening", () => {
  it("menampilkan kartu info, saldo awal, tabel mutasi, total, saldo akhir, dan Export", async () => {
    mount();
    await pilihAkun("1101 - KAS BENDAHARA YAYASAN");
    // kartu info akun
    expect(screen.getByText("Saldo Normal:")).toBeInTheDocument();
    // saldo awal + tabel mutasi
    expect(screen.getByText(/Saldo Awal per/)).toBeInTheDocument();
    expect(await screen.findByText("JU-001")).toBeInTheDocument();
    expect(screen.getByText("JU-002")).toBeInTheDocument();
    expect(screen.getByText("Setoran SPP")).toBeInTheDocument();
    // total dan saldo akhir = 5.330.400 + 100.000 - 30.000
    expect(screen.getByText("Total Debit:")).toBeInTheDocument();
    expect(screen.getByText("Total Kredit:")).toBeInTheDocument();
    expect(screen.getByText("Saldo Akhir:")).toBeInTheDocument();
    expect(screen.getByText("Saldo Akhir:").parentElement).toHaveTextContent("Rp 5400400");
    expect(screen.getByText("Total Debit:").parentElement).toHaveTextContent("Rp 100000");
    expect(screen.getByText("Total Kredit:").parentElement).toHaveTextContent("Rp 30000");
    // tombol Export tersedia
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("saat memuat, tabel menampilkan keadaan memuat (bukan kosong tanpa penjelasan)", async () => {
    m.useBukuBesar.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    mount();
    await pilihAkun("1101 - KAS BENDAHARA YAYASAN");
    expect(screen.getByText("Saldo Normal:")).toBeInTheDocument();
    expect(screen.queryByText("JU-001")).toBeNull();
    expect(document.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it("galat pemuatan ditampilkan", async () => {
    m.useBukuBesar.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("koneksi putus") });
    mount();
    await pilihAkun("1101 - KAS BENDAHARA YAYASAN");
    expect(screen.getByText(/Gagal memuat buku besar: koneksi putus/)).toBeInTheDocument();
  });
});

describe("Buku Besar: semua akun rekening", () => {
  it("menampilkan ringkasan per akun, dan mutasi rinci baru dimuat saat baris dibuka", async () => {
    mount();
    await pilihAkun("Semua akun rekening");
    expect(screen.getByText("Hanya akun yang ada mutasi")).toBeInTheDocument();
    const baris = await screen.findByText(/1101 - KAS BENDAHARA YAYASAN/, { selector: "span" });
    expect(baris).toBeInTheDocument();
    // sebelum dibuka, mutasi rinci belum dimuat dan tidak tampil
    expect(screen.queryByText("JU-001")).toBeNull();
    const callsSebelum = m.useBukuBesar.mock.calls.filter((c) => c[0] === "a1").length;
    fireEvent.click(within(baris.closest("h3") ?? baris.parentElement!.parentElement!).getByRole("button"));
    expect(await screen.findByText("JU-001")).toBeInTheDocument();
    expect(m.useBukuBesar.mock.calls.filter((c) => c[0] === "a1").length).toBeGreaterThan(callsSebelum);
  });
});
