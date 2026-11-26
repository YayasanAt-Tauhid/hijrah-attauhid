import { describe, expect, it } from "vitest";
import {
  catatanMasalah, pesananExportRows, REKAP_EXPORT_COLUMNS, rekapExportRows, rekapVendor, susunPesanan,
} from "./seragamVendorPesanan";
import type { HargaSeragamVendor } from "./seragamVendor";
import type { SeragamSiswaRow } from "./seragamSiswa";
import type { UangPangkalInfo } from "./seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const SD = "dept-sd";

function harga(patch: Partial<HargaSeragamVendor> & Pick<HargaSeragamVendor, "id">): HargaSeragamVendor {
  return {
    tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah",
    ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true, ...patch,
  };
}
const katalog = [
  harga({ id: "tk-sm" }),
  harga({ id: "tk-lxl", ukuran: ["L", "XL"], harga: 185000 }),
  harga({ id: "sd-olahraga", departemen_id: SD, nama_stel: "Olah raga", ukuran: [], harga: 100000 }),
];
function pangkal(total: number, paid: number, status?: UangPangkalInfo["status"]): UangPangkalInfo {
  return {
    total, paid, remaining: Math.max(0, total - paid),
    status: status ?? (paid === 0 ? "belum_bayar" : paid >= total ? "lunas" : "sebagian"),
  };
}
function stel(...items: Array<[string, string]>) {
  const isi = items.map(([jenis, ukuran]) => ({ jenis, ukuran }));
  return [...isi, ...Array.from({ length: 5 - isi.length }, () => ({ jenis: "", ukuran: "" }))];
}
function row(patch: Partial<SeragamSiswaRow> & Pick<SeragamSiswaRow, "id">): SeragamSiswaRow {
  return {
    nama: patch.id, nis: "", jenisKelaminKode: "L", jenisKelamin: "Ikhwan", status: "diterima", statusLabel: "Calon diterima",
    lembagaId: TK, lembaga: "TK", kelasId: "", kelas: "-", tahunAjaranId: TA, gelombangId: "g1",
    stel: stel(["Set Gamis Merah", "S"]), ukuranBaju: "", terisi: 0, kelengkapan: "tidak_tersedia",
    uangPangkal: pangkal(4000000, 1000000), statusUangPangkal: "sebagian", ...patch,
  };
}
const filter = { tahunAjaranId: TA };

describe("susunPesanan: kelayakan dan penyaringan", () => {
  it("hanya siswa SPMB (punya data uang pangkal) di tahun yang dipilih; ≥25% layak, sisanya dihitung belum memenuhi", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", uangPangkal: pangkal(4000000, 999999) }),
      row({ id: "c", uangPangkal: null }),
      row({ id: "d", tahunAjaranId: "ta-lain" }),
      row({ id: "e", uangPangkal: pangkal(0, 0, "belum_ada_tagihan") }),
    ];
    const hasil = susunPesanan(rows, katalog, filter);
    expect(hasil.layak.map((r) => r.siswaId)).toEqual(["a"]);
    expect(hasil.belumMemenuhi).toBe(2);
  });
  it("menyaring menurut lembaga dan gelombang", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", gelombangId: "g2" }),
      row({ id: "c", lembagaId: SD, lembaga: "SD", stel: stel(["Olah raga", "M"]) }),
    ];
    expect(susunPesanan(rows, katalog, { ...filter, gelombangId: "g2" }).layak.map((r) => r.siswaId)).toEqual(["b"]);
    expect(susunPesanan(rows, katalog, { ...filter, lembagaId: SD }).layak.map((r) => r.siswaId)).toEqual(["c"]);
  });
  it("urut menurut lembaga lalu nama", () => {
    const rows = [
      row({ id: "z", nama: "Zaid" }),
      row({ id: "a", nama: "Ahmad" }),
      row({ id: "s", nama: "Salim", lembagaId: SD, lembaga: "SD", stel: stel(["Olah raga", "M"]) }),
    ];
    expect(susunPesanan(rows, katalog, filter).layak.map((r) => r.nama)).toEqual(["Salim", "Ahmad", "Zaid"]);
  });
});

describe("susunPesanan: stel, harga, dan masalah data", () => {
  it("TK menghitung 5 stel; total = jumlah harga", () => {
    const tk = row({
      id: "a",
      stel: stel(["Set Gamis Merah", "S"], ["Set Gamis Merah", "M"], ["Set Gamis Merah", "L"], ["Set Gamis Merah", "XL"], ["Set Gamis Merah", "S"]),
    });
    const [hasil] = susunPesanan([tk], katalog, filter).layak;
    expect(hasil.stel).toHaveLength(5);
    expect(hasil.total).toBe(170000 + 170000 + 185000 + 185000 + 170000);
    expect(hasil.masalah).toBe(false);
  });
  it("lembaga lain hanya 4 stel meski slot kelima terisi", () => {
    const sd = row({
      id: "s", lembagaId: SD, lembaga: "SD",
      stel: stel(["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"]),
    });
    const [hasil] = susunPesanan([sd], katalog, filter).layak;
    expect(hasil.stel).toHaveLength(4);
    expect(hasil.total).toBe(400000);
  });
  it("slot tanpa nama dilewati; ukuran kosong dan harga tak ada ditandai, tidak dihitung", () => {
    const campur = row({
      id: "a",
      stel: stel(["Set Gamis Merah", "S"], ["Set Gamis Hijau", "S"], ["Set Gamis Biru", ""], ["", ""], ["", ""]),
    });
    const [hasil] = susunPesanan([campur], katalog, filter).layak;
    expect(hasil.stel.map((s) => [s.slot, s.status])).toEqual([[1, "ok"], [2, "harga_belum_ada"], [3, "ukuran_belum_diisi"]]);
    expect(hasil.stel[0].namaVendor).toBe("Set Gamis Merah");
    expect(hasil.total).toBe(170000);
    expect(hasil.masalah).toBe(true);
  });
  it("siswa tanpa satu pun stel bernama tetap layak tetapi bermasalah", () => {
    const kosong = row({ id: "a", stel: stel() });
    const hasil = susunPesanan([kosong], katalog, filter);
    expect(hasil.layak[0].stel).toEqual([]);
    expect(hasil.layak[0].total).toBe(0);
    expect(hasil.layak[0].masalah).toBe(true);
    expect(hasil.denganMasalah).toBe(1);
  });
  it("jenis kelamin siswa menentukan baris harga", () => {
    const putri = row({ id: "p", jenisKelaminKode: "P", jenisKelamin: "Akhwat" });
    const [hasil] = susunPesanan([putri], katalog, filter).layak;
    expect(hasil.stel[0].status).toBe("harga_belum_ada");
  });
});

describe("susunPesanan: kelengkapan stel", () => {
  it("stel terisi sebagian (kurang dari yang seharusnya) belum lengkap meski semua yang terisi berharga", () => {
    const tk = row({ id: "a", stel: stel(["Set Gamis Merah", "S"], ["Set Gamis Merah", "M"]) });
    const hasil = susunPesanan([tk], katalog, filter);
    expect(hasil.layak[0].stelWajib).toBe(5);
    expect(hasil.layak[0].stel.every((s) => s.status === "ok")).toBe(true);
    expect(hasil.layak[0].masalah).toBe(true);
    expect(hasil.denganMasalah).toBe(1);
    expect(catatanMasalah(hasil.layak[0])).toBe("Baru 2 dari 5 stel diisi");
  });
  it("lembaga lain lengkap bila 4 stel berharga (stelWajib 4)", () => {
    const sd = row({
      id: "s", lembagaId: SD, lembaga: "SD",
      stel: stel(["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"], ["Olah raga", "M"]),
    });
    const [hasil] = susunPesanan([sd], katalog, filter).layak;
    expect(hasil.stelWajib).toBe(4);
    expect(hasil.masalah).toBe(false);
    expect(catatanMasalah(hasil)).toBe("");
  });
  it("membawa kelas dan uang pangkal untuk daftar tindak lanjut", () => {
    const r = row({ id: "a", kelas: "TK A", uangPangkal: pangkal(4000000, 1000000) });
    const [hasil] = susunPesanan([r], katalog, filter).layak;
    expect(hasil.kelas).toBe("TK A");
    expect(hasil.uangPangkalTotal).toBe(4000000);
    expect(hasil.uangPangkalDibayar).toBe(1000000);
  });
});

describe("rekapVendor", () => {
  it("menggabungkan stel, ukuran, dan harga yang sama; memisahkan yang harganya belum ada", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c", stel: stel(["Set Gamis Merah", "XL"]) }),
      row({ id: "d", stel: stel(["Set Gamis Hijau", "S"]) }),
      row({ id: "e", stel: stel(["Set Gamis Biru", ""]) }),
    ];
    const rekap = rekapVendor(susunPesanan(rows, katalog, filter).layak);
    expect(rekap.baris.map((b) => [b.namaStel, b.ukuran, b.hargaSatuan, b.jumlah, b.subtotal])).toEqual([
      ["Set Gamis Merah", "S", 170000, 2, 340000],
      ["Set Gamis Merah", "XL", 185000, 1, 185000],
    ]);
    expect(rekap.tanpaHarga.map((b) => [b.namaStel, b.ukuran, b.jumlah])).toEqual([["Set Gamis Hijau", "S", 1]]);
    expect(rekap.totalJumlah).toBe(3);
    expect(rekap.totalBayar).toBe(525000);
  });

  it("memisahkan ikhwan dan akhwat pada stel, ukuran, dan harga yang sama; Ikhwan lebih dulu", () => {
    const bersama = [...katalog, harga({ id: "tk-ungu-semua", nama_stel: "Set Gamis Ungu", jenis_kelamin: "semua", ukuran: ["XL"], harga: 200000 })];
    const rows = [
      row({ id: "p1", jenisKelaminKode: "P", jenisKelamin: "Akhwat", stel: stel(["Set Gamis Ungu", "XL"]) }),
      row({ id: "l1", stel: stel(["Set Gamis Ungu", "XL"]) }),
      row({ id: "l2", stel: stel(["Set Gamis Ungu", "XL"]) }),
    ];
    const rekap = rekapVendor(susunPesanan(rows, bersama, filter).layak);
    expect(rekap.baris.map((b) => [b.namaStel, b.jenisKelaminKode, b.ukuran, b.hargaSatuan, b.jumlah, b.subtotal])).toEqual([
      ["Set Gamis Ungu", "L", "XL", 200000, 2, 400000],
      ["Set Gamis Ungu", "P", "XL", 200000, 1, 200000],
    ]);
    expect(rekap.totalJumlah).toBe(3);
    expect(rekap.totalBayar).toBe(600000);
  });

  it("ukuran KUSTOM (XL): harga sama dengan XL, tetapi tampil sebagai baris sendiri setelah XL", () => {
    const rows = [
      row({ id: "std", stel: stel(["Set Gamis Merah", "XL"]) }),
      row({ id: "kst", stel: stel(["Set Gamis Merah", "kustom(xl)"]) }),
    ];
    const { layak } = susunPesanan(rows, katalog, filter);
    const kustom = layak.find((r) => r.siswaId === "kst")!.stel[0];
    expect(kustom).toMatchObject({ ukuran: "KUSTOM (XL)", harga: 185000, status: "ok" });
    const rekap = rekapVendor(layak);
    expect(rekap.baris.map((b) => [b.ukuran, b.hargaSatuan, b.jumlah])).toEqual([
      ["XL", 185000, 1],
      ["KUSTOM (XL)", 185000, 1],
    ]);
    expect(rekap.totalBayar).toBe(370000);
  });

  it("urut menurut lembaga, stel, jenis kelamin (Ikhwan dulu), lalu ukuran", () => {
    const bersama = [
      ...katalog,
      harga({ id: "tk-merah-xl-p", jenis_kelamin: "P", ukuran: ["XL"], harga: 190000 }),
      harga({ id: "tk-merah-s-p", jenis_kelamin: "P", ukuran: ["S"], harga: 160000 }),
    ];
    const rows = [
      row({ id: "p-xl", jenisKelaminKode: "P", jenisKelamin: "Akhwat", stel: stel(["Set Gamis Merah", "XL"]) }),
      row({ id: "l-xl", stel: stel(["Set Gamis Merah", "XL"]) }),
      row({ id: "p-s", jenisKelaminKode: "P", jenisKelamin: "Akhwat", stel: stel(["Set Gamis Merah", "S"]) }),
      row({ id: "l-s", stel: stel(["Set Gamis Merah", "S"]) }),
    ];
    const rekap = rekapVendor(susunPesanan(rows, bersama, filter).layak);
    expect(rekap.baris.map((b) => [b.jenisKelaminKode, b.ukuran])).toEqual([["L", "S"], ["L", "XL"], ["P", "S"], ["P", "XL"]]);
  });

  it("stel tanpa harga juga dipisah menurut jenis kelamin", () => {
    const rows = [
      row({ id: "p", jenisKelaminKode: "P", jenisKelamin: "Akhwat", stel: stel(["Set Gamis Hijau", "S"]) }),
      row({ id: "l", stel: stel(["Set Gamis Hijau", "S"]) }),
    ];
    const rekap = rekapVendor(susunPesanan(rows, katalog, filter).layak);
    expect(rekap.tanpaHarga.map((b) => [b.namaStel, b.jenisKelaminKode, b.ukuran, b.jumlah])).toEqual([
      ["Set Gamis Hijau", "L", "S", 1],
      ["Set Gamis Hijau", "P", "S", 1],
    ]);
  });
});

describe("ekspor", () => {
  const rows = [
    row({ id: "a", nama: "Ahmad", nis: "27.001", stel: stel(["Set Gamis Merah", "S"], ["Olahraga", "XL"]) }),
  ];
  const [pesanan] = susunPesanan(rows, katalog, filter).layak;
  it("catatanMasalah menyebut harga/ukuran yang belum ada", () => {
    expect(catatanMasalah(pesanan)).toBe("Baru 2 dari 5 stel diisi; Harga belum ada: Olahraga (XL)");
    const kosong = susunPesanan([row({ id: "k", stel: stel(["Set Gamis Biru", ""]) })], katalog, filter).layak[0];
    expect(catatanMasalah(kosong)).toBe("Baru 1 dari 5 stel diisi; Ukuran belum diisi: Set Gamis Biru");
  });
  it("baris ekspor pesanan memuat stel, total, dan catatan", () => {
    expect(pesananExportRows([pesanan])).toEqual([{
      nama: "Ahmad", nis: "27.001", lembaga: "TK", jenisKelamin: "Ikhwan",
      stel: "Set Gamis Merah (S); Olahraga (XL)", total: 170000, catatan: "Baru 2 dari 5 stel diisi; Harga belum ada: Olahraga (XL)",
    }]);
  });
  it("baris ekspor rekap diakhiri baris TOTAL dan memuat stel tanpa harga, masing-masing dengan jenis kelamin", () => {
    const hasil = rekapExportRows(rekapVendor([pesanan]));
    expect(hasil[0]).toMatchObject({ lembaga: "TK", stel: "Set Gamis Merah", jenisKelamin: "Ikhwan", ukuran: "S", jumlah: 1, hargaSatuan: 170000, subtotal: 170000 });
    expect(hasil[1]).toMatchObject({ stel: "Olahraga", jenisKelamin: "Ikhwan", ukuran: "XL", hargaSatuan: "Harga belum ada", subtotal: "" });
    expect(hasil[hasil.length - 1]).toMatchObject({ lembaga: "TOTAL", jumlah: 1, subtotal: 170000 });
  });
  it("kolom ekspor rekap: Jenis Kelamin tepat setelah Stel", () => {
    expect(REKAP_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Lembaga", "Stel", "Jenis Kelamin", "Ukuran", "Jumlah", "Harga Satuan (Rp)", "Subtotal (Rp)",
    ]);
  });
});
