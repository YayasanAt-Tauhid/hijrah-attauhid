import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiswaSpmbDetail } from "./SiswaSpmbDetail";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/useAkademikData", () => ({ useTahunAjaran: () => ({ data: [] }) }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/server/spmbDocuments", () => ({ spmbGetDocumentUrl: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));

const detail = { siswa_id: "student", nama_ayah: "Ayah", no_kk: "1234567890123456", dokumen_kk_path: "student/kk.pdf", kategori: "MURID BARU" };
function initialState() {
  return {
    siswa_id: "student", status: "belum_verifikasi", version: "reviewed-v1", can_verify: true,
    checklist: { nama: true }, required_total: 3, required_checked: 1,
    requirements: [
      { key: "nama", label: "Nama Lengkap", kind: "field", required: true, valid: true, display_value: "Siswa Uji" },
      { key: "telepon", label: "No. HP", kind: "field", required: true, valid: true, display_value: "08123456789" },
      { key: "no_kk", label: "No. KK", kind: "field", required: true, valid: true, display_value: detail.no_kk },
      { key: "nama_ayah", label: "Nama Ayah", kind: "field", required: false, valid: true, display_value: "Ayah" },
      { key: "alamat_ayah", label: "Alamat Ayah", kind: "field", required: false, valid: true, display_value: "Opsional — belum diisi" },
      { key: "dokumen_kk_path", label: "KK", kind: "document", required: true, valid: true, path: detail.dokumen_kk_path },
      { key: "dokumen_akta_path", label: "Akta", kind: "document", required: false, valid: false },
    ],
  };
}
let state = initialState();
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SiswaSpmbDetail detail={detail} /></QueryClientProvider>);
}
function checkbox(label: string) {
  const row = screen.getAllByText(label, { exact: true })[0].closest("div.grid")!;
  return within(row as HTMLElement).getByRole("checkbox");
}
beforeEach(() => {
  state = initialState();
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (name: string, args: { p_changes?: Record<string, boolean> }) => {
    if (name === "spmb_set_field_verifications") state = { ...state, checklist: { ...state.checklist, ...args.p_changes } };
    return { data: structuredClone(state), error: null };
  });
});
afterEach(cleanup);

it("menampilkan checklist tersimpan, wajib dan opsional di setiap isian yang didukung", async () => {
  mount();
  await screen.findByText("Siswa Uji");
  expect(checkbox("Nama Lengkap")).toBeChecked();
  expect(checkbox("No. HP")).not.toBeChecked();
  expect(within(checkbox("No. HP").parentElement!).getByText("*")).toBeInTheDocument();
  expect(within(checkbox("Nama Ayah").parentElement!).getByText("Sudah diperiksa (opsional)")).toBeInTheDocument();
  expect(screen.getByText(/Checklist tersimpan otomatis dan sama dengan Edit Siswa/)).toBeInTheDocument();
});

it("menyimpan hanya isian yang diklik dengan versi yang diperiksa dan bertahan setelah halaman dibuka lagi", async () => {
  const view = mount();
  await screen.findByText("Siswa Uji");
  fireEvent.click(checkbox("No. HP"));
  await waitFor(() => expect(checkbox("No. HP")).toBeChecked());
  expect(mocks.rpc).toHaveBeenCalledWith("spmb_set_field_verifications", {
    p_siswa_id: "student", p_changes: { telepon: true }, p_version: "reviewed-v1",
  });
  expect(checkbox("Nama Lengkap")).toBeChecked();
  view.unmount();
  mount();
  await screen.findByText("Siswa Uji");
  expect(checkbox("No. HP")).toBeChecked();
});

it("dapat membatalkan centang tanpa mengubah isian lainnya", async () => {
  mount();
  await screen.findByText("Siswa Uji");
  fireEvent.click(checkbox("Nama Lengkap"));
  await waitFor(() => expect(checkbox("Nama Lengkap")).not.toBeChecked());
  expect(state.checklist.nama).toBe(false);
});

it("membatasi checklist kosong dan dokumen yang belum diunggah", async () => {
  mount();
  await screen.findByText("Siswa Uji");
  expect(checkbox("Alamat")).toBeDisabled();
  const doc = screen.getByText("Akta Kelahiran").parentElement!;
  expect(within(doc).getByRole("checkbox")).toBeDisabled();
  const kk = screen.getByText("Kartu Keluarga").parentElement!;
  expect(within(kk).getByRole("checkbox")).toBeEnabled();
});

it("pengguna tanpa izin hanya dapat melihat checklist", async () => {
  state.can_verify = false;
  mount();
  await screen.findByText("Siswa Uji");
  expect(screen.getAllByRole("checkbox").every((item) => item.hasAttribute("disabled"))).toBe(true);
  fireEvent.click(checkbox("No. HP"));
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "spmb_set_field_verifications")).toHaveLength(0);
});

it("penolakan versi data menampilkan kesalahan dan memuat ulang tanpa centang palsu", async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === "spmb_set_field_verifications"
    ? { data: null, error: { message: "Data berubah. Muat ulang halaman" } }
    : { data: structuredClone(state), error: null });
  mount();
  await screen.findByText("Siswa Uji");
  fireEvent.click(checkbox("No. HP"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Gagal menyimpan checklist", { description: "Data berubah. Muat ulang halaman" }));
  expect(checkbox("No. HP")).not.toBeChecked();
  await waitFor(() => expect(mocks.rpc.mock.calls.filter(([name]) => name === "spmb_verification_state").length).toBeGreaterThan(1));
});

it("mencegah penyimpanan tumpang tindih saat permintaan belum selesai", async () => {
  let complete!: () => void;
  mocks.rpc.mockImplementation(async (name: string, args: { p_changes?: Record<string, boolean> }) => {
    if (name === "spmb_set_field_verifications") {
      await new Promise<void>((resolve) => { complete = resolve; });
      state = { ...state, checklist: { ...state.checklist, ...args.p_changes } };
    }
    return { data: structuredClone(state), error: null };
  });
  mount();
  await screen.findByText("Siswa Uji");
  fireEvent.click(checkbox("No. HP"));
  expect(checkbox("Nama Lengkap")).toBeDisabled();
  fireEvent.click(checkbox("Nama Lengkap"));
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "spmb_set_field_verifications")).toHaveLength(1);
  complete();
  await waitFor(() => expect(checkbox("No. HP")).toBeChecked());
});

it("menampilkan kegagalan muat checklist dan tombol coba lagi", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "Network error" } });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Checklist tidak dapat dimuat");
  mocks.rpc.mockResolvedValue({ data: structuredClone(state), error: null });
  fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
  expect(await screen.findByText("Siswa Uji")).toBeInTheDocument();
});
