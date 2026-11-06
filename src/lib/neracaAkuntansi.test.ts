import { describe, expect, it } from "vitest";
import { resolveKelompok, susunNeracaAkuntansi } from "./neracaAkuntansi";

const akun = (id: string, kode: string, pos: string | null, saldo_normal: string, jenis = "x", saldo_awal = 0) => ({
  id, kode, nama: `Akun ${kode}`, jenis, pos_isak35: pos, saldo_normal, saldo_awal,
});

describe("resolveKelompok", () => {
  it("memetakan pos ISAK 35", () => {
    expect(resolveKelompok(akun("1", "1", "aset_lancar", "D"))).toBe("aset");
    expect(resolveKelompok(akun("1", "1", "kewajiban_jangka_panjang", "K"))).toBe("kewajiban");
    expect(resolveKelompok(akun("1", "1", "aset_neto_tidak_terikat", "K"))).toBe("aset_neto");
    expect(resolveKelompok(akun("1", "1", "pendapatan_tidak_terikat", "K"))).toBe("pendapatan");
    expect(resolveKelompok(akun("1", "1", "beban_program", "D"))).toBe("beban");
  });

  it("jatuh kembali ke kolom jenis (termasuk alias lama) bila pos kosong", () => {
    expect(resolveKelompok(akun("1", "1", null, "K", "liabilitas"))).toBe("kewajiban");
    expect(resolveKelompok(akun("1", "1", null, "K", "ekuitas"))).toBe("aset_neto");
    expect(resolveKelompok(akun("1", "1", null, "D", "mistis"))).toBeNull();
  });
});

describe("susunNeracaAkuntansi dengan akun kontra-pendapatan", () => {
  // J1: D Kas 800, D Potongan 200, K Pendapatan 1000 | J2: D Beban 300, K Kas 300 | J3: D Kas 100, K Utang 100
  const daftar = [
    akun("kas", "1100", "aset_lancar", "D"),
    akun("utang", "2100", "kewajiban_jangka_pendek", "K"),
    akun("spp", "4100", "pendapatan_tidak_terikat", "K"),
    akun("potongan", "4601", "pendapatan_tidak_terikat", "D"),
    akun("beban", "5100", "beban_program", "D"),
  ];
  const mutasi = new Map([
    ["kas", { debit: 900, kredit: 300 }],
    ["utang", { debit: 0, kredit: 100 }],
    ["spp", { debit: 0, kredit: 1000 }],
    ["potongan", { debit: 200, kredit: 0 }],
    ["beban", { debit: 300, kredit: 0 }],
  ]);

  it("potongan mengurangi surplus sehingga neraca seimbang", () => {
    const { items, surplusDefisit } = susunNeracaAkuntansi(daftar, mutasi);
    const totalAset = items.filter((i) => i.kelompok === "aset").reduce((s, i) => s + i.saldo, 0);
    const totalKewajiban = items.filter((i) => i.kelompok === "kewajiban").reduce((s, i) => s + i.saldo, 0);

    expect(surplusDefisit).toBe(500);
    expect(totalAset).toBe(600);
    expect(totalAset).toBe(totalKewajiban + surplusDefisit);
  });

  it("item neraca terurut menurut kode dan hanya memuat aset, kewajiban, dan aset neto", () => {
    const { items } = susunNeracaAkuntansi(daftar, mutasi);
    expect(items.map((i) => i.kode)).toEqual(["1100", "2100"]);
  });

  it("saldo awal akun ikut dihitung menurut sisi akunnya", () => {
    const { items } = susunNeracaAkuntansi([akun("kas", "1100", "aset_lancar", "D", "aset", 50)], new Map([["kas", { debit: 10, kredit: 0 }]]));
    expect(items[0].saldo).toBe(60);
  });
});
