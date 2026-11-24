// Logika murni halaman Proyeksi Tagihan SPP: normalisasi baris RPC ringkasan_tagihan_periode,
// pivot lembaga x 12 bulan, dan ringkasan setahun.
import { describe, expect, it } from "vitest";
import { normalisasiBaris, ringkasTahun, susunMatriks, type BarisRingkasan } from "./proyeksiTagihan";

const baris = (o: Partial<BarisRingkasan>): BarisRingkasan => ({
  departemen_id: "d-sd",
  departemen_kode: "SD",
  tahun: 2027,
  bulan: 1,
  jumlah_siswa: 10,
  jumlah_tagihan: 10,
  bruto: 0,
  potongan: 0,
  neto: 0,
  terbayar: 0,
  sisa: 0,
  ...o,
});

describe("normalisasiBaris", () => {
  it("mengubah angka berbentuk string dari Rustbase (numeric) menjadi number", () => {
    const hasil = normalisasiBaris({
      departemen_id: "d-sd",
      departemen_kode: "SD",
      tahun: "2027",
      bulan: "1",
      jumlah_siswa: "661",
      jumlah_tagihan: "661",
      bruto: "274200000.00",
      potongan: "9700000.00",
      neto: "264500000.00",
      terbayar: "2650000.00",
      sisa: "261850000.00",
    });
    expect(hasil).toEqual({
      departemen_id: "d-sd",
      departemen_kode: "SD",
      tahun: 2027,
      bulan: 1,
      jumlah_siswa: 661,
      jumlah_tagihan: 661,
      bruto: 274200000,
      potongan: 9700000,
      neto: 264500000,
      terbayar: 2650000,
      sisa: 261850000,
    });
  });

  it("angka kosong atau null dianggap 0 dan kode lembaga kosong menjadi string kosong", () => {
    const hasil = normalisasiBaris({ departemen_id: "x", departemen_kode: null, tahun: 2027, bulan: 3, neto: null });
    expect(hasil.neto).toBe(0);
    expect(hasil.sisa).toBe(0);
    expect(hasil.departemen_kode).toBe("");
  });
});

describe("susunMatriks", () => {
  const data = [
    baris({ departemen_id: "d-smp", departemen_kode: "SMP", bulan: 1, neto: 50, bruto: 60, potongan: 10, jumlah_tagihan: 5 }),
    baris({ bulan: 2, neto: 200, bruto: 210, potongan: 10, terbayar: 40, sisa: 160, jumlah_tagihan: 20 }),
    baris({ bulan: 1, neto: 100, bruto: 120, potongan: 20, jumlah_tagihan: 12 }),
  ];

  it("satu baris per lembaga, diurutkan menurut kode, dengan 12 kolom bulan (neto, 0 bila kosong)", () => {
    const m = susunMatriks(data);
    expect(m.lembaga.map((l) => l.kode)).toEqual(["SD", "SMP"]);
    const sd = m.lembaga[0];
    expect(sd.perBulan).toHaveLength(12);
    expect(sd.perBulan.slice(0, 3)).toEqual([100, 200, 0]);
    expect(sd.perBulan.slice(3).every((v) => v === 0)).toBe(true);
    expect(m.lembaga[1].perBulan[0]).toBe(50);
  });

  it("total per lembaga menjumlahkan semua bulan", () => {
    const sd = susunMatriks(data).lembaga[0];
    expect(sd).toMatchObject({ jumlahTagihan: 32, bruto: 330, potongan: 30, neto: 300, terbayar: 40, sisa: 160 });
  });

  it("total semua lembaga per bulan dan keseluruhan", () => {
    const m = susunMatriks(data);
    expect(m.netoPerBulan.slice(0, 3)).toEqual([150, 200, 0]);
    expect(m.total).toMatchObject({ jumlahTagihan: 37, bruto: 390, potongan: 40, neto: 350, terbayar: 40, sisa: 160 });
  });

  it("tanpa data menghasilkan matriks kosong, bukan galat", () => {
    const m = susunMatriks([]);
    expect(m.lembaga).toEqual([]);
    expect(m.netoPerBulan).toEqual(Array(12).fill(0));
    expect(m.total.neto).toBe(0);
  });
});

describe("ringkasTahun", () => {
  it("total neto, rata-rata hanya atas bulan yang punya tagihan, dan bulan tertinggi", () => {
    const m = susunMatriks([
      baris({ bulan: 1, neto: 150 }),
      baris({ bulan: 2, neto: 200 }),
    ]);
    expect(ringkasTahun(m)).toEqual({ totalNeto: 350, rataPerBulan: 175, bulanTertinggi: { bulan: 2, nilai: 200 } });
  });

  it("tanpa data: total 0, rata-rata 0, tidak ada bulan tertinggi", () => {
    expect(ringkasTahun(susunMatriks([]))).toEqual({ totalNeto: 0, rataPerBulan: 0, bulanTertinggi: null });
  });
});
