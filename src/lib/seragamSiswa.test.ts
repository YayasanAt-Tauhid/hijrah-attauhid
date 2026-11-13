import { describe, expect, it } from "vitest";
import {
  buildSeragamSiswaRows,
  filterSeragamSiswaRows,
  seragamExportRows,
  seragamStelLabel,
  type SeragamSiswaSource,
} from "./seragamSiswa";

const departemen = [
  { id: "sd", nama: "SD", kode: "SD" },
  { id: "smp", nama: "SMP", kode: "SMP" },
  { id: "tk", nama: "TK", kode: "TK" },
];

const FULL = [
  { jenis: "Olah raga", ukuran: "S" },
  { jenis: "Putih Merah", ukuran: "M" },
  { jenis: "Coklat", ukuran: "L" },
  { jenis: "Gamis Biru", ukuran: "XL" },
];

const siswa = (over: Partial<SeragamSiswaSource> & { id: string; nama: string }): SeragamSiswaSource => ({
  nis: null,
  jenis_kelamin: "L",
  status: "aktif",
  departemen_id: "sd",
  siswa_detail: null,
  kelas_siswa: [],
  ...over,
});

describe("buildSeragamSiswaRows", () => {
  it("hanya memuat siswa aktif dan calon diterima", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "1", nama: "Aktif", status: "aktif" }),
      siswa({ id: "2", nama: "Diterima", status: "diterima" }),
      siswa({ id: "3", nama: "Calon", status: "calon" }),
      siswa({ id: "4", nama: "Alumni", status: "alumni" }),
      siswa({ id: "5", nama: "Keluar", status: "keluar" }),
      siswa({ id: "6", nama: "Tanpa Status", status: null }),
    ], departemen);
    expect(rows.map((row) => [row.nama, row.status, row.statusLabel])).toEqual([
      ["Aktif", "aktif", "Aktif"],
      ["Diterima", "diterima", "Calon diterima"],
    ]);
  });

  it("mengurutkan berdasarkan nama", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "1", nama: "Zainab" }),
      siswa({ id: "2", nama: "Ahmad" }),
    ], departemen);
    expect(rows.map((row) => row.nama)).toEqual(["Ahmad", "Zainab"]);
  });

  it("memakai lembaga tujuan SPMB, lalu kelas aktif, lalu lembaga siswa", () => {
    const rows = buildSeragamSiswaRows([
      siswa({
        id: "target", nama: "Internal", departemen_id: "sd",
        siswa_detail: { spmb_departemen_tujuan_id: "smp", ukuran_seragam: null },
        kelas_siswa: [{ aktif: true, kelas: { id: "k6", nama: "6A", departemen_id: "sd" } }],
      }),
      siswa({
        id: "kelas", nama: "Berkelas", departemen_id: "tk",
        kelas_siswa: [
          { aktif: false, kelas: { id: "old", nama: "Lama", departemen_id: "tk" } },
          { aktif: true, kelas: { id: "k3", nama: "3B", departemen_id: "sd" } },
        ],
      }),
      siswa({ id: "dasar", nama: "Dasar", departemen_id: "smp" }),
    ], departemen);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.target).toMatchObject({ lembagaId: "smp", lembaga: "SMP", kelas: "6A" });
    expect(byId.kelas).toMatchObject({ lembagaId: "sd", lembaga: "SD", kelas: "3B", kelasId: "k3" });
    expect(byId.dasar).toMatchObject({ lembagaId: "smp", lembaga: "SMP", kelas: "-", kelasId: "" });
  });

  it("menerima siswa_detail berbentuk objek maupun array", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "obj", nama: "A", siswa_detail: { ukuran_seragam: FULL } }),
      siswa({ id: "arr", nama: "B", siswa_detail: [{ ukuran_seragam: FULL }] }),
    ], departemen);
    expect(rows.every((row) => row.kelengkapan === "lengkap" && row.terisi === 4)).toBe(true);
  });

  it("lengkap hanya bila keempat stel punya nama dan ukuran tersimpan", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "full", nama: "Full", siswa_detail: { ukuran_seragam: FULL } }),
      siswa({ id: "part", nama: "Part", siswa_detail: { ukuran_seragam: [FULL[0], FULL[1], { jenis: "Coklat", ukuran: "" }, { jenis: "", ukuran: "" }] } }),
      siswa({ id: "none", nama: "None", siswa_detail: null }),
      siswa({ id: "bad", nama: "Bad", siswa_detail: { ukuran_seragam: "rusak" } }),
    ], departemen);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.full).toMatchObject({ kelengkapan: "lengkap", terisi: 4 });
    expect(byId.part).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 2 });
    expect(byId.none).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 0 });
    expect(byId.bad).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 0 });
  });

  it("nama bawaan hanya melabeli stel kosong dan tidak dianggap ukuran tersimpan", () => {
    const [row] = buildSeragamSiswaRows([siswa({ id: "1", nama: "A", jenis_kelamin: "L" })], departemen);
    expect(row.stel.map((item) => item.jenis)).toEqual(["Olah raga", "Putih Merah", "Coklat", "Gamis Biru"]);
    expect(row.stel.every((item) => item.ukuran === "")).toBe(true);
    expect(row.terisi).toBe(0);
  });

  it("mempertahankan nama khusus yang diedit dan ukuran khusus apa adanya", () => {
    const [row] = buildSeragamSiswaRows([siswa({
      id: "1", nama: "A", siswa_detail: { ukuran_seragam: [{ jenis: "Khimar Khusus", ukuran: "jumbo" }] },
    })], departemen);
    expect(row.stel[0]).toEqual({ jenis: "Khimar Khusus", ukuran: "jumbo" });
  });

  it("TK ditandai tidak tersedia dan tidak dihitung belum lengkap", () => {
    const [row] = buildSeragamSiswaRows([siswa({ id: "1", nama: "Anak TK", departemen_id: "tk" })], departemen);
    expect(row).toMatchObject({ lembaga: "TK", kelengkapan: "tidak_tersedia", terisi: 0 });
  });

  it("memetakan jenis kelamin dan tidak membuat ukuran_baju lama menjadi empat stel", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "l", nama: "L", jenis_kelamin: "L" }),
      siswa({ id: "p", nama: "P", jenis_kelamin: "P", siswa_detail: { ukuran_baju: "XL" } }),
      siswa({ id: "x", nama: "X", jenis_kelamin: null }),
    ], departemen);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.l.jenisKelamin).toBe("Ikhwan");
    expect(byId.p.jenisKelamin).toBe("Akhwat");
    expect(byId.p.terisi).toBe(0);
    expect(byId.x.jenisKelamin).toBe("-");
  });
});

describe("filterSeragamSiswaRows", () => {
  const rows = buildSeragamSiswaRows([
    siswa({ id: "1", nama: "Ahmad Fauzi", nis: "2538001", status: "aktif", jenis_kelamin: "L", departemen_id: "sd",
      siswa_detail: { ukuran_seragam: FULL }, kelas_siswa: [{ aktif: true, kelas: { id: "k1", nama: "1A", departemen_id: "sd" } }] }),
    siswa({ id: "2", nama: "Aisyah", nis: "2538002", status: "diterima", jenis_kelamin: "P", departemen_id: "smp",
      kelas_siswa: [{ aktif: true, kelas: { id: "k7", nama: "7A", departemen_id: "smp" } }] }),
    siswa({ id: "3", nama: "Budi", nis: "2538003", status: "aktif", jenis_kelamin: "L", departemen_id: "tk" }),
  ], departemen);
  const all = { search: "", lembagaId: "all", kelasId: "all", jenisKelamin: "all", status: "all", kelengkapan: "all" };

  it("tanpa filter mengembalikan semua baris", () => {
    expect(filterSeragamSiswaRows(rows, all)).toHaveLength(3);
  });

  it("mencari nama atau NIS tanpa peduli huruf besar", () => {
    expect(filterSeragamSiswaRows(rows, { ...all, search: "AISY" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, search: "2538003" }).map((row) => row.id)).toEqual(["3"]);
    expect(filterSeragamSiswaRows(rows, { ...all, search: "  " })).toHaveLength(3);
  });

  it("menyaring status aktif dan calon diterima", () => {
    expect(filterSeragamSiswaRows(rows, { ...all, status: "aktif" }).map((row) => row.id)).toEqual(["1", "3"]);
    expect(filterSeragamSiswaRows(rows, { ...all, status: "diterima" }).map((row) => row.id)).toEqual(["2"]);
  });

  it("menyaring lembaga, kelas, jenis kelamin, dan kelengkapan", () => {
    expect(filterSeragamSiswaRows(rows, { ...all, lembagaId: "smp" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, kelasId: "k1" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterSeragamSiswaRows(rows, { ...all, jenisKelamin: "P" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, kelengkapan: "lengkap" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterSeragamSiswaRows(rows, { ...all, kelengkapan: "belum_lengkap" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, kelengkapan: "tidak_tersedia" }).map((row) => row.id)).toEqual(["3"]);
  });

  it("menggabungkan beberapa filter sekaligus", () => {
    expect(filterSeragamSiswaRows(rows, { ...all, status: "aktif", jenisKelamin: "L", kelengkapan: "lengkap" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterSeragamSiswaRows(rows, { ...all, status: "diterima", lembagaId: "sd" })).toEqual([]);
  });
});

describe("seragamStelLabel dan seragamExportRows", () => {
  it("menulis label stel dengan penanda bila ukuran belum diisi", () => {
    expect(seragamStelLabel({ jenis: "Olah raga", ukuran: "M" })).toBe("Olah raga: M");
    expect(seragamStelLabel({ jenis: "Coklat", ukuran: "" })).toBe("Coklat: Belum diisi");
    expect(seragamStelLabel({ jenis: "", ukuran: "" })).toBe("-");
  });

  it("menyusun baris ekspor memakai kolom datar yang aman untuk Excel", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "1", nama: "Ahmad", nis: "2538001", siswa_detail: { ukuran_seragam: FULL },
        kelas_siswa: [{ aktif: true, kelas: { id: "k1", nama: "1A", departemen_id: "sd" } }] }),
    ], departemen);
    expect(seragamExportRows(rows)).toEqual([{
      nama: "Ahmad", nis: "2538001", lembaga: "SD", kelas: "1A", jenisKelamin: "Ikhwan", status: "Aktif",
      stel1: "Olah raga: S", stel2: "Putih Merah: M", stel3: "Coklat: L", stel4: "Gamis Biru: XL",
      kelengkapan: "Lengkap",
    }]);
  });
});
