import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { labelTahunBuku, tanggalLokalISO } from "./labelTahunBuku";

const tb2026 = { nama: "Tahun 2026", tanggal_mulai: "2026-01-01", tanggal_selesai: "2026-12-31", ditutup: false };
const tb2025 = { nama: "Tahun 2025", tanggal_mulai: "2025-01-01", tanggal_selesai: "2025-12-31", ditutup: true };

describe("labelTahunBuku", () => {
  it("menandai tahun buku yang masih berjalan dengan tanggal batas", () => {
    expect(labelTahunBuku(tb2026, "2026-11-11")).toBe("Tahun 2026 (berjalan, s.d. 11 November 2026)");
  });

  it("menandai juga pada hari pertama dan hari terakhir tahun buku", () => {
    expect(labelTahunBuku(tb2026, "2026-01-01")).toBe("Tahun 2026 (berjalan, s.d. 1 Januari 2026)");
    expect(labelTahunBuku(tb2026, "2026-12-31")).toBe("Tahun 2026 (berjalan, s.d. 31 Desember 2026)");
  });

  it("tidak menambah keterangan untuk tahun buku yang sudah lewat", () => {
    expect(labelTahunBuku(tb2025, "2026-11-11")).toBe("Tahun 2025");
    expect(labelTahunBuku({ ...tb2026, ditutup: false }, "2027-01-01")).toBe("Tahun 2026");
  });

  it("tidak menambah keterangan untuk tahun buku yang sudah ditutup walau tanggalnya belum lewat", () => {
    expect(labelTahunBuku({ ...tb2026, ditutup: true }, "2026-11-11")).toBe("Tahun 2026");
  });

  it("tidak menambah keterangan untuk tahun buku yang belum mulai", () => {
    expect(labelTahunBuku({ nama: "Tahun 2027", tanggal_mulai: "2027-01-01", tanggal_selesai: "2027-12-31" }, "2026-11-11")).toBe("Tahun 2027");
  });

  it("memakai cadangan bila tahun buku tidak ada", () => {
    expect(labelTahunBuku(undefined, "2026-11-11", "2026")).toBe("2026");
  });

  it("tanggalLokalISO memakai tanggal lokal, bukan UTC", () => {
    expect(tanggalLokalISO(new Date(2026, 10, 11, 0, 30))).toBe("2026-11-11");
    expect(tanggalLokalISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("judul laporan ISAK 35 memakai labelTahunBuku", () => {
  const halaman = [
    "LaporanKomprehensif.tsx",
    "LaporanPerubahanAsetNeto.tsx",
    "LaporanArusKasISAK35.tsx",
    "LaporanPosisiKeuangan.tsx",
  ];
  for (const nama of halaman) {
    it(nama, () => {
      const src = readFileSync(resolve(process.cwd(), "src/pages/keuangan", nama), "utf8");
      expect(src).toContain("labelTahunBuku(");
      expect(src).not.toMatch(/modePeriode === "tahun" \? namaTampil :/);
    });
  }
});
