import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AkrualLogRow } from "@/lib/akrualLog";

const m = vi.hoisted(() => ({ useAkrualLog: vi.fn() }));
vi.mock("@/hooks/useAkrualLog", () => ({ useAkrualLog: m.useAkrualLog }));
vi.mock("@/hooks/useISAK35", () => ({ useRekonRekeningAntar: () => ({ data: { rows: [], total: 0 }, isLoading: false }) }));
vi.mock("@/hooks/useKeuangan", () => ({ useTahunBuku: () => ({ data: [], isLoading: false }), formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock("@/integrations/supabase/client", () => {
  // Rantai query apa pun (select/eq/is/...) yang pada akhirnya menghasilkan data kosong.
  const chain: any = new Proxy(() => {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve({ data: [], error: null }) : () => chain),
  });
  return { supabase: { from: () => chain, rpc: () => chain } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ChecklistPraTutupBuku } from "./TutupBuku";

const row = (over: Partial<AkrualLogRow> = {}): AkrualLogRow => ({
  id: "r", dijalankan_at: new Date().toISOString(), sumber: "cron", sampai_tanggal: null,
  piutang_diposting: 0, piutang_nominal: 0, pendapatan_diakui: 0, pendapatan_nominal: 0,
  jumlah_galat: 0, galat: [], galat_terpotong: false, gagal_total: false, pesan_gagal: null, ...over,
});
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <ChecklistPraTutupBuku tahunId="t1" tahun={{ nama: "2026", tanggal_selesai: "2026-12-31" }} />
</QueryClientProvider>);
const state = (over: object) => m.useAkrualLog.mockReturnValue({ data: undefined, isLoading: false, error: null, ...over });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("checklist sebelum tutup buku: akrual harian", () => {
  it("menampilkan butir akrual dan peringatan bila eksekusi terakhir bergalat", async () => {
    state({ data: [row({ jumlah_galat: 33 })] }); mount();
    expect(screen.getByText("Akrual harian otomatis tanpa galat")).toBeInTheDocument();
    expect(await screen.findByText(/memiliki 33 galat/)).toBeInTheDocument();
    expect(await screen.findByText(/Ada poin yang perlu diperiksa/)).toBeInTheDocument();
  });
  it("eksekusi terakhir bersih tidak memunculkan peringatan", async () => {
    state({ data: [row()] }); mount();
    expect(await screen.findByText(/tanpa galat\./)).toBeInTheDocument();
    expect(screen.queryByText(/Ada poin yang perlu diperiksa/)).toBeNull();
  });
  it("gagal memuat riwayat dilaporkan sebagai butir bermasalah, bukan hijau", async () => {
    state({ error: new Error("tabel belum ada") }); mount();
    expect(await screen.findByText(/Riwayat akrual harian belum dapat dimuat/)).toBeInTheDocument();
    expect(await screen.findByText(/Ada poin yang perlu diperiksa/)).toBeInTheDocument();
  });
});
