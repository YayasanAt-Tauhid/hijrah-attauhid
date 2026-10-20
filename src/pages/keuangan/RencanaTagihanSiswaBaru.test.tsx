import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const fixtures = [
 { id: "a", spmb_internal: true, nama: "Asrama Siswa", status_asrama: "asrama" },
 { id: "b", spmb_internal: false, nama: "Non Asrama Siswa", status_asrama: "non_asrama" },
 { id: "c", spmb_internal: false, nama: "Belum Status Siswa", status_asrama: null },
].map((r) => ({ ...r, target_departemen_id: "tujuan", target_departemen_kode: "SMP", tahun_ajaran_nama: "2027/2028", rencana_spp: null, ready_for_billing: true, ready_for_spp: false }));
vi.mock("@/server/spmbBilling", () => ({
 getSpmbBillingCandidates: async () => ({ items: fixtures }),
 updateSpmbBillingPlanEndMonth: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useKeuangan", () => ({
 useAllJenisPembayaran: () => ({ data: [] }), useTahunBuku: () => ({ data: [] }),
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
describe("rencana tagihan status asrama dan keringanan", () => {
 it("membedakan data asrama kosong dari nonasrama dan memfilter siswa", async () => {
   mount();
   await screen.findByRole("row", { name: /^Asrama Siswa.*Asrama/ });
   expect(screen.getByRole("row", { name: /Belum Status Siswa/ })).toHaveTextContent("Belum ditentukan");
   fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "non_asrama" } });
   expect(screen.getByRole("row", { name: /Non Asrama Siswa/ })).toBeInTheDocument();
   expect(screen.queryByRole("row", { name: /^Asrama Siswa/ })).not.toBeInTheDocument();
   expect(screen.queryByRole("row", { name: /Belum Status Siswa/ })).not.toBeInTheDocument();
   expect(screen.getByRole("row", { name: /Non Asrama Siswa/ })).toHaveTextContent("Eksternal");
   fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "internal" } });
   expect(screen.queryByRole("row", { name: /Non Asrama Siswa/ })).not.toBeInTheDocument();
   fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "__all__" } });
   expect(screen.getByRole("row", { name: /^Asrama Siswa/ })).toHaveTextContent("Internal");
   expect(screen.queryByRole("row", { name: /Belum Status Siswa/ })).not.toBeInTheDocument();
   fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "eksternal" } });
   expect(screen.queryByRole("row", { name: /^Asrama Siswa/ })).not.toBeInTheDocument();
   expect(screen.getByRole("row", { name: /Belum Status Siswa/ })).toHaveTextContent("Eksternal");
 });
 it("membuka input keringanan calon siswa sebelum penempatan dengan lembaga tujuan", async () => {
   mount();
   const row = await screen.findByRole("row", { name: /Non Asrama Siswa/ });
   fireEvent.click(within(row).getByRole("button", { name: "Input Keringanan" }));
   expect(screen.getByRole("dialog")).toHaveTextContent("Keringanan b tujuan");
 });
});
