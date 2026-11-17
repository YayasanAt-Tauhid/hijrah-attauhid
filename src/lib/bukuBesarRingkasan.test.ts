import { describe, expect, it } from "vitest";
import {
  buildBukuBesarRingkasanAoa,
  filterRingkasan,
  hitungRingkasanPerAkun,
  kelompokkanPerAkun,
  totalRingkasan,
} from "./bukuBesar";

const kas = { id: "a1", kode: "1-1001", nama: "Kas Kecil", saldo_normal: "D", jenis: "aset", aktif: true };
const spp = { id: "a2", kode: "4-1001", nama: "Pendapatan SPP", saldo_normal: "K", jenis: "pendapatan", aktif: true };
const sepi = { id: "a3", kode: "5-9999", nama: "Akun Tanpa Aktivitas", saldo_normal: "D", jenis: "beban", aktif: true };
const lama = { id: "a4", kode: "1-9000", nama: "Kas Lama", saldo_normal: "D", jenis: "aset", aktif: false };
const akunList = [kas, spp, sepi, lama];

const ringkasan = [
  { akun_id: "a1", total_debit: 150000, total_kredit: 40000, jumlah: 3 },
  { akun_id: "a2", total_debit: 0, total_kredit: 150000, jumlah: 2 },
  { akun_id: "a4", total_debit: 0, total_kredit: 5000, jumlah: 1 },
];
const saldoAwal = { a1: 1000000, a2: 200000 };

describe("hitungRingkasanPerAkun", () => {
  const hasil = hitungRingkasanPerAkun(akunList, saldoAwal, ringkasan);

  it("mengikuti urutan daftar akun dan membuang akun tanpa saldo awal dan tanpa mutasi", () => {
    expect(hasil.map((r) => r.akun.id)).toEqual(["a1", "a2", "a4"]);
  });

  it("saldo akhir akun bersaldo normal debit = awal + debit - kredit", () => {
    const r = hasil.find((x) => x.akun.id === "a1")!;
    expect(r).toMatchObject({ saldoAwal: 1000000, totalDebit: 150000, totalKredit: 40000, jumlah: 3, saldoAkhir: 1110000 });
  });

  it("saldo akhir akun bersaldo normal kredit = awal + kredit - debit", () => {
    expect(hasil.find((x) => x.akun.id === "a2")!.saldoAkhir).toBe(350000);
  });

  it("akun nonaktif dengan mutasi tetap tampil, saldo awal kosong dianggap 0", () => {
    const r = hasil.find((x) => x.akun.id === "a4")!;
    expect(r).toMatchObject({ saldoAwal: 0, totalKredit: 5000, saldoAkhir: -5000 });
  });

  it("akun hanya bersaldo awal (tanpa mutasi) tetap tampil dengan saldo akhir = saldo awal", () => {
    const r = hitungRingkasanPerAkun(akunList, { a3: 700 }, []);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ saldoAwal: 700, jumlah: 0, totalDebit: 0, totalKredit: 0, saldoAkhir: 700 });
  });

  it("angka berupa string dari database dikonversi menjadi number", () => {
    const r = hitungRingkasanPerAkun(
      [kas],
      { a1: "100" as unknown as number },
      [{ akun_id: "a1", total_debit: "50" as unknown as number, total_kredit: "20" as unknown as number, jumlah: "2" as unknown as number }],
    );
    expect(r[0]).toMatchObject({ saldoAwal: 100, totalDebit: 50, totalKredit: 20, jumlah: 2, saldoAkhir: 130 });
  });

  it("setara dengan hasil pengelompokan mutasi rinci (angka layar ringkasan = angka export rinci)", () => {
    const mutasi = [
      { akun_id: "a1", tanggal: "2026-03-01", nomor: "J1", lembaga: "SMP", keterangan: "a", debit: 100000, kredit: 0, tipe: "normal" },
      { akun_id: "a1", tanggal: "2026-03-02", nomor: "J2", lembaga: "SMP", keterangan: "b", debit: 50000, kredit: 0, tipe: "normal" },
      { akun_id: "a1", tanggal: "2026-03-03", nomor: "J3", lembaga: "SMP", keterangan: "c", debit: 0, kredit: 40000, tipe: "normal" },
      { akun_id: "a2", tanggal: "2026-03-01", nomor: "J1", lembaga: "SMP", keterangan: "d", debit: 0, kredit: 100000, tipe: "normal" },
      { akun_id: "a2", tanggal: "2026-03-02", nomor: "J2", lembaga: "SMP", keterangan: "e", debit: 0, kredit: 50000, tipe: "normal" },
      { akun_id: "a4", tanggal: "2026-03-09", nomor: "J9", lembaga: "SMP", keterangan: "f", debit: 0, kredit: 5000, tipe: "normal" },
    ];
    const rinci = kelompokkanPerAkun(akunList, saldoAwal, mutasi);
    expect(hasil.map((r) => ({ id: r.akun.id, a: r.saldoAwal, d: r.totalDebit, k: r.totalKredit, s: r.saldoAkhir, n: r.jumlah })))
      .toEqual(rinci.map((g) => ({ id: g.akun.id, a: g.saldoAwal, d: g.totalDebit, k: g.totalKredit, s: g.saldoAkhir, n: g.rows.length })));
  });
});

describe("filterRingkasan", () => {
  const hasil = hitungRingkasanPerAkun(akunList, { ...saldoAwal, a3: 700 }, ringkasan);

  it("tanpa filter mengembalikan semua", () => {
    expect(filterRingkasan(hasil, { cari: "", hanyaBermutasi: false })).toHaveLength(4);
  });

  it("hanyaBermutasi membuang akun yang hanya punya saldo awal", () => {
    expect(filterRingkasan(hasil, { cari: "", hanyaBermutasi: true }).map((r) => r.akun.id)).toEqual(["a1", "a2", "a4"]);
  });

  it("cari bekerja pada kode dan nama, tanpa membedakan huruf besar/kecil, dan mengabaikan spasi tepi", () => {
    expect(filterRingkasan(hasil, { cari: "  spp ", hanyaBermutasi: false }).map((r) => r.akun.id)).toEqual(["a2"]);
    expect(filterRingkasan(hasil, { cari: "1-90", hanyaBermutasi: false }).map((r) => r.akun.id)).toEqual(["a4"]);
    expect(filterRingkasan(hasil, { cari: "tidak ada", hanyaBermutasi: false })).toEqual([]);
  });

  it("filter digabung (AND)", () => {
    expect(filterRingkasan(hasil, { cari: "kas", hanyaBermutasi: true }).map((r) => r.akun.id)).toEqual(["a1", "a4"]);
  });
});

describe("totalRingkasan", () => {
  it("menjumlahkan debit, kredit, dan jumlah transaksi", () => {
    const hasil = hitungRingkasanPerAkun(akunList, saldoAwal, ringkasan);
    expect(totalRingkasan(hasil)).toEqual({ totalDebit: 150000, totalKredit: 195000, jumlah: 6 });
    expect(totalRingkasan([])).toEqual({ totalDebit: 0, totalKredit: 0, jumlah: 0 });
  });
});

describe("buildBukuBesarRingkasanAoa", () => {
  it("memuat judul, unit, periode, header, satu baris per akun, dan total", () => {
    const hasil = hitungRingkasanPerAkun(akunList, saldoAwal, ringkasan);
    const aoa = buildBukuBesarRingkasanAoa({ unitLabel: "Semua Unit", periodeLabel: "1 Januari 2026 s/d 31 Desember 2026", items: hasil });
    expect(aoa[0]).toEqual(["Ringkasan Buku Besar - Semua Akun Rekening"]);
    expect(aoa[1]).toEqual(["Unit", "Semua Unit"]);
    expect(aoa[2]).toEqual(["Periode", "1 Januari 2026 s/d 31 Desember 2026"]);
    const hIdx = aoa.findIndex((r) => r[0] === "Kode Akun");
    expect(aoa[hIdx]).toEqual(["Kode Akun", "Nama Akun", "Saldo Awal", "Debit", "Kredit", "Saldo Akhir", "Jumlah Transaksi"]);
    expect(aoa[hIdx + 1]).toEqual(["1-1001", "Kas Kecil", 1000000, 150000, 40000, 1110000, 3]);
    expect(aoa.filter((r) => r[0] === "1-1001" || r[0] === "4-1001" || r[0] === "1-9000")).toHaveLength(3);
    expect(aoa[aoa.length - 1]).toEqual(["Total", "", "", 150000, 195000, "", 6]);
  });

  it("teks berawalan rumus dinetralkan (aman untuk Excel)", () => {
    const aneh = hitungRingkasanPerAkun(
      [{ id: "x", kode: "=1+1", nama: "@cmd", saldo_normal: "D" }],
      {},
      [{ akun_id: "x", total_debit: 1, total_kredit: 0, jumlah: 1 }],
    );
    const aoa = buildBukuBesarRingkasanAoa({ unitLabel: "-", periodeLabel: "-", items: aneh });
    const baris = aoa.find((r) => r[2] === 0 && r[3] === 1)!;
    expect(String(baris[0])).not.toMatch(/^[=+\-@]/);
    expect(String(baris[1])).not.toMatch(/^[=+\-@]/);
  });
});
