import { describe, expect, it } from "vitest";
import { layakTampilDiPencarianPembayaran } from "./pencarianSiswaPembayaran";

const dasar = {
  status: "aktif" as string | null,
  lulusSpmb: false,
  punyaTagihanTerbuka: false,
  includeNonaktifWithOpenBills: true,
  includeCalonLulus: true,
};

describe("layakTampilDiPencarianPembayaran (loket Input Pembayaran)", () => {
  it("siswa aktif selalu tampil, dengan atau tanpa tagihan terbuka", () => {
    expect(layakTampilDiPencarianPembayaran({ ...dasar, status: "aktif" })).toBe(true);
    expect(layakTampilDiPencarianPembayaran({ ...dasar, status: "aktif", punyaTagihanTerbuka: true })).toBe(true);
  });

  it("calon/diterima yang lulus SPMB tampil walau semua tagihannya sudah lunas (kasus Inayah)", () => {
    for (const status of ["calon", "diterima"]) {
      expect(
        layakTampilDiPencarianPembayaran({ ...dasar, status, lulusSpmb: true, punyaTagihanTerbuka: false }),
      ).toBe(true);
    }
  });

  it("calon/diterima yang belum lulus SPMB tetap disembunyikan, ada tagihan atau tidak", () => {
    for (const status of ["calon", "diterima"]) {
      expect(layakTampilDiPencarianPembayaran({ ...dasar, status, lulusSpmb: false })).toBe(false);
      expect(
        layakTampilDiPencarianPembayaran({ ...dasar, status, lulusSpmb: false, punyaTagihanTerbuka: true }),
      ).toBe(false);
    }
  });

  it("keluar/alumni/pindah tetap hanya tampil bila punya tagihan terbuka (aturan lama tidak berubah)", () => {
    for (const status of ["keluar", "alumni", "pindah"]) {
      expect(layakTampilDiPencarianPembayaran({ ...dasar, status, punyaTagihanTerbuka: false })).toBe(false);
      expect(layakTampilDiPencarianPembayaran({ ...dasar, status, punyaTagihanTerbuka: true })).toBe(true);
    }
  });

  it("mode pencarian calon biasa (tanpa flag) tidak menyaring apa pun", () => {
    expect(
      layakTampilDiPencarianPembayaran({
        status: "calon",
        lulusSpmb: false,
        punyaTagihanTerbuka: false,
        includeNonaktifWithOpenBills: false,
        includeCalonLulus: false,
      }),
    ).toBe(true);
  });
});
