import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";

const m = vi.hoisted(() => ({ rpc: vi.fn(), close: vi.fn(), success: vi.fn(), error: vi.fn(), verified: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange: (v: string) => void; disabled: boolean }) =>
    <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">Pilih</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
import { DialogUangPangkalSpmb } from "./DialogUangPangkalSpmb";

function mount(code = "SMA") {
  const siswa = { id: "student", nama: "Calon Siswa", tahun_ajaran_id: "year", tahun_ajaran_nama: "2027/2028", target_departemen_kode: code, status_asrama: "asrama" } as SpmbBillingCandidate;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DialogUangPangkalSpmb siswa={siswa} onClose={m.close} /></QueryClientProvider>);
}
const submitButton = () => screen.getByRole("button", { name: "Verifikasi & Terbitkan Otomatis" });
beforeEach(() => {
  vi.clearAllMocks(); m.verified = false;
  m.rpc.mockImplementation(async (name: string, args: { p_alumni_asrama?: string; p_fase_mta?: string | null }) => {
    if (name === "preview_uang_pangkal_spmb") {
      const discount = args.p_alumni_asrama === "asrama" ? (args.p_fase_mta === "sma" ? 5750000 : 7600000) : args.p_alumni_asrama === "non_asrama" ? 4600000 : 0;
      return { data: { siswa_id: "student", sumber_sk: "050/SKep/YAAB/09/2026", bruto_acuan: args.p_fase_mta ? 10000000 : 13100000,
        keringanan_alumni: discount, preview_hash: "fresh-preview", tagihan: null,
        verifikasi: m.verified ? { id: "verified", nominal_bruto: 13100000 } : null,
      }, error: null };
    }
    return { data: { success: true, skipped: false, tagihan_id: "bill", siswa_diskon_id: "discount" }, error: null };
  });
});
afterEach(cleanup);

describe("verifikasi uang pangkal otomatis", () => {
  it("memerlukan pemeriksaan alumni dan konfirmasi; mengirim bruto penuh dan pilihan alumni", async () => {
    mount();
    await screen.findByText(/Acuan SK/);
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "asrama" } });
    await screen.findByText("Rp 7600000");
    expect(screen.getByText("Rp 5500000")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton());
    await vi.waitFor(() => expect(m.rpc).toHaveBeenCalledWith("verifikasi_uang_pangkal_spmb", expect.objectContaining({
      p_siswa_id: "student", p_tahun_akademik_id: "year", p_alumni_asrama: "asrama", p_nominal_bruto: 13100000,
      p_preview_hash: "fresh-preview", p_confirmed: true,
    })));
    expect(m.rpc).not.toHaveBeenCalledWith("putuskan_diskon_siswa", expect.anything());
    await vi.waitFor(() => expect(m.close).toHaveBeenCalled());
  });
  it("bruto khusus membutuhkan alasan dan konfirmasi ulang setelah perubahan", async () => {
    mount("SD");
    await screen.findByText(/Acuan SK/);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Nominal bruto siswa *"), { target: { value: "14000000" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Catatan/), { target: { value: "Sesuai keputusan bruto khusus yayasan" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submitButton()).toBeEnabled();
  });
  it("uang pangkal yang sudah diverifikasi tidak diterbitkan ulang", async () => {
    m.verified = true; mount();
    await screen.findByText(/Uang pangkal sudah diverifikasi/);
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("MTA memerlukan fase masuk, lalu menghitung keringanan setara SMA", async () => {
    mount("MTA");
    expect(m.rpc).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "sma" } });
    await screen.findByText(/Acuan SK/);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "asrama" } });
    await screen.findByText("Rp 5750000");
    expect(screen.getByText("Rp 4250000")).toBeInTheDocument();
  });
});
