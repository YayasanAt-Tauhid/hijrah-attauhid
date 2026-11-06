import { describe, expect, it } from "vitest";
import { getSpmbRegistrationFeeStatus } from "./spmbRegistrationFee";

// Status biaya pendaftaran yang tampil di daftar SPMB (kolom "Seleksi & aktivasi"
// dan "Biaya Pendaftaran") harus selalu sama, jadi keduanya memakai fungsi ini.
describe("getSpmbRegistrationFeeStatus", () => {
  it("belum diperiksa bila data kesiapan belum dimuat", () => {
    expect(getSpmbRegistrationFeeStatus({ _readiness: undefined, _pmbGratis: true, _pmbConfigured: true, _pmbLunas: true }))
      .toEqual({ key: "belum_diperiksa", label: "Belum diperiksa", tone: "muted" });
  });

  it("gratis bila gelombang tidak berbayar, walau belum ada pembayaran", () => {
    expect(getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbGratis: true, _pmbConfigured: false, _pmbLunas: false }))
      .toEqual({ key: "gratis", label: "Gratis", tone: "success" });
  });

  it("belum diatur bila biaya pendaftaran belum dikonfigurasi", () => {
    expect(getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbGratis: false, _pmbConfigured: false, _pmbLunas: false }))
      .toEqual({ key: "belum_diatur", label: "Belum diatur", tone: "warning" });
  });

  it("lunas bila biaya terkonfigurasi dan sudah dibayar", () => {
    expect(getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbGratis: false, _pmbConfigured: true, _pmbLunas: true }))
      .toEqual({ key: "lunas", label: "Lunas", tone: "success" });
  });

  it("belum bayar bila terkonfigurasi tetapi belum lunas", () => {
    expect(getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbGratis: false, _pmbConfigured: true, _pmbLunas: false }))
      .toEqual({ key: "belum_bayar", label: "Belum bayar", tone: "destructive" });
  });

  it("sama dengan nilai _biayaSort yang dipakai filter Biaya Pendaftaran", () => {
    const keys = [
      getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbGratis: true }).key,
      getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbConfigured: false }).key,
      getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbConfigured: true, _pmbLunas: true }).key,
      getSpmbRegistrationFeeStatus({ _readiness: {}, _pmbConfigured: true }).key,
    ];
    expect(keys).toEqual(["gratis", "belum_diatur", "lunas", "belum_bayar"]);
  });
});
