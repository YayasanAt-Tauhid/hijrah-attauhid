import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
const m = vi.hoisted(() => ({ items: [] as SpmbBillingCandidate[], open: vi.fn(), error: vi.fn() }));
vi.mock("@/server/spmbBilling", () => ({ getSpmbBillingCandidates: async () => ({ items: m.items }), updateSpmbBillingPlanEndMonth: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/hooks/useKeuangan", () => ({ useAllJenisPembayaran: () => ({ data: [] }), useTahunBuku: () => ({ data: [] }), formatRupiah: String, namaBulan: String }));
vi.mock("@/lib/router-compat", () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock("sonner", () => ({ toast: { error: m.error } }));
vi.mock("@/components/keuangan/DialogInputMassalSpmb", () => ({ DialogInputMassalSpmb: ({ siswa }: { siswa: SpmbBillingCandidate[] }) => {
  m.open(siswa); return <div role="dialog">Input Massal Terpilih</div>;
} }));
import RencanaTagihanSiswaBaru from "./RencanaTagihanSiswaBaru";
const make = (id: string, ready = true) => ({ id, nama: `Siswa ${id}`, ready_for_billing: ready, ready_for_spp: false,
  target_departemen_id: "smp", target_departemen_kode: "SMP", rencana_spp: null } as SpmbBillingCandidate);
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RencanaTagihanSiswaBaru /></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); m.items = [make("A"), make("B"), make("C", false)]; });
afterEach(cleanup);
it("hanya mengirim siswa tercentang yang siap ditagih", async () => {
  mount(); fireEvent.click(await screen.findByRole("checkbox", { name: "Pilih Siswa B" }));
  expect(screen.getByRole("checkbox", { name: "Pilih Siswa C" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Input Massal (1)" }));
  await screen.findByRole("dialog"); expect(m.open).toHaveBeenLastCalledWith([expect.objectContaining({ id: "B" })]);
});
it("pilih semua mengikuti seluruh hasil filter, melampaui halaman pertama, serta mengecualikan yang belum siap", async () => {
  m.items = Array.from({ length: 25 }, (_, i) => make(String(i))); m.items.push(make("Belum", false)); mount();
  await screen.findByRole("checkbox", { name: "Pilih Siswa 0" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pilih semua hasil filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Input Massal (25)" }));
  await screen.findByRole("dialog"); expect(m.open.mock.lastCall?.[0]).toHaveLength(25);
});
it("pilihan yang tersembunyi oleh filter tidak ikut disimpan", async () => {
  mount(); await screen.findByRole("checkbox", { name: "Pilih Siswa A" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pilih semua hasil filter" }));
  fireEvent.change(screen.getByPlaceholderText("Cari nama, NIS, kelas, atau jenjang..."), { target: { value: "Siswa A" } });
  fireEvent.click(screen.getByRole("button", { name: "Input Massal (1)" }));
  await screen.findByRole("dialog"); expect(m.open).toHaveBeenLastCalledWith([expect.objectContaining({ id: "A" })]);
});
it("membatasi batch secara terang tanpa diam-diam memangkas pilihan", async () => {
  m.items = Array.from({ length: 101 }, (_, i) => make(String(i))); mount();
  await screen.findByRole("checkbox", { name: "Pilih Siswa 0" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Pilih semua hasil filter" }));
  expect(m.error).toHaveBeenCalledWith(expect.stringMatching(/101 siswa siap/));
  expect(screen.getByRole("button", { name: "Input Massal", exact: true })).toBeDisabled();
});
