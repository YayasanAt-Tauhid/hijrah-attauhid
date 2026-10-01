import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PengakuanPendapatan from "./PengakuanPendapatan";

const { fixture } = vi.hoisted(() => ({
  fixture: {
    id: "advance-1", status: "pending", bulan: null, jumlah: 4200000,
    pembayaran_id: "payment-1", tanggal_pengakuan: null,
    siswa: { nama: "Siswa Uji", nis: "UJI" },
    jenis: { nama: "UANG PANGKAL TK", hari_jatuh_tempo: null },
    tahun_pembayaran: { nama: "Tahun 2026" },
    tahun_target: { nama: "Tahun 2027", tanggal_mulai: "2027-01-01" },
    pembayaran: {
      tagihan: { jatuh_tempo: "2027-07-01", tahun_akademik: { nama: "2027/2028" } },
    },
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [fixture], error: null }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useKeuangan", () => ({
  useTahunBuku: () => ({
    data: [{ id: "book-2027", nama: "Tahun 2027", aktif: true }],
  }),
  formatRupiah: (value: number) => "Rp " + value,
  namaBulanTahun: (value: number) => String(value),
}));
vi.mock("@/server/akrual", () => ({ akuiPendapatanDimuka: vi.fn() }));
vi.mock("@/components/shared/DataTable", () => ({
  DataTable: ({ data, columns }: {
    data: typeof fixture[];
    columns: Array<{ key: string; label: string; render?: (v: unknown, row: typeof fixture) => React.ReactNode }>;
  }) => <div>{columns.map((column) => <div key={column.key}>
    <span>{column.label}</span>
    {data.map((row) => <div key={row.id}>{column.render?.(undefined, row)}</div>)}
  </div>)}</div>,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><PengakuanPendapatan /></QueryClientProvider>);
}

describe("Pengakuan pendapatan uang pangkal", () => {
  it("memisahkan tahun buku dan tahun ajaran serta memblokir pengakuan Januari", async () => {
    vi.setSystemTime(new Date("2027-01-10T05:00:00Z"));
    renderPage();
    expect(await screen.findByRole("button", { name: /^Akui$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Akui Semua yang Jatuh Tempo" })).toBeDisabled();
    expect(screen.getByText("Tahun Buku Penerimaan")).toBeInTheDocument();
    expect(screen.getByText("Tahun Ajaran")).toBeInTheDocument();
    expect(screen.getByText("2027/2028")).toBeInTheDocument();
    expect(screen.getByText("01 Jul 2027")).toBeInTheDocument();
  });
  it("membuka pengakuan Juli meskipun yang menentukan adalah tanggal, bukan tahun aktif", async () => {
    vi.setSystemTime(new Date("2027-07-01T01:00:00Z"));
    renderPage();
    expect(await screen.findByRole("button", { name: /^Akui$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Akui Semua yang Jatuh Tempo" })).toBeEnabled();
  });
});
