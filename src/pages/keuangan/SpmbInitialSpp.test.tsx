import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: { generated: 1 }, error: null })) }));
const fixtures = [
 { id: "a", spmb_internal: true, nama: "Asrama Siswa", status_asrama: "asrama" },
 { id: "b", spmb_internal: false, nama: "Non Asrama Siswa", status_asrama: "non_asrama" },
 { id: "c", spmb_internal: false, nama: "Belum Status Siswa", status_asrama: null },
].map((r) => ({ ...r, target_departemen_id: "tujuan", target_departemen_kode: "SMP", tahun_ajaran_id: "academic2027", tahun_ajaran_mulai: "2027-07-01", tahun_ajaran_selesai: "2028-06-30", tahun_ajaran_nama: "2027/2028", rencana_spp: null, ready_for_billing: true, ready_for_spp: false }));
vi.mock("@/server/spmbBilling", () => ({
 getSpmbBillingCandidates: async () => ({ items: fixtures }),
 updateSpmbBillingPlanEndMonth: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/useKeuangan", () => ({
 useAllJenisPembayaran: () => ({ data: [{ id: "spp", nama: "SPP SMP", tipe: "bulanan", departemen_id: "tujuan", nominal: 500000, aktif: true }] }), useTahunBuku: () => ({ data: [] }),
 formatRupiah: String, namaBulan: String,
}));
vi.mock("@/lib/router-compat", () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock("@/components/keuangan/DialogAjukanKeringanan", () => ({
 DialogAjukan: ({ siswaTetap }: { siswaTetap: { id: string; departemen_id: string } }) =>
   <div role="dialog">Keringanan {siswaTetap.id} {siswaTetap.departemen_id}</div>,
}));
vi.mock("@/components/ui/select", () => ({
 Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) =>
   <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
 SelectTrigger: () => null, SelectValue: () => null,
 SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
 SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
import RencanaTagihanSiswaBaru from "./RencanaTagihanSiswaBaru";
function mount() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 render(<QueryClientProvider client={client}><RencanaTagihanSiswaBaru /></QueryClientProvider>);
}
afterEach(cleanup);
describe("SPP awal tanpa kelas", () => {
 it("mengirim satu periode dan nominal siswa tanpa membuat rencana otomatis", async () => {
   mocks.rpc.mockClear();
   mount();
   const row = await screen.findByRole("row", { name: /Non Asrama Siswa/ });
   fireEvent.click(within(row).getByRole("button", { name: "Terbitkan Tagihan Awal" }));
   const dialog = await screen.findByRole("dialog");
   expect(dialog).toHaveTextContent("SPP awal tanpa kelas");
   fireEvent.click(within(dialog).getByRole("checkbox", { name: "Terbitkan SPP awal (satu bulan)" }));
   expect(dialog).toHaveTextContent("Periode SPP awal");
   expect(dialog).not.toHaveTextContent("Batas rencana SPP");
   fireEvent.click(within(dialog).getByRole("button", { name: "Terbitkan Tagihan Awal" }));
   await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("terbitkan_spp_awal_spmb", {
     p_siswa_id: "b", p_tahun_akademik_id: "academic2027", p_jenis_id: "spp", p_bulan_mulai: "2027-07-01", p_nominal: 500000,
   }));
 });
});

it("membuka SPP awal tanpa kelas melalui tombol langsung dengan pilihan SPP sudah aktif", async () => {
  mocks.rpc.mockClear();
  mount();
  const row=await screen.findByRole("row",{name:/Non Asrama Siswa/});
  fireEvent.click(within(row).getByRole("button",{name:"SPP awal tanpa kelas",exact:true}));
  const dialog=await screen.findByRole("dialog");
  expect(within(dialog).getByRole("checkbox",{name:"Terbitkan SPP awal (satu bulan)"})).toBeChecked();
  expect(dialog).toHaveTextContent("Periode SPP awal");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
