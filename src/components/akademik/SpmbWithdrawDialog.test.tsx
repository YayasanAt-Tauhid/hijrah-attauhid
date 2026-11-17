import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  withdraw: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/spmbWithdrawal", () => ({ spmbWithdrawRegistration: mocks.withdraw }));
// Upload ke storage diuji terpisah; di sini hanya kontrak props dengan dialog.
vi.mock("./SpmbDocumentUpload", () => ({
  SpmbDocumentUpload: (props: {
    kind: string; label: string; value?: string;
    onChange: (path: string) => void; onBusy: (busy: boolean) => void;
  }) => (
    <div>
      <span>{props.label}</span>
      <span data-testid="bukti-kind">{props.kind}</span>
      <span data-testid="bukti-value">{props.value || ""}</span>
      <button type="button" onClick={() => props.onChange("mundur/44444444-4444-4444-8444-444444444444.pdf")}>Pilih bukti (uji)</button>
      <button type="button" onClick={() => props.onBusy(true)}>Mulai unggah (uji)</button>
      <button type="button" onClick={() => props.onBusy(false)}>Selesai unggah (uji)</button>
    </div>
  ),
}));

import { SpmbWithdrawDialog } from "./SpmbWithdrawDialog";

const RESULT = {
  success: true,
  tagihan_dibatalkan: 2,
  total_dibayar: 0,
  rincian_dibayar: [],
  perlu_tindak_lanjut_keuangan: false,
  siswa_internal: false,
  peringatan: [],
};

function setup(props: Partial<React.ComponentProps<typeof SpmbWithdrawDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onWithdrawn = vi.fn();
  render(
    <SpmbWithdrawDialog
      open
      onOpenChange={onOpenChange}
      detailId="detail-1"
      nama="Budi"
      internal={false}
      onWithdrawn={onWithdrawn}
      {...props}
    />,
  );
  return { onOpenChange, onWithdrawn };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withdraw.mockResolvedValue(RESULT);
});
afterEach(cleanup);

describe("SpmbWithdrawDialog", () => {
  it("menonaktifkan tombol konfirmasi sampai alasan minimal 5 karakter DAN bukti orang tua diunggah", () => {
    setup();
    const button = screen.getByRole("button", { name: "Tandai mengundurkan diri" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Pilih bukti (uji)" }));
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "Pindah sekolah lain" } });
    expect(button).toBeEnabled();
  });

  it("tidak bisa dikirim tanpa bukti walau alasan dan tanggal sudah valid", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "Pindah sekolah lain" } });
    expect(screen.getByRole("button", { name: "Tandai mengundurkan diri" })).toBeDisabled();
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });

  it("menampilkan field bukti dari orang tua bertanda wajib dengan jenis upload 'mundur'", () => {
    setup();
    expect(document.body.textContent).toContain("Bukti dari orang tua *");
    expect(screen.getByTestId("bukti-kind").textContent).toBe("mundur");
  });

  it("menonaktifkan tombol selama upload bukti masih berjalan", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "Pindah sekolah lain" } });
    fireEvent.click(screen.getByRole("button", { name: "Pilih bukti (uji)" }));
    const button = screen.getByRole("button", { name: "Tandai mengundurkan diri" });
    expect(button).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mulai unggah (uji)" }));
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Selesai unggah (uji)" }));
    expect(button).toBeEnabled();
  });

  it("mengirim detail, alasan, dan tanggal efektif lalu memberi tahu hasilnya", async () => {
    const { onOpenChange, onWithdrawn } = setup();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "  Pindah sekolah lain  " } });
    fireEvent.change(screen.getByLabelText(/Tanggal efektif/), { target: { value: "2026-11-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Pilih bukti (uji)" }));
    fireEvent.click(screen.getByRole("button", { name: "Tandai mengundurkan diri" }));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(1));
    expect(mocks.withdraw).toHaveBeenCalledWith({
      data: {
        detail_id: "detail-1",
        alasan: "Pindah sekolah lain",
        tanggal_efektif: "2026-11-05",
        bukti_path: "mundur/44444444-4444-4444-8444-444444444444.pdf",
      },
    });
    await waitFor(() => expect(onWithdrawn).toHaveBeenCalled());
    expect(mocks.toast.success).toHaveBeenCalledWith("Budi ditandai mengundurkan diri", expect.anything());
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("menampilkan peringatan tindak lanjut keuangan dan peringatan sesi bila ada", async () => {
    mocks.withdraw.mockResolvedValue({
      ...RESULT,
      total_dibayar: 500000,
      rincian_dibayar: [{ jenis: "Biaya Pendaftaran", jumlah: 500000 }],
      perlu_tindak_lanjut_keuangan: true,
      peringatan: ["Sesi belum bisa ditutup"],
    });
    setup();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "Pindah sekolah lain" } });
    fireEvent.click(screen.getByRole("button", { name: "Pilih bukti (uji)" }));
    fireEvent.click(screen.getByRole("button", { name: "Tandai mengundurkan diri" }));
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith("Perlu tindak lanjut keuangan", expect.anything()));
    expect(mocks.toast.warning).toHaveBeenCalledWith("Sesi belum bisa ditutup");
  });

  it("tetap terbuka dan menampilkan galat bila server menolak", async () => {
    mocks.withdraw.mockRejectedValue(new Error('Transaksi ditolak: periode "2026" sudah ditutup buku.'));
    const { onOpenChange, onWithdrawn } = setup();
    fireEvent.change(screen.getByLabelText(/Alasan/), { target: { value: "Pindah sekolah lain" } });
    fireEvent.click(screen.getByRole("button", { name: "Pilih bukti (uji)" }));
    fireEvent.click(screen.getByRole("button", { name: "Tandai mengundurkan diri" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      "Gagal menandai mengundurkan diri",
      expect.objectContaining({ description: expect.stringContaining("ditutup buku") }),
    ));
    expect(onWithdrawn).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("menjelaskan dampak: tautan mati, NIS tidak dipakai ulang, tidak ada refund otomatis", () => {
    setup();
    const text = document.body.textContent || "";
    expect(text).toContain("Tautan pembayaran akan dimatikan");
    expect(text).toContain("NIS yang sudah terbit tidak dipakai ulang");
    expect(text).toContain("tidak dikembalikan otomatis");
  });

  it("untuk pendaftar internal menjelaskan bahwa data lembaga asal tidak diubah", () => {
    setup({ internal: true });
    expect(document.body.textContent).toContain("lembaga asal tidak diubah");
  });
});
