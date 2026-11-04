import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Logika bersama untuk tombol "Salin tautan pemulihan pembayaran" di daftar
// SPMB dan halaman detail pendaftaran.
const mocks = vi.hoisted(() => ({
  getLink: vi.fn(),
  writeText: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/pmb", () => ({ spmbAdminGetRecoveryLink: mocks.getLink }));

import { copySpmbRecoveryLink } from "./spmbRecoveryLink";

const DETAIL_ID = "11111111-1111-4111-8111-111111111111";
const LINK = "https://app.hijrah-attauhid.or.id/spmb#registration=tok";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLink.mockResolvedValue({ success: true, url: LINK });
  mocks.writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
});
afterEach(() => vi.unstubAllGlobals());

describe("copySpmbRecoveryLink", () => {
  it("meminta tautan ke server, menyalinnya, lalu memberi tahu staf", async () => {
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(mocks.getLink).toHaveBeenCalledWith({ data: { detail_id: DETAIL_ID } });
    expect(mocks.writeText).toHaveBeenCalledWith(LINK);
    expect(mocks.toast.success).toHaveBeenCalledWith("Tautan pemulihan disalin", expect.anything());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("menampilkan tautan untuk disalin manual bila clipboard ditolak browser", async () => {
    mocks.writeText.mockRejectedValue(new Error("NotAllowedError"));
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalledWith(
      "Salin tautan ini secara manual",
      expect.objectContaining({ description: LINK }),
    );
  });

  it("menampilkan tautan manual bila API clipboard tidak tersedia", async () => {
    vi.stubGlobal("navigator", {});
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(mocks.toast.info).toHaveBeenCalledWith(
      "Salin tautan ini secara manual",
      expect.objectContaining({ description: LINK }),
    );
  });

  it("menampilkan galat dari server (mis. di luar kewenangan lembaga) tanpa menyalin apa pun", async () => {
    mocks.getLink.mockRejectedValue(new Error("Forbidden: lembaga di luar kewenangan Admin TU"));
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(mocks.writeText).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Gagal membuat tautan pemulihan",
      expect.objectContaining({ description: "Forbidden: lembaga di luar kewenangan Admin TU" }),
    );
  });

  it("memakai pesan umum untuk galat yang bukan Error", async () => {
    mocks.getLink.mockRejectedValue("boom");
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Gagal membuat tautan pemulihan",
      expect.objectContaining({ description: "Terjadi kesalahan teknis" }),
    );
  });

  it("tidak pernah menaruh token di pesan sukses", async () => {
    await copySpmbRecoveryLink(DETAIL_ID);
    expect(JSON.stringify(mocks.toast.success.mock.calls)).not.toContain("tok");
  });
});
