import { describe, expect, it } from "vitest";
import {
  POS_ISAK35_BY_JENIS,
  defaultPosIsak35,
  isAkunKas,
  posAfterJenisChange,
  posIsak35Label,
  posIsak35Options,
} from "./posIsak35";

describe("pos ISAK 35 untuk akun rekening baru", () => {
  it("memberi nilai awal sesuai jenis akun, memakai nilai yang sudah dipakai di produksi", () => {
    expect(defaultPosIsak35("aset")).toBe("aset_lancar");
    expect(defaultPosIsak35("liabilitas")).toBe("kewajiban_jangka_pendek");
    expect(defaultPosIsak35("ekuitas")).toBe("aset_neto_tidak_terikat");
    expect(defaultPosIsak35("pendapatan")).toBe("pendapatan_tidak_terikat");
    expect(defaultPosIsak35("beban")).toBe("beban_program");
    expect(defaultPosIsak35("tidak-dikenal")).toBe("");
  });

  it("nilai awal selalu termasuk dalam pilihan jenis yang sama", () => {
    for (const jenis of Object.keys(POS_ISAK35_BY_JENIS)) {
      expect(posIsak35Options(jenis).map((o) => o.value)).toContain(defaultPosIsak35(jenis));
    }
  });

  it("mempertahankan nilai lama di luar daftar agar edit akun lama tidak mengubahnya diam-diam", () => {
    const options = posIsak35Options("beban", "beban_terbatas");
    expect(options.map((o) => o.value)).toEqual(["beban_program", "beban_penunjang", "beban_terbatas"]);
    expect(posIsak35Options("beban", "beban_program")).toHaveLength(2);
    expect(posIsak35Options("beban", null)).toHaveLength(2);
  });

  it("saat jenis diganti: pos yang masih cocok dipertahankan, yang tidak cocok diganti nilai awal jenis baru", () => {
    expect(posAfterJenisChange("beban_penunjang", "beban")).toBe("beban_penunjang");
    expect(posAfterJenisChange("aset_lancar", "beban")).toBe("beban_program");
    expect(posAfterJenisChange("", "aset")).toBe("aset_lancar");
    expect(posAfterJenisChange("beban_terbatas", "aset")).toBe("aset_lancar");
  });

  it("menampilkan label yang mudah dibaca, dan nilai asli bila tidak dikenal", () => {
    expect(posIsak35Label("aset_lancar")).toBe("Aset Lancar");
    expect(posIsak35Label("kewajiban_jangka_pendek")).toBe("Liabilitas Jangka Pendek");
    expect(posIsak35Label("beban_terbatas")).toBe("beban_terbatas");
    expect(posIsak35Label(null)).toBe("");
  });
});

describe("pengenalan akun kas untuk laporan arus kas", () => {
  it("mengenali kas, bank, dan e-wallet", () => {
    for (const nama of ["KAS UMUM", "Kas Kasir", "KAS", "BANK MIDTRANS", "BANK", "E-WALLET DANA", "e-wallet ovo", "E WALLET GOPAY", "EWALLET LINKAJA", "E-WALLET"]) {
      expect(isAkunKas("x", nama), nama).toBe(true);
    }
  });

  it("tidak salah mengenali akun lain yang namanya mirip", () => {
    for (const nama of ["DANA HIBAH", "PENERIMAAN DANA BOS", "PIUTANG SPP", "BANKRUT", "KASBON PEGAWAI", "PERSEDIAAN BARANG", "AKUN E-WALLETISH", ""]) {
      expect(isAkunKas("x", nama), nama).toBe(false);
    }
  });

  it("mengabaikan spasi dan tab di awal/akhir nama (ada data lama dengan tab)", () => {
    expect(isAkunKas("1109", "KAS UANG SAKU PEMBANTU BENDAHARA\t")).toBe(true);
    expect(isAkunKas("1210", "  BANK MIDTRANS ")).toBe(true);
  });
});
