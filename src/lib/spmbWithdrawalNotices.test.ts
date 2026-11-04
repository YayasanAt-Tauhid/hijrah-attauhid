import { describe, expect, it } from "vitest";
import { buildSpmbWithdrawalNotices, canWithdrawSpmbRegistration } from "./spmbWithdrawalNotices";

const base = {
  success: true as const,
  tagihan_dibatalkan: 0,
  total_dibayar: 0,
  rincian_dibayar: [] as Array<{ jenis: string; jumlah: number }>,
  perlu_tindak_lanjut_keuangan: false,
  siswa_internal: false,
  peringatan: [] as string[],
};

describe("canWithdrawSpmbRegistration", () => {
  it("hanya admin/admin TU pada calon atau diterima yang belum diaktivasi", () => {
    expect(canWithdrawSpmbRegistration({ role: "admin", status: "calon" })).toBe(true);
    expect(canWithdrawSpmbRegistration({ role: "admin_tu", status: "diterima" })).toBe(true);
    expect(canWithdrawSpmbRegistration({ role: "kepala_sekolah", status: "calon" })).toBe(false);
    expect(canWithdrawSpmbRegistration({ role: "admin_tu", status: "aktif" })).toBe(false);
    expect(canWithdrawSpmbRegistration({ role: "admin_tu", status: "selesai" })).toBe(false);
    expect(canWithdrawSpmbRegistration({ role: "admin_tu", status: "mengundurkan_diri" })).toBe(false);
    expect(canWithdrawSpmbRegistration({ role: "admin_tu", status: "diterima", activated: true })).toBe(false);
    expect(canWithdrawSpmbRegistration({ role: undefined, status: "calon" })).toBe(false);
  });
});

describe("buildSpmbWithdrawalNotices", () => {
  it("melaporkan jumlah tagihan yang dibatalkan tanpa tindak lanjut bila tidak ada uang masuk", () => {
    const notices = buildSpmbWithdrawalNotices("Budi", { ...base, tagihan_dibatalkan: 3 });
    expect(notices.success.title).toBe("Budi ditandai mengundurkan diri");
    expect(notices.success.description).toContain("3 tagihan belum dibayar dibatalkan");
    expect(notices.followUp).toBeNull();
    expect(notices.warnings).toEqual([]);
  });

  it("menjelaskan bahwa tidak ada tagihan yang perlu dibatalkan", () => {
    const notices = buildSpmbWithdrawalNotices("Budi", base);
    expect(notices.success.description).toContain("Tidak ada tagihan belum dibayar");
  });

  it("menampilkan total dan rincian pembayaran yang sudah masuk untuk tindak lanjut keuangan", () => {
    const notices = buildSpmbWithdrawalNotices("Budi", {
      ...base,
      total_dibayar: 5500000,
      rincian_dibayar: [
        { jenis: "Biaya Pendaftaran", jumlah: 500000 },
        { jenis: "Uang Pangkal", jumlah: 5000000 },
      ],
      perlu_tindak_lanjut_keuangan: true,
    });
    expect(notices.followUp?.title).toBe("Perlu tindak lanjut keuangan");
    const text = String(notices.followUp?.description).replace(/\u00a0/g, " ");
    expect(text).toContain("Rp 5.500.000");
    expect(text).toContain("Biaya Pendaftaran Rp 500.000");
    expect(text).toContain("Uang Pangkal Rp 5.000.000");
    expect(text).toContain("tidak dikembalikan otomatis");
  });

  it("pendaftar internal: minta tinjau tagihan lembaga tujuan secara manual dan tegaskan data asal aman", () => {
    const notices = buildSpmbWithdrawalNotices("Siti", { ...base, siswa_internal: true, perlu_tindak_lanjut_keuangan: true });
    expect(notices.success.description).toContain("lembaga asal tidak diubah");
    expect(notices.followUp?.description).toContain("tinjau tagihan lembaga tujuan");
  });

  it("meneruskan peringatan sesi pembayaran", () => {
    const notices = buildSpmbWithdrawalNotices("Budi", { ...base, peringatan: ["Sesi belum bisa ditutup"] });
    expect(notices.warnings).toEqual(["Sesi belum bisa ditutup"]);
  });
});
