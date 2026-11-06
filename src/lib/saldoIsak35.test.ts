import { describe, expect, it } from "vitest";
import { hitungSaldoMenurutPos, sisiAlamiPos } from "./saldoIsak35";

describe("sisiAlamiPos", () => {
  it.each([
    ["aset_lancar", "D"],
    ["aset_tidak_lancar", "D"],
    ["beban_program", "D"],
    ["beban_penunjang", "D"],
    ["beban_terbatas", "D"],
    ["kewajiban_jangka_pendek", "K"],
    ["kewajiban_jangka_panjang", "K"],
    ["aset_neto_tidak_terikat", "K"],
    ["aset_neto_terikat_temporer", "K"],
    ["aset_neto_terikat_permanen", "K"],
    ["pendapatan_tidak_terikat", "K"],
    ["pendapatan_terikat_temporer", "K"],
    ["pendapatan_terikat_permanen", "K"],
    ["pkl", "K"],
  ])("%s bersisi %s", (pos, sisi) => {
    expect(sisiAlamiPos(pos)).toBe(sisi);
  });

  it("pos yang tidak dikenal tidak punya sisi alami", () => {
    expect(sisiAlamiPos("lain_lain")).toBeNull();
  });
});

describe("hitungSaldoMenurutPos", () => {
  const hitung = (over: Partial<Parameters<typeof hitungSaldoMenurutPos>[0]>) =>
    hitungSaldoMenurutPos({ pos: "aset_lancar", saldoNormal: "D", saldoAwal: 0, debit: 0, kredit: 0, ...over });

  it("akun lazim bernilai sama seperti sebelumnya: aset bersaldo normal debit", () => {
    expect(hitung({ saldoAwal: 100, debit: 50, kredit: 20 })).toBe(130);
  });

  it("akun lazim: liabilitas bersaldo normal kredit", () => {
    expect(hitung({ pos: "kewajiban_jangka_pendek", saldoNormal: "K", saldoAwal: 100, debit: 20, kredit: 50 })).toBe(130);
  });

  it("kontra-pendapatan (saldo normal debit) bernilai NEGATIF sehingga mengurangi pendapatan", () => {
    expect(hitung({ pos: "pendapatan_tidak_terikat", saldoNormal: "D", debit: 47_100_000 })).toBe(-47_100_000);
  });

  it("kontra-pendapatan dengan pembalikan sebagian dihitung bersih", () => {
    expect(hitung({ pos: "pendapatan_tidak_terikat", saldoNormal: "D", debit: 64_000_000, kredit: 3_200_000 })).toBe(-60_800_000);
  });

  it("saldo awal kontra-akun dibaca menurut sisi akunnya sendiri (saldo normal debit = saldo debit)", () => {
    expect(hitung({ pos: "pendapatan_tidak_terikat", saldoNormal: "D", saldoAwal: 10 })).toBe(-10);
  });

  it("kontra-aset (mis. akumulasi penyusutan, saldo normal kredit) bernilai negatif di aset", () => {
    expect(hitung({ pos: "aset_tidak_lancar", saldoNormal: "K", saldoAwal: 100, kredit: 20 })).toBe(-120);
  });

  it("kontra-beban (saldo normal kredit) mengurangi beban", () => {
    expect(hitung({ pos: "beban_program", saldoNormal: "K", kredit: 30 })).toBe(-30);
  });

  it("pos tak dikenal jatuh kembali ke saldo normal akunnya", () => {
    expect(hitung({ pos: "lain_lain", saldoNormal: "K", saldoAwal: 5, debit: 1, kredit: 4 })).toBe(8);
  });

  it("menerima penulisan lama 'debit' untuk saldo normal", () => {
    expect(hitung({ saldoNormal: "debit", debit: 10 })).toBe(10);
  });
});
