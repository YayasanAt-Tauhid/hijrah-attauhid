import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpmbBillingCandidate } from "@/server/spmbBilling";
import { REISSUE_PREVIEW_REASON } from "@/lib/reissueCancelledBill";
const m = vi.hoisted(() => ({ rpc: vi.fn(), close: vi.fn(), ok: vi.fn(), fail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
vi.mock("@/hooks/useKeuangan", () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock("sonner", () => ({ toast: { success: m.ok, error: m.fail } }));
import { DialogTerbitkanUlangTagihan } from "./DialogTerbitkanUlangTagihan";

const siswa = (kode = "SMP") => ({ id: "s1", nama: "Nadhif", target_departemen_kode: kode, tahun_ajaran_id: "ta", status_asrama: "non_asrama" }) as SpmbBillingCandidate;
const sppBill = { id: "b1", jenis_id: "j", nama: "SPP SMP", nominal: 1350000, status: "dibatalkan", periode: "2027-07-01" };
const pangkalBill = { id: "b2", jenis_id: "jp", nama: "UANG PANGKAL SMP", nominal: 13100000, status: "dibatalkan", periode: null };
const sppPreview = { jenis: "spp", tagihan_id: "b1", siswa_id: "s1", periode: "2027-07-01", kategori_lama: "asrama", kategori_baru: "non_asrama",
  nominal_bruto_lama: 1350000, nominal_bruto_baru: 500000, nominal_diskon_baru: 0, nominal_netto_baru: 500000, tarif_lama: { id: "t", nominal: 1350000 }, preview_hash: "h-spp", applied: false };
const pangkalPreview = { jenis: "uang_pangkal", tagihan_id: "b2", siswa_id: "s1", program_baru: "non_asrama", nominal_bruto_lama: 13100000,
  nominal_bruto_baru: 10100000, bruto_acuan: 10100000, keringanan_alumni: 0, verifikasi_lama_id: "v1", tarif_lama: { id: "t", nominal: 13100000 }, preview_hash: "h-pangkal", applied: false };

function mount(kind: "spp" | "uang_pangkal", s = siswa()) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DialogTerbitkanUlangTagihan siswa={s} bill={kind === "spp" ? sppBill : pangkalBill} kind={kind} onClose={m.close} />
  </QueryClientProvider>);
}
const respond = (preview: object) => m.rpc.mockImplementation(async (_n: string, p: { p_apply: boolean }) =>
  p.p_apply ? { data: { ...preview, applied: true, riwayat_id: "r1" }, error: null } : { data: preview, error: null });
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const apply = () => screen.getByRole("button", { name: "Terbitkan Ulang" });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("dialog terbitkan ulang tagihan SPP", () => {
  it("baru meminta pratinjau setelah nominal diisi, memakai alasan baku dan tanpa hash", async () => {
    respond(sppPreview); mount("spp");
    expect(m.rpc).not.toHaveBeenCalled();
    fill("Nominal bruto SPP baru", "500000");
    await screen.findByText("Non Asrama");
    expect(m.rpc).toHaveBeenCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({
      p_tagihan_id: "b1", p_nominal_bruto: 500000, p_apply: false, p_preview_hash: null, p_alasan: REISSUE_PREVIEW_REASON }));
    expect(screen.getByText("Asrama")).toBeInTheDocument();
    expect(screen.getAllByText("Rp 1350000").length).toBeGreaterThan(0);
  });
  it("tombol terkunci sampai alasan 10 karakter dan pemeriksaan dicentang, lalu menerapkan dengan hash pratinjau", async () => {
    respond(sppPreview); mount("spp"); fill("Nominal bruto SPP baru", "500000");
    await screen.findByText("Non Asrama");
    expect(apply()).toBeDisabled();
    fill("Alasan penerbitan ulang", "pindah"); fireEvent.click(screen.getByRole("checkbox", { name: /^Saya sudah memeriksa/ }));
    expect(apply()).toBeDisabled();
    fill("Alasan penerbitan ulang", "  pindah asrama ke non asrama  ");
    expect(apply()).toBeEnabled();
    fireEvent.click(apply());
    await waitFor(() => expect(m.close).toHaveBeenCalled());
    expect(m.rpc).toHaveBeenLastCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({
      p_apply: true, p_preview_hash: "h-spp", p_alasan: "pindah asrama ke non asrama", p_nominal_bruto: 500000 }));
    expect(m.ok).toHaveBeenCalled();
  });
  it("kegagalan RPC ditampilkan, dialog tetap terbuka, dan pemeriksaan harus diulang", async () => {
    m.rpc.mockImplementation(async (_n: string, p: { p_apply: boolean }) =>
      p.p_apply ? { data: null, error: { message: "Data berubah sejak pratinjau; muat pratinjau ulang" } } : { data: sppPreview, error: null });
    mount("spp"); fill("Nominal bruto SPP baru", "500000"); await screen.findByText("Non Asrama");
    fill("Alasan penerbitan ulang", "pindah asrama ke non asrama"); fireEvent.click(screen.getByRole("checkbox", { name: /^Saya sudah memeriksa/ }));
    fireEvent.click(apply());
    await waitFor(() => expect(m.fail).toHaveBeenCalled());
    expect(m.close).not.toHaveBeenCalled();
    await waitFor(() => expect(apply()).toBeDisabled());
  });
  it("menampilkan pesan kesalahan pratinjau dari server", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "Hanya SPP bulan mendatang yang dapat diterbitkan ulang" } });
    mount("spp"); fill("Nominal bruto SPP baru", "500000");
    expect(await screen.findByText(/Hanya SPP bulan mendatang/)).toBeInTheDocument();
    expect(apply()).toBeDisabled();
  });
});

describe("dialog terbitkan ulang uang pangkal", () => {
  it("meminta pratinjau langsung (nominal mengikuti SK) lalu menerapkan dengan nominal kosong", async () => {
    respond(pangkalPreview); mount("uang_pangkal");
    await screen.findByText("Program uang pangkal");
    expect(m.rpc).toHaveBeenCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({ p_nominal_bruto: null, p_alumni_asrama: "none", p_apply: false }));
    expect(screen.getByText("Ada (diarsipkan)")).toBeInTheDocument();
    fill("Alasan penerbitan ulang", "pindah asrama ke non asrama"); fireEvent.click(screen.getByRole("checkbox", { name: /^Saya sudah memeriksa/ }));
    fireEvent.click(apply());
    await waitFor(() => expect(m.close).toHaveBeenCalled());
    expect(m.rpc).toHaveBeenLastCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({ p_apply: true, p_preview_hash: "h-pangkal", p_nominal_bruto: null }));
  });
  it("nominal berbeda dari SK menuntut catatan 10 karakter", async () => {
    respond(pangkalPreview); mount("uang_pangkal"); await screen.findByText("Program uang pangkal");
    fill("Nominal bruto khusus", "9000000"); await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({ p_nominal_bruto: 9000000 })));
    fill("Alasan penerbitan ulang", "pindah asrama ke non asrama"); fireEvent.click(screen.getByRole("checkbox", { name: /^Saya sudah memeriksa/ }));
    expect(apply()).toBeDisabled();
    fill("Catatan nominal khusus", "disetujui sekretaris yayasan");
    await waitFor(() => expect(apply()).toBeEnabled());
  });
  it("SMA wajib memilih status alumni sebelum pratinjau", async () => {
    respond(pangkalPreview); mount("uang_pangkal", siswa("SMA"));
    expect(m.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Status alumni"), { target: { value: "none" } });
    await screen.findByText("Program uang pangkal");
    expect(m.rpc).toHaveBeenCalledWith("terbitkan_ulang_tagihan_batal", expect.objectContaining({ p_alumni_asrama: "none" }));
  });
});
