import { describe, expect, it } from "vitest";
import {
  SERAGAM_EXPORT_COLUMNS,
  SERAGAM_REKAP_COLUMNS,
  buildSeragamSiswaRows,
  filterSeragamSiswaRows,
  rekapUangPangkalPerLembaga,
  seragamExportColumns,
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
  { jenis: "Pramuka", ukuran: "XXL" },
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
    expect(rows.every((row) => row.kelengkapan === "lengkap" && row.terisi === 5)).toBe(true);
  });

  it("lengkap hanya bila kelima stel punya nama dan ukuran tersimpan", () => {
    const rows = buildSeragamSiswaRows([
      siswa({ id: "full", nama: "Full", siswa_detail: { ukuran_seragam: FULL } }),
      siswa({ id: "part", nama: "Part", siswa_detail: { ukuran_seragam: [FULL[0], FULL[1], { jenis: "Coklat", ukuran: "" }, { jenis: "", ukuran: "" }] } }),
      siswa({ id: "none", nama: "None", siswa_detail: null }),
      siswa({ id: "bad", nama: "Bad", siswa_detail: { ukuran_seragam: "rusak" } }),
    ], departemen);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.full).toMatchObject({ kelengkapan: "lengkap", terisi: 5 });
    expect(byId.part).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 2 });
    expect(byId.none).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 0 });
    const lama = buildSeragamSiswaRows([siswa({ id: "lama", nama: "Lama", siswa_detail: { ukuran_seragam: FULL.slice(0, 4) } })], departemen)[0];
    expect(lama).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 4 });
    expect(lama.stel).toHaveLength(5);
    expect(byId.bad).toMatchObject({ kelengkapan: "belum_lengkap", terisi: 0 });
  });

  it("nama bawaan hanya melabeli stel kosong dan tidak dianggap ukuran tersimpan", () => {
    const [row] = buildSeragamSiswaRows([siswa({ id: "1", nama: "A", jenis_kelamin: "L" })], departemen);
    expect(row.stel.map((item) => item.jenis)).toEqual(["Olah raga", "Putih Merah", "Coklat", "Gamis Biru", ""]);
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
      siswa_detail: { ukuran_seragam: FULL, tahun_ajaran_id: "ta1", spmb_gelombang_id: "g1" }, kelas_siswa: [{ aktif: true, kelas: { id: "k1", nama: "1A", departemen_id: "sd" } }] }),
    siswa({ id: "2", nama: "Aisyah", nis: "2538002", status: "diterima", jenis_kelamin: "P", departemen_id: "smp",
      siswa_detail: { tahun_ajaran_id: "ta2", spmb_gelombang_id: "g2" },
      kelas_siswa: [{ aktif: true, kelas: { id: "k7", nama: "7A", departemen_id: "smp" } }] }),
    siswa({ id: "3", nama: "Budi", nis: "2538003", status: "aktif", jenis_kelamin: "L", departemen_id: "tk" }),
  ], departemen);
  const all = { search: "", lembagaId: "all", kelasId: "all", jenisKelamin: "all", status: "all", kelengkapan: "all", tahunId: "all", gelombangId: "all", uangPangkal: "all" };

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

  it("menyaring tahun ajaran dan gelombang SPMB; siswa tanpa data SPMB tidak lolos filter itu", () => {
    expect(rows.map((row) => [row.tahunAjaranId, row.gelombangId])).toEqual([["ta1", "g1"], ["ta2", "g2"], ["", ""]]);
    expect(filterSeragamSiswaRows(rows, { ...all, tahunId: "ta1" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterSeragamSiswaRows(rows, { ...all, gelombangId: "g2" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, tahunId: "ta1", gelombangId: "g2" })).toEqual([]);
    expect(filterSeragamSiswaRows(rows, { ...all, tahunId: "ta2", status: "diterima" }).map((row) => row.id)).toEqual(["2"]);
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
      stel1: "Olah raga: S", stel2: "Putih Merah: M", stel3: "Coklat: L", stel4: "Gamis Biru: XL", stel5: "Pramuka: XXL",
      kelengkapan: "Lengkap",
    }]);
  });
});

describe("uang pangkal pada daftar seragam", () => {
  const info = new Map([
    ["1", { total: 10_100_000, paid: 2_525_000, remaining: 7_575_000, status: "sebagian" as const }],
    ["2", { total: 13_100_000, paid: 13_100_000, remaining: 0, status: "lunas" as const }],
  ]);
  const rows = buildSeragamSiswaRows([
    siswa({ id: "1", nama: "Ahmad", departemen_id: "sd" }),
    siswa({ id: "2", nama: "Aisyah", departemen_id: "smp", jenis_kelamin: "P" }),
    siswa({ id: "3", nama: "Budi", departemen_id: "sd" }),
  ], departemen, info);
  const all = { search: "", lembagaId: "all", kelasId: "all", jenisKelamin: "all", status: "all", kelengkapan: "all", tahunId: "all", gelombangId: "all", uangPangkal: "all" };

  it("menempelkan status uang pangkal; siswa tanpa data monitoring berarti belum ada tagihan", () => {
    expect(rows.map((row) => row.statusUangPangkal)).toEqual(["sebagian", "lunas", "belum_ada_tagihan"]);
    expect(rows[2].uangPangkal).toBeNull();
    expect(buildSeragamSiswaRows([siswa({ id: "9", nama: "Tanpa" })], departemen)[0].statusUangPangkal).toBe("belum_ada_tagihan");
  });

  it("menyaring dropdown status uang pangkal", () => {
    expect(filterSeragamSiswaRows(rows, { ...all, uangPangkal: "sebagian" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterSeragamSiswaRows(rows, { ...all, uangPangkal: "lunas" }).map((row) => row.id)).toEqual(["2"]);
    expect(filterSeragamSiswaRows(rows, { ...all, uangPangkal: "belum_ada_tagihan" }).map((row) => row.id)).toEqual(["3"]);
    expect(filterSeragamSiswaRows(rows, { ...all, uangPangkal: "belum_bayar" })).toEqual([]);
  });

  it("ekspor menambah kolom nominal, dibayar, sisa, dan keterangan hanya bila diminta", () => {
    const biasa = seragamExportRows(rows)[0];
    expect(biasa).not.toHaveProperty("uangPangkalNominal");
    const lengkap = seragamExportRows(rows, { uangPangkal: true });
    expect(lengkap[0]).toMatchObject({ uangPangkalNominal: 10_100_000, uangPangkalDibayar: 2_525_000, uangPangkalSisa: 7_575_000, uangPangkalKeterangan: "Dibayar sebagian" });
    expect(lengkap[2]).toMatchObject({ uangPangkalNominal: "", uangPangkalDibayar: "", uangPangkalSisa: "", uangPangkalKeterangan: "Belum ada tagihan" });
    expect(seragamExportColumns(true).map((column) => column.key).slice(-4)).toEqual(["uangPangkalNominal", "uangPangkalDibayar", "uangPangkalSisa", "uangPangkalKeterangan"]);
    expect(seragamExportColumns(false)).toEqual(SERAGAM_EXPORT_COLUMNS);
  });

  it("rekap per lembaga menjumlahkan nominal, dibayar, sisa, dan jumlah per status, dengan baris total", () => {
    const rekap = rekapUangPangkalPerLembaga(rows);
    expect(rekap.map((row) => row.lembaga)).toEqual(["SD", "SMP", "TOTAL"]);
    expect(rekap[0]).toMatchObject({ siswa: 2, nominal: 10_100_000, dibayar: 2_525_000, sisa: 7_575_000, lunas: 0, sebagian: 1, belumBayar: 0, belumAdaTagihan: 1, perluVerifikasi: 0 });
    expect(rekap[1]).toMatchObject({ siswa: 1, nominal: 13_100_000, dibayar: 13_100_000, sisa: 0, lunas: 1 });
    expect(rekap[2]).toMatchObject({ siswa: 3, nominal: 23_200_000, dibayar: 15_625_000, sisa: 7_575_000, lunas: 1, sebagian: 1, belumAdaTagihan: 1 });
    expect(SERAGAM_REKAP_COLUMNS.map((column) => column.key)).toEqual(Object.keys(rekap[0]));
    expect(rekapUangPangkalPerLembaga([])).toEqual([expect.objectContaining({ lembaga: "TOTAL", siswa: 0, nominal: 0 })]);
  });
});
