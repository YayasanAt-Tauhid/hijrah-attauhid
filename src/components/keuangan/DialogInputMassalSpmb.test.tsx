import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
const m = vi.hoisted(() => ({ rpc: vi.fn(), candidates: vi.fn(), close: vi.fn(), keringanan: vi.fn() }));
vi.mock("@/server/spmbBilling", () => ({ getSpmbBillingCandidates: m.candidates }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
import { DialogInputMassalSpmb } from "./DialogInputMassalSpmb";

function siswa(id: string, extra: Partial<SpmbBillingCandidate> = {}) {
  return { id, nama: id, nis: id, target_departemen_id: "smp", target_departemen_kode: "SMP", tahun_ajaran_id: "year",
    tahun_ajaran_mulai: "2027-07-01", tahun_ajaran_selesai: "2028-06-30", tahun_ajaran_nama: "2027/2028",
    ready_for_billing: true, ready_for_spp: false, status_asrama: "asrama", rencana_spp: null,
    spp_awal: { tagihan: [] }, ...extra } as SpmbBillingCandidate;
}
function mount(students = [siswa("Ani"), siswa("Budi")]) {
  m.candidates.mockResolvedValue({ items: students });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DialogInputMassalSpmb siswa={students} jenis={[{ id: "spp", nama: "SPP SMP", tipe: "bulanan", departemen_id: "smp", nominal: 500000 }]}
      tahunBuku={[]} onClose={m.close} onKeringanan={m.keringanan} />
  </QueryClientProvider>);
}
const review = () => fireEvent.click(screen.getByRole("button", { name: "Periksa Ringkasan" }));
const save = () => screen.getByRole("button", { name: "Simpan Semua" });
const confirm = () => fireEvent.click(screen.getByRole("checkbox", { name: /^Saya sudah memeriksa/ }));
beforeEach(() => { vi.clearAllMocks(); m.rpc.mockResolvedValue({ data: { generated: 1 }, error: null }); });
afterEach(cleanup);

describe("dialog input massal", () => {
  it("memerlukan pemeriksaan dan konfirmasi; nominal per siswa tetap berbeda; klik ganda tidak menggandakan batch", async () => {
    mount(); expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nominal SPP Budi"), { target: { value: "350000" } });
    review(); await screen.findAllByText("Siap disimpan"); expect(m.rpc).not.toHaveBeenCalled(); expect(save()).toBeDisabled();
    confirm(); const button = save(); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/Proses selesai: 2 tindakan berhasil/);
    expect(m.rpc).toHaveBeenCalledTimes(2);
    expect(m.rpc).toHaveBeenCalledWith("terbitkan_spp_awal_spmb", expect.objectContaining({ p_siswa_id: "Ani", p_nominal: 500000 }));
    expect(m.rpc).toHaveBeenCalledWith("terbitkan_spp_awal_spmb", expect.objectContaining({ p_siswa_id: "Budi", p_nominal: 350000 }));
    expect(screen.getByLabelText("Nominal SPP Budi")).toBeDisabled();
  });
  it("perubahan isian membatalkan ringkasan dan konfirmasi sebelumnya", async () => {
    mount(); review(); await screen.findAllByText("Siap disimpan"); confirm(); expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Bulan mulai Ani"), { target: { value: "2027-08-01" } });
    expect(save()).toBeDisabled(); expect(screen.queryByRole("checkbox", { name: /^Saya sudah/ })).not.toBeInTheDocument();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("menerapkan nilai bersama lalu mengizinkan pengecualian per siswa", async () => {
    mount(); fireEvent.change(screen.getByLabelText("Nominal SPP bersama"), { target: { value: "600000" } });
    fireEvent.change(screen.getByLabelText("Bulan mulai bersama"), { target: { value: "2027-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Terapkan ke semua baris" }));
    expect(screen.getByLabelText("Nominal SPP Ani")).toHaveValue("600.000");
    expect(screen.getByLabelText("Bulan mulai Budi")).toHaveValue("2027-08-01");
    fireEvent.change(screen.getByLabelText("Nominal SPP Ani"), { target: { value: "400000" } });
    expect(screen.getByLabelText("Nominal SPP Budi")).toHaveValue("600.000");
  });
  it("menampilkan sukses parsial dan hanya mempersiapkan tindakan gagal untuk percobaan ulang", async () => {
    mount(); m.rpc.mockImplementation(async (_name, args) => args.p_siswa_id === "Ani"
      ? { data: null, error: { message: "Periode pernah dibatalkan" } } : { data: { generated: 1 }, error: null });
    review(); await screen.findAllByText("Siap disimpan"); confirm(); fireEvent.click(save());
    await screen.findByText(/Proses selesai: 1 tindakan berhasil, 0 dilewati, 1 gagal/);
    expect(screen.getByText("Periode pernah dibatalkan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Periksa Ulang yang Gagal" }));
    expect(screen.queryByLabelText("Nominal SPP Budi")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nominal SPP Ani")).toBeEnabled(); expect(save()).toBeDisabled();
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it("perubahan target sejak pemeriksaan mencegah penulisan dan menunjukkan baris gagal", async () => {
    mount([siswa("Ani")]); review(); await screen.findByText("Siap disimpan"); confirm();
    m.candidates.mockResolvedValue({ items: [siswa("Ani", { target_departemen_id: "sma" })] });
    fireEvent.click(save()); await screen.findByText(/Data\/kesiapan siswa berubah/); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("membuka alur keringanan siswa tujuan dan membatalkan ringkasan sebelumnya", async () => {
    mount(); review(); await screen.findAllByText("Siap disimpan"); confirm();
    const row = screen.getByRole("row", { name: /NIS Ani/ });
    fireEvent.click(within(row).getByRole("button", { name: "Input Keringanan" }));
    expect(m.keringanan).toHaveBeenCalledWith(expect.objectContaining({ id: "Ani", target_departemen_id: "smp" }));
    expect(save()).toBeDisabled();
  });
});
