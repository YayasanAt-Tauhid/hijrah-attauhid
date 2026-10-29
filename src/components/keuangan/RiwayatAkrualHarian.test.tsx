import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AkrualLogRow } from "@/lib/akrualLog";
const m = vi.hoisted(() => ({ useAkrualLog: vi.fn() }));
vi.mock("@/hooks/useAkrualLog", () => ({ useAkrualLog: m.useAkrualLog }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
import { RiwayatAkrualHarian } from "./RiwayatAkrualHarian";

const row = (over: Partial<AkrualLogRow> = {}): AkrualLogRow => ({
  id: "r", dijalankan_at: "2026-10-29T00:05:00Z", sumber: "cron", sampai_tanggal: "2026-10-29",
  piutang_diposting: 0, piutang_nominal: 0, pendapatan_diakui: 0, pendapatan_nominal: 0,
  jumlah_galat: 0, galat: [], galat_terpotong: false, gagal_total: false, pesan_gagal: null, ...over,
});
const state = (over: object) => m.useAkrualLog.mockReturnValue({ data: undefined, isLoading: false, error: null, ...over });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("kartu riwayat akrual harian", () => {
  it("menampilkan status memuat, galat pemuatan, dan kosong", () => {
    state({ isLoading: true }); const a = render(<RiwayatAkrualHarian />);
    expect(screen.getByText(/Memuat riwayat/)).toBeInTheDocument(); a.unmount();
    state({ error: new Error("x") }); const b = render(<RiwayatAkrualHarian />);
    expect(screen.getByText(/Riwayat akrual belum dapat dimuat/)).toBeInTheDocument(); b.unmount();
    state({ data: [] }); render(<RiwayatAkrualHarian />);
    expect(screen.getByText(/Belum ada riwayat/)).toBeInTheDocument();
  });
  it("eksekusi bersih menampilkan angka dan 'Tanpa galat'", () => {
    state({ data: [row({ piutang_diposting: 3, piutang_nominal: 1500000, pendapatan_diakui: 2, pendapatan_nominal: 400000 })] });
    render(<RiwayatAkrualHarian />);
    expect(screen.getByText("Tanpa galat")).toBeInTheDocument();
    expect(screen.getByText(/3 tagihan/)).toBeInTheDocument();
    expect(screen.getByText(/Rp 1500000/)).toBeInTheDocument();
    expect(screen.getByText(/2 item/)).toBeInTheDocument();
  });
  it("eksekusi bergalat menampilkan jumlah, dan rincian pesan dapat dibuka", () => {
    state({ data: [row({ jumlah_galat: 2, galat: ["Tagihan A: Penerimaan SPP belum memiliki jurnal kewajiban yang valid", "Tagihan B: akun belum diset"] })] });
    render(<RiwayatAkrualHarian />);
    expect(screen.getByText("2 galat")).toBeInTheDocument();
    expect(screen.getByText("Lihat rincian")).toBeInTheDocument();
    expect(screen.getByText(/Tagihan A: Penerimaan SPP/)).toBeInTheDocument();
    expect(screen.getByText(/Tagihan B: akun belum diset/)).toBeInTheDocument();
  });
  it("galat yang dipotong diberi keterangan jumlah sebenarnya", () => {
    state({ data: [row({ jumlah_galat: 250, galat: Array.from({ length: 200 }, (_, i) => `galat ${i + 1}`), galat_terpotong: true })] });
    render(<RiwayatAkrualHarian />);
    expect(screen.getByText("250 galat")).toBeInTheDocument();
    expect(screen.getByText(/Menampilkan 200 dari 250 galat/)).toBeInTheDocument();
  });
  it("kegagalan total ditandai tersendiri beserta pesannya", () => {
    state({ data: [row({ gagal_total: true, jumlah_galat: 1, galat: ["Akun piutang siswa belum dikonfigurasi"], pesan_gagal: "Akun piutang siswa belum dikonfigurasi" })] });
    render(<RiwayatAkrualHarian />);
    expect(screen.getByText("Gagal total")).toBeInTheDocument();
    expect(screen.getAllByText(/Akun piutang siswa belum dikonfigurasi/).length).toBeGreaterThan(0);
  });
});
