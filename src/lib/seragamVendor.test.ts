import { describe, expect, it } from "vitest";
import {
  cariBentrok, cariHarga, hargaBertabrakan, jumlahStelPesanan, layakDipesan, normalizeNamaStel,
  normalizeUkuran, normalizeUkuranList, pesanGalatHarga, salinanHarga, ukuranDasarKustom, validasiHarga,
  type HargaSeragamVendor, type JenisKelaminHarga,
} from "./seragamVendor";
import type { UangPangkalInfo } from "./seragamUangPangkal";

const TA = "ta-2027";
const TK = "dept-tk";
const SD = "dept-sd";

function harga(patch: Partial<HargaSeragamVendor> = {}): HargaSeragamVendor {
  return {
    id: "h1", tahun_ajaran_id: TA, departemen_id: TK, jenis_kelamin: "L", nama_stel: "Set Gamis Merah",
    ukuran: ["S", "M"], harga: 170000, catatan: null, aktif: true, ...patch,
  };
}
function pangkal(total: number, paid: number, status?: UangPangkalInfo["status"]): UangPangkalInfo {
  return {
    total, paid, remaining: Math.max(0, total - paid),
    status: status ?? (paid === 0 ? "belum_bayar" : paid >= total ? "lunas" : "sebagian"),
  };
}

describe("normalisasi", () => {
  it("ukuran: huruf besar, spasi dirapikan, alias X3L/X4L/X5L", () => {
    expect(normalizeUkuran(" x4l ")).toBe("4XL");
    expect(normalizeUkuran("X3L")).toBe("3XL");
    expect(normalizeUkuran("x5l")).toBe("5XL");
    expect(normalizeUkuran("xl")).toBe("XL");
    expect(normalizeUkuran("all  size")).toBe("ALL SIZE");
  });
  it("daftar ukuran: unik dan berurutan menurut daftar baku", () => {
    expect(normalizeUkuranList(["XL", "s", "X4L", "S", " "])).toEqual(["S", "XL", "4XL"]);
  });
  it("nama stel: tidak peka huruf besar/kecil dan spasi dirapikan", () => {
    expect(normalizeNamaStel("  Set   Gamis MERAH ")).toBe("set gamis merah");
  });
});

describe("jumlahStelPesanan", () => {
  it("TK 5 stel, lainnya 4 stel", () => {
    expect(jumlahStelPesanan("TK")).toBe(5);
    expect(jumlahStelPesanan("SD")).toBe(4);
    expect(jumlahStelPesanan("MTA")).toBe(4);
    expect(jumlahStelPesanan("")).toBe(4);
  });
});

describe("layakDipesan (ambang 25% = ceil(total/4))", () => {
  it("tepat 25% layak, kurang satu rupiah tidak", () => {
    expect(layakDipesan(pangkal(4000000, 1000000))).toBe(true);
    expect(layakDipesan(pangkal(4000000, 999999))).toBe(false);
  });
  it("pembulatan ke atas: total 1.000.001 butuh 250.001", () => {
    expect(layakDipesan(pangkal(1000001, 250000))).toBe(false);
    expect(layakDipesan(pangkal(1000001, 250001))).toBe(true);
  });
  it("tanpa tagihan, perlu verifikasi, total 0, atau tanpa data tidak layak", () => {
    expect(layakDipesan(pangkal(0, 0, "belum_ada_tagihan"))).toBe(false);
    expect(layakDipesan({ total: 4000000, paid: 4000000, remaining: 0, status: "perlu_verifikasi" })).toBe(false);
    expect(layakDipesan(pangkal(0, 0))).toBe(false);
    expect(layakDipesan(null)).toBe(false);
    expect(layakDipesan(undefined)).toBe(false);
  });
});

describe("ukuran kustom: KUSTOM (XL) = dibuat khusus, berharga seperti XL", () => {
  const q = { tahunAjaranId: TA, lembagaId: TK, jenisKelamin: "L", nama: "Set Gamis Merah", ukuran: "KUSTOM (XL)" };
  const xl = harga({ id: "xl", ukuran: ["L", "XL"], harga: 185000 });
  it("normalizeUkuran merapikan notasi kustom dan alias ukuran dasarnya", () => {
    expect(normalizeUkuran("kustom(xl)")).toBe("KUSTOM (XL)");
    expect(normalizeUkuran(" Kustom ( x3l ) ")).toBe("KUSTOM (3XL)");
    expect(normalizeUkuran("KUSTOM  (XL)")).toBe("KUSTOM (XL)");
  });
  it("ukuranDasarKustom: mengembalikan ukuran dasar, null bila bukan notasi kustom yang sah", () => {
    expect(ukuranDasarKustom("KUSTOM (XL)")).toBe("XL");
    expect(ukuranDasarKustom("kustom(3xl)")).toBe("3XL");
    expect(ukuranDasarKustom("XL")).toBeNull();
    expect(ukuranDasarKustom("KUSTOM")).toBeNull();
    expect(ukuranDasarKustom("KUSTOM (ALL SIZE)")).toBeNull();
    expect(ukuranDasarKustom("KUSTOM (ABC)")).toBeNull();
  });
  it("cariHarga memakai baris ukuran dasar: harga KUSTOM (XL) sama dengan XL", () => {
    expect(cariHarga([xl], q)?.harga).toBe(185000);
    expect(cariHarga([xl], { ...q, ukuran: "xl" })?.harga).toBe(185000);
  });
  it("tidak cocok bila ukuran dasarnya tidak ada di baris harga", () => {
    expect(cariHarga([harga()], q)).toBeNull();
    expect(cariHarga([xl], { ...q, ukuran: "KUSTOM (S)" })).toBeNull();
  });
  it("baris tanpa pembatas ukuran tetap berlaku untuk ukuran kustom; notasi tak sah tidak dicocokkan", () => {
    expect(cariHarga([harga({ ukuran: [], harga: 200000 })], q)?.harga).toBe(200000);
    expect(cariHarga([xl], { ...q, ukuran: "KUSTOM (ABC)" })).toBeNull();
  });
  it("aturan lain tetap: jenis kelamin dan tahun ajaran harus cocok", () => {
    expect(cariHarga([xl], { ...q, jenisKelamin: "P" })).toBeNull();
    expect(cariHarga([harga({ ...xl, tahun_ajaran_id: "ta-lain" })], q)).toBeNull();
  });
});
describe("cariHarga", () => {
  const q = { tahunAjaranId: TA, lembagaId: TK, jenisKelamin: "L", nama: "Set Gamis Merah", ukuran: "S" };
  it("cocok menurut tahun, lembaga, nama, jenis kelamin, dan ukuran", () => {
    expect(cariHarga([harga()], q)?.id).toBe("h1");
    expect(cariHarga([harga()], { ...q, ukuran: "M" })?.id).toBe("h1");
    expect(cariHarga([harga()], { ...q, ukuran: "XL" })).toBeNull();
  });
  it("nama tidak peka huruf besar/kecil dan spasi; ukuran mengenal alias", () => {
    expect(cariHarga([harga()], { ...q, nama: "  set gamis   merah " })?.id).toBe("h1");
    expect(cariHarga([harga({ ukuran: ["4XL"] })], { ...q, ukuran: "X4L" })?.id).toBe("h1");
  });
  it("jenis kelamin spesifik tidak cocok untuk lawan jenis; 'semua' cocok untuk keduanya", () => {
    expect(cariHarga([harga()], { ...q, jenisKelamin: "P" })).toBeNull();
    expect(cariHarga([harga({ jenis_kelamin: "semua" })], { ...q, jenisKelamin: "P" })?.id).toBe("h1");
    expect(cariHarga([harga({ jenis_kelamin: "semua" })], { ...q, jenisKelamin: "L" })?.id).toBe("h1");
  });
  it("ukuran kosong berarti semua ukuran", () => {
    expect(cariHarga([harga({ ukuran: [] })], { ...q, ukuran: "XXL" })?.id).toBe("h1");
  });
  it("baris nonaktif, tahun lain, dan lembaga lain diabaikan", () => {
    expect(cariHarga([harga({ aktif: false })], q)).toBeNull();
    expect(cariHarga([harga({ tahun_ajaran_id: "ta-lain" })], q)).toBeNull();
    expect(cariHarga([harga({ departemen_id: SD })], q)).toBeNull();
  });
  it("baris dengan jenis kelamin dan ukuran spesifik menang atas yang umum", () => {
    const umum = harga({ id: "g", jenis_kelamin: "semua", ukuran: [], harga: 100000 });
    const khusus = harga({ id: "s", jenis_kelamin: "L", ukuran: ["S"], harga: 170000 });
    expect(cariHarga([umum, khusus], q)?.id).toBe("s");
    expect(cariHarga([umum, khusus], { ...q, ukuran: "XL" })?.id).toBe("g");
  });
});

describe("hargaBertabrakan dan cariBentrok", () => {
  it("bertabrakan bila jenis kelamin dan ukuran sama-sama beririsan pada stel yang sama", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", jenis_kelamin: "semua", ukuran: ["S", "XL"] }))).toBe(true);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", nama_stel: "  set gamis MERAH" }))).toBe(true);
  });
  it("ukuran kosong beririsan dengan ukuran apa pun", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", ukuran: [] }))).toBe(true);
  });
  it("tidak bertabrakan bila L vs P, ukuran terpisah, nama beda, tahun beda, atau salah satu nonaktif", () => {
    expect(hargaBertabrakan(harga(), harga({ id: "h2", jenis_kelamin: "P" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", ukuran: ["XL"] }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", nama_stel: "Olahraga" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", tahun_ajaran_id: "ta-lain" }))).toBe(false);
    expect(hargaBertabrakan(harga(), harga({ id: "h2", aktif: false }))).toBe(false);
  });
  it("cariBentrok mengabaikan baris yang sama dan mengembalikan null bila bersih", () => {
    const lain = harga({ id: "h2", jenis_kelamin: "semua", ukuran: ["S"] });
    expect(cariBentrok(harga({ id: "h1" }), [harga({ id: "h1" })])).toBeNull();
    expect(cariBentrok(harga({ id: "h1" }), [harga({ id: "h1" }), lain])?.id).toBe("h2");
  });
});

describe("validasiHarga", () => {
  const ok = { nama_stel: "Set Gamis Merah", harga: 170000, jenis_kelamin: "L" as JenisKelaminHarga };
  it("lolos untuk isian wajar, termasuk harga 0", () => {
    expect(validasiHarga(ok)).toBeNull();
    expect(validasiHarga({ ...ok, harga: 0 })).toBeNull();
  });
  it("menolak nama kosong, nama > 80 karakter, harga negatif/pecahan, jenis kelamin tidak dikenal", () => {
    expect(validasiHarga({ ...ok, nama_stel: "  " })).toBe("Isi nama stel.");
    expect(validasiHarga({ ...ok, nama_stel: "x".repeat(81) })).toBe("Nama stel maksimal 80 karakter.");
    expect(validasiHarga({ ...ok, harga: -1 })).toBe("Harga harus bilangan bulat rupiah, minimal 0.");
    expect(validasiHarga({ ...ok, harga: 1.5 })).toBe("Harga harus bilangan bulat rupiah, minimal 0.");
    expect(validasiHarga({ ...ok, jenis_kelamin: "X" as JenisKelaminHarga })).toBe("Pilih jenis kelamin: L, P, atau semua.");
  });
});

describe("salinanHarga", () => {
  const sumber = [
    harga({ id: "a" }),
    harga({ id: "b", nama_stel: "Pramuka", jenis_kelamin: "semua", ukuran: [], harga: 260000 }),
    harga({ id: "c", aktif: false }),
    harga({ id: "d", departemen_id: SD }),
  ];
  it("menyalin baris aktif milik lembaga itu ke tahun tujuan, tanpa id", () => {
    const hasil = salinanHarga(sumber, { tahunAjaranId: "ta-2028", departemenId: TK, existing: [] });
    expect(hasil).toHaveLength(2);
    expect(hasil.every((r) => r.tahun_ajaran_id === "ta-2028" && r.departemen_id === TK && r.aktif === true)).toBe(true);
    expect(hasil.map((r) => r.nama_stel).sort()).toEqual(["Pramuka", "Set Gamis Merah"]);
    expect(hasil.every((r) => !("id" in r))).toBe(true);
  });
  it("tidak menyalin bila tahun tujuan sudah punya baris (aktif atau tidak) untuk lembaga itu", () => {
    const sudahAda = [harga({ id: "x", tahun_ajaran_id: "ta-2028", aktif: false })];
    expect(salinanHarga(sumber, { tahunAjaranId: "ta-2028", departemenId: TK, existing: sudahAda })).toEqual([]);
  });
});

describe("pesanGalatHarga", () => {
  it("memetakan kode galat basis data ke pesan yang bisa dipahami", () => {
    expect(pesanGalatHarga({ code: "23P01", message: "x" })).toMatch(/bertabrakan/i);
    expect(pesanGalatHarga({ code: "42501", message: "x" })).toMatch(/tidak berhak/i);
    expect(pesanGalatHarga({ code: "23514", message: "x" })).toMatch(/tidak valid/i);
    expect(pesanGalatHarga({ message: "lainnya" })).toBe("lainnya");
    expect(pesanGalatHarga(null)).toBe("Terjadi kesalahan.");
  });
});
