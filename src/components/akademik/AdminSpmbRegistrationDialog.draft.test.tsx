import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveSpmbAdminDraft, loadSpmbAdminDraft } from "@/lib/spmbAdminDraft";

const mocks = vi.hoisted(() => ({
  user: { id: "u1", email: "admin@at-tauhid.id", identities: [] as unknown[] },
  navigate: vi.fn(),
  spmbAdminDaftar: vi.fn(async () => ({ siswa_id: "s-1", inputer_nama: "Admin TU" })),
  pmbCreateDocumentUpload: vi.fn(async ({ data }: { data: { kind: string } }) => ({ path: `dok/${data.kind}`, token: "tok" })),
  pmbCurrentRegistrant: vi.fn(async () => ({ nama: "Admin TU" })),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/server/pmb", () => ({
  spmbAdminDaftar: mocks.spmbAdminDaftar,
  pmbCreateDocumentUpload: mocks.pmbCreateDocumentUpload,
  pmbCurrentRegistrant: mocks.pmbCurrentRegistrant,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: vi.fn(async () => ({ error: null })) }) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminSpmbRegistrationDialog } from "./AdminSpmbRegistrationDialog";
import { SPMB_TARGET_ACADEMIC_YEAR, SPMB_TARGET_COHORT } from "@/lib/spmbPolicy";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

const departments = [{ id: "d-sd", nama: "SD", kode: "SD", psb_dibuka: true }];
const cohorts = [{ id: "c-1", nama: SPMB_TARGET_COHORT, departemen_id: "d-sd", aktif: true }];
const academicYears = [{ id: "y-1", nama: SPMB_TARGET_ACADEMIC_YEAR }];

const validDraft: Record<string, string> = {
  nama: "Aisyah Putri", jenis_kelamin: "P", tempat_lahir: "Pangkalpinang", tanggal_lahir: "2020-01-01",
  alamat: "Jl. Mawar No. 1", telepon: "081234567890", email: "", nisn: "", departemen_id: "d-sd",
  jenis_pendaftaran: "baru", kelas_terakhir: "", alasan_pindah: "", nik: "3100000000000001", no_kk: "3100000000000002",
  kategori: "MURID BARU", status_asrama: "", anak_ke: "1", jumlah_bersaudara: "2", penyakit_pernah_diderita: "",
  jarak_rumah_km: "2", waktu_perjalanan_menit: "10", transportasi: "Jalan Kaki",
  nama_ayah: "Budi", nik_ayah: "3100000000000003", tempat_lahir_ayah: "Bangka", tanggal_lahir_ayah: "1985-01-01",
  pendidikan_ayah: "S1", pekerjaan_ayah: "WIRASWASTA", penghasilan_ayah: "5000000", telepon_ayah: "081234567891", alamat_ayah: "Jl. Mawar No. 1",
  nama_ibu: "Siti", nik_ibu: "3100000000000004", tempat_lahir_ibu: "Bangka", tanggal_lahir_ibu: "1987-01-01",
  pendidikan_ibu: "S1", pekerjaan_ibu: "KARYAWAN SWASTA", penghasilan_ibu: "2000000", telepon_ibu: "081234567892", alamat_ibu: "Jl. Mawar No. 1",
  kemampuan_iqro: "3", membaca_latin: "BAIK", menulis_latin: "BAIK", hafalan_quran: "1",
};

const FORM_INTRO = "Pendaftaran offline oleh Admin/TU dengan data dan aturan yang sama seperti /spmb.";
const renderDialog = (onRegistered = vi.fn()) =>
  render(<AdminSpmbRegistrationDialog departments={departments} cohorts={cohorts} academicYears={academicYears} onRegistered={onRegistered} />);
const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /Daftarkan Calon Murid/ }));
const field = (label: string) => screen.getByText(label).parentElement!.querySelector("input,textarea") as HTMLInputElement;
const pressEscape = () => fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
const typeNama = (value: string) => fireEvent.change(field("Nama Lengkap *"), { target: { value } });
const closeAfterConfirm = async () => {
  pressEscape();
  fireEvent.click(await screen.findByRole("button", { name: "Ya, Tutup" }));
  await waitFor(() => expect(screen.queryByText(FORM_INTRO)).not.toBeInTheDocument());
};

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe("draf pendaftaran calon murid oleh admin/TU", () => {
  it("menyimpan isian secara otomatis sebagai draf setelah jeda singkat", async () => {
    renderDialog();
    openDialog();
    typeNama("Aisyah");
    await waitFor(() => expect(loadSpmbAdminDraft("u1")?.form.nama).toBe("Aisyah"), { timeout: 2000 });
  });

  it("tidak meminta konfirmasi bila formulir belum diisi", async () => {
    renderDialog();
    openDialog();
    pressEscape();
    await waitFor(() => expect(screen.queryByText(FORM_INTRO)).not.toBeInTheDocument());
    expect(screen.queryByText("Tutup formulir pendaftaran?")).not.toBeInTheDocument();
  });

  it("meminta konfirmasi saat formulir terisi; Lanjut Mengisi menjaga formulir tetap terbuka", async () => {
    renderDialog();
    openDialog();
    typeNama("Aisyah");
    pressEscape();
    expect(await screen.findByText("Tutup formulir pendaftaran?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lanjut Mengisi" }));
    await waitFor(() => expect(screen.queryByText("Tutup formulir pendaftaran?")).not.toBeInTheDocument());
    expect(screen.getByText(FORM_INTRO)).toBeInTheDocument();
    expect(field("Nama Lengkap *").value).toBe("Aisyah");
  });

  it("tombol Batal juga meminta konfirmasi saat formulir terisi", async () => {
    renderDialog();
    openDialog();
    typeNama("Aisyah");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(await screen.findByText("Tutup formulir pendaftaran?")).toBeInTheDocument();
  });

  it("setelah tertutup, membuka lagi menawarkan draf dan Lanjutkan memulihkan isian", async () => {
    renderDialog();
    openDialog();
    typeNama("Aisyah");
    await waitFor(() => expect(loadSpmbAdminDraft("u1")).not.toBeNull(), { timeout: 2000 });
    await closeAfterConfirm();

    openDialog();
    expect(await screen.findByText("Ada draf pendaftaran yang belum disimpan")).toBeInTheDocument();
    expect(field("Nama Lengkap *").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await waitFor(() => expect(field("Nama Lengkap *").value).toBe("Aisyah"));
    expect(screen.queryByText("Ada draf pendaftaran yang belum disimpan")).not.toBeInTheDocument();
  });

  it("Buang Draf menghapus draf dan draf tidak tertimpa formulir kosong selama banner tampil", async () => {
    saveSpmbAdminDraft("u1", { ...validDraft, nama: "Aisyah" });
    renderDialog();
    openDialog();
    expect(await screen.findByText("Ada draf pendaftaran yang belum disimpan")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(loadSpmbAdminDraft("u1")?.form.nama).toBe("Aisyah");

    fireEvent.click(screen.getByRole("button", { name: "Buang Draf" }));
    await waitFor(() => expect(screen.queryByText("Ada draf pendaftaran yang belum disimpan")).not.toBeInTheDocument());
    expect(loadSpmbAdminDraft("u1")).toBeNull();
    expect(field("Nama Lengkap *").value).toBe("");
  });

  it("draf akun admin lain tidak ditawarkan", async () => {
    saveSpmbAdminDraft("admin-lain", { ...validDraft, nama: "Bukan Milik u1" });
    renderDialog();
    openDialog();
    await screen.findByText(FORM_INTRO);
    expect(screen.queryByText("Ada draf pendaftaran yang belum disimpan")).not.toBeInTheDocument();
  });

  it("memperingatkan sebelum tab ditutup atau di-refresh hanya saat formulir terbuka dan terisi", async () => {
    renderDialog();
    openDialog();
    await screen.findByText(FORM_INTRO);
    const pristine = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pristine);
    expect(pristine.defaultPrevented).toBe(false);

    typeNama("Aisyah");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    await closeAfterConfirm();
    const closed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closed);
    expect(closed.defaultPrevented).toBe(false);
  });

  it("menghapus draf setelah pendaftaran berhasil disimpan", async () => {
    saveSpmbAdminDraft("u1", validDraft);
    const onRegistered = vi.fn();
    renderDialog(onRegistered);
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutkan" }));
    await waitFor(() => expect(field("Nama Lengkap *").value).toBe("Aisyah Putri"));

    const pick = (label: string, name: string) => {
      const input = screen.getByText(label).closest("div.space-y-3")!.querySelector("input[type=file]") as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "application/pdf" })] } });
    };
    pick("Kartu Keluarga *", "kk.pdf");
    pick("Akta Kelahiran *", "akta.pdf");

    fireEvent.click(screen.getByRole("button", { name: /Simpan Pendaftaran/ }));
    expect(await screen.findByText("Pendaftaran SPMB Berhasil")).toBeInTheDocument();
    expect(mocks.spmbAdminDaftar).toHaveBeenCalledWith({ data: expect.objectContaining({ nama: "Aisyah Putri", dokumen_kk_path: "dok/kk" }) });
    expect(onRegistered).toHaveBeenCalledWith("s-1");
    expect(loadSpmbAdminDraft("u1")).toBeNull();
  });
});
