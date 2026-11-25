import { describe, expect, it } from "vitest";
import {
  adminTuBolehBuka,
  adminTuBolehBukaKeuangan,
  bolehKelolaSiswa,
  hargaSeragamBacaSaja,
  keuanganBolehBukaAkademik,
} from "./aksesHalaman";

describe("adminTuBolehBukaKeuangan", () => {
  it.each(["/keuangan/monitoring-spmb", "/keuangan/monitoring-spmb/", "/keuangan/seragam-vendor", "/keuangan/seragam-vendor/"])(
    "mengizinkan %s",
    (path) => expect(adminTuBolehBukaKeuangan(path)).toBe(true),
  );
  it.each(["/keuangan", "/keuangan/pembayaran", "/keuangan/piutang", "/keuangan/seragam-vendor/lain", "/keuangan/seragam-vendor-palsu", "/keuangan/monitoring-spmb/other"])(
    "menolak %s",
    (path) => expect(adminTuBolehBukaKeuangan(path)).toBe(false),
  );
});

describe("adminTuBolehBuka", () => {
  it.each(["/akademik", "/akademik/siswa", "/akademik/spmb", "/keuangan/monitoring-spmb", "/keuangan/seragam-vendor"])(
    "mengizinkan %s",
    (path) => expect(adminTuBolehBuka(path)).toBe(true),
  );
  it.each(["/", "/keuangan/pembayaran", "/kepegawaian", "/pengaturan"])("menolak %s", (path) => expect(adminTuBolehBuka(path)).toBe(false));
});

describe("keuanganBolehBukaAkademik: hanya daftar siswa dan detailnya", () => {
  it.each(["/akademik/siswa", "/akademik/siswa/", "/akademik/siswa/0b9f-uuid", "/akademik/siswa/0b9f-uuid/"])(
    "mengizinkan %s",
    (path) => expect(keuanganBolehBukaAkademik(path)).toBe(true),
  );
  it.each(["/akademik", "/akademik/siswa/tambah", "/akademik/siswa/0b9f-uuid/edit", "/akademik/spmb", "/akademik/seragam", "/akademik/mutasi", "/akademik/siswa-lain"])(
    "menolak %s",
    (path) => expect(keuanganBolehBukaAkademik(path)).toBe(false),
  );
});

describe("peran dan aksi tulis", () => {
  it("hanya keuangan yang baca saja di data siswa", () => {
    expect(bolehKelolaSiswa("keuangan")).toBe(false);
    for (const role of ["admin", "admin_tu", "kepala_sekolah", "guru", null, undefined]) expect(bolehKelolaSiswa(role)).toBe(true);
  });
  it("hanya admin_tu yang baca saja di harga seragam vendor", () => {
    expect(hargaSeragamBacaSaja("admin_tu")).toBe(true);
    for (const role of ["admin", "keuangan", "kasir", null, undefined]) expect(hargaSeragamBacaSaja(role)).toBe(false);
  });
});
