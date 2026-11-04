import { describe, expect, it } from "vitest";
import {
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS,
  canAccess,
  isConfigurableRole,
  normalizePermissions,
  permissionForPath,
} from "./permissions";

describe("katalog izin", () => {
  it("kunci unik dan setiap kunci punya label serta kelompok", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const def of PERMISSIONS) {
      expect(def.label.length).toBeGreaterThan(3);
      expect(def.group.length).toBeGreaterThan(1);
    }
  });

  it("isian awal hanya memakai kunci yang dikenal dan mencakup semua peran yang bisa diatur", () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...CONFIGURABLE_ROLES].sort());
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const key of keys) expect(PERMISSION_KEYS).toContain(key);
    }
  });

  it("isian awal: kasir/keuangan mengajukan pembatalan, hanya bendahara & sekretaris menyetujui, tidak ada yang langsung", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.kasir).toContain("keuangan.pembatalan.ajukan");
    expect(DEFAULT_ROLE_PERMISSIONS.keuangan).toContain("keuangan.pembatalan.ajukan");
    expect(DEFAULT_ROLE_PERMISSIONS.kasir).not.toContain("keuangan.pembatalan.setujui");
    expect(DEFAULT_ROLE_PERMISSIONS.keuangan).not.toContain("keuangan.pembatalan.setujui");
    expect(DEFAULT_ROLE_PERMISSIONS.bendahara).toContain("keuangan.pembatalan.setujui");
    expect(DEFAULT_ROLE_PERMISSIONS.sekretaris_yayasan).toContain("keuangan.pembatalan.setujui");
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(keys).not.toContain("keuangan.pembatalan.langsung");
    }
  });

  it("kasir bawaan hanya mendapat pembayaran dan rekap kasir (perilaku lama)", () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.kasir].sort()).toEqual(
      ["keuangan.pembatalan.ajukan", "keuangan.pembayaran", "keuangan.rekap_kasir"].sort(),
    );
  });
});

describe("isConfigurableRole", () => {
  it("admin dan peran non-keuangan tidak bisa diatur", () => {
    expect(isConfigurableRole("bendahara")).toBe(true);
    expect(isConfigurableRole("kasir")).toBe(true);
    expect(isConfigurableRole("admin")).toBe(false);
    expect(isConfigurableRole("guru")).toBe(false);
    expect(isConfigurableRole(null)).toBe(false);
  });
});

describe("canAccess", () => {
  const granted = new Set(["keuangan.pembayaran"]);
  it("admin selalu boleh", () => {
    expect(canAccess("admin", new Set(), "keuangan.akuntansi")).toBe(true);
  });
  it("peran lain hanya jika izinnya diberikan", () => {
    expect(canAccess("kasir", granted, "keuangan.pembayaran")).toBe(true);
    expect(canAccess("kasir", granted, "keuangan.akuntansi")).toBe(false);
  });
  it("tanpa peran atau izin belum dimuat ditolak (fail closed)", () => {
    expect(canAccess(null, granted, "keuangan.pembayaran")).toBe(false);
    expect(canAccess("kasir", null, "keuangan.pembayaran")).toBe(false);
  });
});

describe("normalizePermissions", () => {
  it("membuang kunci tak dikenal dan duplikat", () => {
    expect(normalizePermissions("kasir", ["keuangan.pembayaran", "keuangan.pembayaran", "ngawur"])).toEqual(["keuangan.pembayaran"]);
  });
  it("bendahara/sekretaris yang punya izin apa pun otomatis mendapat akses data (dibutuhkan RLS)", () => {
    expect(normalizePermissions("bendahara", ["keuangan.laporan"])).toEqual(["keuangan.akses_data", "keuangan.laporan"]);
    expect(normalizePermissions("sekretaris_yayasan", [])).toEqual([]);
  });
  it("akses data tidak berlaku untuk keuangan dan kasir", () => {
    expect(normalizePermissions("kasir", ["keuangan.akses_data", "keuangan.pembayaran"])).toEqual(["keuangan.pembayaran"]);
    expect(normalizePermissions("keuangan", ["keuangan.akses_data"])).toEqual([]);
  });
});

describe("permissionForPath", () => {
  it.each([
    ["/keuangan/pembayaran", "keuangan.pembayaran"],
    ["/keuangan/pembayaran-spmb", "keuangan.pembayaran"],
    ["/keuangan/monitoring-spmb", "keuangan.pembayaran"],
    ["/keuangan/tabungan-pegawai", "keuangan.transaksi"],
    ["/keuangan/tabungan", "keuangan.transaksi"],
    ["/keuangan/tunggakan", "keuangan.rekap_kasir"],
    ["/keuangan/laporan-siswa", "keuangan.laporan"],
    ["/keuangan/laporan", "keuangan.laporan"],
    ["/keuangan/isak35/arus-kas", "keuangan.akuntansi"],
    ["/keuangan/jurnal", "keuangan.akuntansi"],
    ["/keuangan/audit-trail", "keuangan.pengaturan"],
    ["/keuangan/diskon-siswa", "keuangan.diskon"],
  ])("%s → %s", (path, permission) => {
    expect(permissionForPath(path)).toBe(permission);
  });

  it("halaman persetujuan pembatalan terbuka bagi penyetuju maupun pengaju (yang terakhir hanya melihat pengajuannya sendiri)", () => {
    expect(permissionForPath("/keuangan/persetujuan-pembatalan")).toEqual(["keuangan.pembatalan.setujui", "keuangan.pembatalan.ajukan"]);
  });

  it("tidak cocok parsial di tengah segmen dan tidak menebak rute tak dikenal", () => {
    expect(permissionForPath("/keuangan/pembayaranxyz")).toBeNull();
    expect(permissionForPath("/keuangan")).toBeNull();
    expect(permissionForPath("/akademik/siswa")).toBeNull();
  });
});
