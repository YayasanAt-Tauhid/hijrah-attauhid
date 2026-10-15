import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PiutangManajemen from "./PiutangManajemen";

const { batch, single, bills } = vi.hoisted(() => ({
  batch: vi.fn(), single: vi.fn(),
  bills: [10, 11].map((month) => ({
    id: `bill-${month}`, bulan: month, nominal: 450000,
    status: month === 10 ? "belum_bayar" : "terjadwal",
    jatuh_tempo: `2026-${month}-10`,
    siswa: { id: "student-1", nis: "TEST-001", nama: "Siswa Uji" },
    jenis: { nama: "SPP SMP" }, tahun_ajaran: { nama: "Tahun 2026" },
  })),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => ({
    data: queryKey[0] === "tagihan_pembatalan_cari" && enabled ? bills : [],
    isLoading: false, isFetching: false, isError: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));
vi.mock("@/hooks/useTagihan", () => ({
  useBatalkanTagihan: () => ({ mutate: single, isPending: false }),
  useBatalkanTagihanBatch: () => ({ mutateAsync: batch, isPending: false }),
}));
vi.mock("@/hooks/useKeuangan", () => ({
  useLembaga: () => ({ data: [] }), formatRupiah: (v: number) => `Rp ${v}`,
  BULAN_ORDER_AKADEMIK: [], namaBulan: String, namaBulanTahun: String,
}));
vi.mock("@/hooks/useJurnal", () => ({ usePengaturanAkun: () => ({ data: [] }), logAuditKeuangan: vi.fn() }));
vi.mock("@/server/akrual", () => ({ jalankanAkrualJatuhTempo: vi.fn() }));
vi.mock("@/components/shared/DataTable", () => ({ DataTable: () => null }));
vi.mock("./SppCategoryPeriod", () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  batch.mockResolvedValue({ success: true, berhasil: 1, gagal: [] });
});

async function openSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PiutangManajemen /></QueryClientProvider>);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Koreksi / Pembatalan Tagihan" }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("button", { name: "Koreksi / Batalkan Tagihan" }));
  fireEvent.change(screen.getByPlaceholderText("Ketik minimal 3 karakter NIS atau nama siswa..."), { target: { value: "TEST-001" } });
  await screen.findAllByRole("checkbox");
  fireEvent.change(screen.getByPlaceholderText("mis. Salah pilih siswa / tagihan dobel / tarif keliru..."), { target: { value: "Tagihan salah input" } });
}

describe("Pemilihan pembatalan tagihan", () => {
  it("memproses satu centang melalui konfirmasi dengan hanya ID yang dipilih", async () => {
    await openSearch();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Batalkan 1 Tagihan Terpilih" }));
    const confirmation = screen.getByRole("dialog", { name: "Konfirmasi Batalkan 1 Tagihan" });
    expect(batch).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(confirmation).getByRole("button", { name: "Batalkan 1 Tagihan" })); });
    expect(batch).toHaveBeenCalledWith({ tagihan_ids: ["bill-10"], alasan: "Tagihan salah input", tanggal: expect.any(String) });
    expect(single).not.toHaveBeenCalled();
  });
  it("tetap mendukung dua centang dan mengirim kedua ID", async () => {
    await openSearch();
    screen.getAllByRole("checkbox").forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole("button", { name: "Batalkan 2 Tagihan Terpilih" }));
    const confirmation = screen.getByRole("dialog", { name: "Konfirmasi Batalkan 2 Tagihan" });
    await act(async () => { fireEvent.click(within(confirmation).getByRole("button", { name: "Batalkan 2 Tagihan" })); });
    expect(batch).toHaveBeenCalledWith({ tagihan_ids: ["bill-10", "bill-11"], alasan: "Tagihan salah input", tanggal: expect.any(String) });
  });
  it("menyamakan klik nama dengan centang dan menonaktifkan proses setelah dilepas", async () => {
    await openSearch();
    const row = screen.getAllByRole("button", { name: /TEST-001 — Siswa Uji/ })[0];
    fireEvent.click(row);
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(screen.getByRole("button", { name: "Batalkan 1 Tagihan Terpilih" })).toBeEnabled();
    fireEvent.click(row);
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Batalkan & Buat Jurnal" })).toBeDisabled();
  });
});
