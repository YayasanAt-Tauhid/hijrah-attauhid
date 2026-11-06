import { describe, expect, it } from "vitest";
import { ringkasLabaRugi, susunJurnalPenutup, type AkunPenutup } from "./jurnalPenutup";

const akun = (over: Partial<AkunPenutup> & Pick<AkunPenutup, "id" | "jenis">): AkunPenutup => ({
  nama: `Akun ${over.id}`, saldo_normal: over.jenis === "pendapatan" ? "K" : "D",
  saldo_awal: 0, totalDebit: 0, totalKredit: 0, ...over,
});

const OPSI = { akunEkuitasId: "neto", label: "Unit Pendidikan", namaTahun: "Tahun 2026" };

const sum = (baris: { debit: number; kredit: number }[], k: "debit" | "kredit") =>
  Math.round(baris.reduce((s, b) => s + b[k], 0) * 100) / 100;

describe("susunJurnalPenutup", () => {
  it("kasus lazim: pendapatan di-debit, beban di-kredit, surplus ke aset neto", () => {
    const hasil = susunJurnalPenutup(
      [akun({ id: "spp", jenis: "pendapatan", totalKredit: 1000 }), akun({ id: "gaji", jenis: "beban", totalDebit: 300 })],
      OPSI,
    );
    expect(hasil.labaRugi).toBe(700);
    expect(hasil.baris).toEqual([
      expect.objectContaining({ akun_id: "spp", debit: 1000, kredit: 0 }),
      expect.objectContaining({ akun_id: "gaji", debit: 0, kredit: 300 }),
      expect.objectContaining({ akun_id: "neto", debit: 0, kredit: 700, keterangan: "Surplus Unit Pendidikan — Tahun 2026" }),
    ]);
    expect(hasil.totalDebit).toBe(1000);
    expect(hasil.totalKredit).toBe(1000);
  });

  it("kontra-pendapatan (saldo normal debit) DI-KREDIT agar saldonya nol, dan mengurangi surplus", () => {
    const hasil = susunJurnalPenutup(
      [
        akun({ id: "spp", jenis: "pendapatan", totalKredit: 1000 }),
        akun({ id: "potongan", jenis: "pendapatan", saldo_normal: "D", totalDebit: 200 }),
        akun({ id: "gaji", jenis: "beban", totalDebit: 300 }),
      ],
      OPSI,
    );
    const potongan = hasil.baris.find((b) => b.akun_id === "potongan");
    expect(potongan).toEqual(expect.objectContaining({ debit: 0, kredit: 200 }));
    expect(hasil.labaRugi).toBe(500);
    expect(hasil.baris.find((b) => b.akun_id === "neto")).toEqual(expect.objectContaining({ kredit: 500 }));
    expect(hasil.totalDebit).toBe(hasil.totalKredit);
    expect(hasil.totalDebit).toBe(1000);
  });

  it("jurnal penutup membuat saldo setiap akun pendapatan dan beban menjadi nol", () => {
    const daftar = [
      akun({ id: "spp", jenis: "pendapatan", totalKredit: 1000, totalDebit: 50 }),
      akun({ id: "potongan", jenis: "pendapatan", saldo_normal: "D", totalDebit: 200, totalKredit: 20 }),
      akun({ id: "gaji", jenis: "beban", totalDebit: 300 }),
      akun({ id: "retur", jenis: "beban", saldo_normal: "K", totalKredit: 40 }),
    ];
    const hasil = susunJurnalPenutup(daftar, OPSI);
    for (const a of daftar) {
      const baris = hasil.baris.filter((b) => b.akun_id === a.id);
      const bersihDebit = a.totalDebit - a.totalKredit + sum(baris, "debit") - sum(baris, "kredit");
      expect(bersihDebit).toBe(0);
    }
    expect(hasil.totalDebit).toBe(hasil.totalKredit);
  });

  it("defisit: aset neto di-debit", () => {
    const hasil = susunJurnalPenutup(
      [akun({ id: "spp", jenis: "pendapatan", totalKredit: 100 }), akun({ id: "gaji", jenis: "beban", totalDebit: 300 })],
      OPSI,
    );
    expect(hasil.labaRugi).toBe(-200);
    expect(hasil.baris.find((b) => b.akun_id === "neto")).toEqual(
      expect.objectContaining({ debit: 200, kredit: 0, keterangan: "Defisit Unit Pendidikan — Tahun 2026" }),
    );
    expect(hasil.totalDebit).toBe(hasil.totalKredit);
  });

  it("melewati akun bersaldo nol dan akun selain pendapatan/beban", () => {
    const hasil = susunJurnalPenutup(
      [
        akun({ id: "nol", jenis: "pendapatan" }),
        akun({ id: "kas", jenis: "aset", totalDebit: 999 }),
        akun({ id: "spp", jenis: "pendapatan", totalKredit: 10 }),
      ],
      OPSI,
    );
    expect(hasil.baris.map((b) => b.akun_id)).toEqual(["spp", "neto"]);
  });

  it("tanpa mutasi sama sekali tidak menghasilkan baris", () => {
    expect(susunJurnalPenutup([akun({ id: "spp", jenis: "pendapatan" })], OPSI).baris).toEqual([]);
  });

  it("jumlah desimal dibulatkan ke sen sehingga total debit dan kredit tetap sama", () => {
    const hasil = susunJurnalPenutup(
      [akun({ id: "a", jenis: "pendapatan", totalKredit: 0.1 }), akun({ id: "b", jenis: "pendapatan", totalKredit: 0.2 })],
      OPSI,
    );
    expect(hasil.totalDebit).toBe(0.3);
    expect(hasil.totalKredit).toBe(0.3);
  });
});

describe("ringkasLabaRugi", () => {
  it("pendapatan neto setelah potongan, beban bertanda", () => {
    const hasil = ringkasLabaRugi([
      akun({ id: "spp", jenis: "pendapatan", totalKredit: 1000 }),
      akun({ id: "potongan", jenis: "pendapatan", saldo_normal: "D", totalDebit: 200 }),
      akun({ id: "gaji", jenis: "beban", totalDebit: 300 }),
    ]);
    expect(hasil).toEqual({ totalPendapatan: 800, totalBeban: 300, labaRugi: 500 });
  });
});
