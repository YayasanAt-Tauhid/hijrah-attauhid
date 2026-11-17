import { describe, expect, it } from "vitest";
import {
  BULAN_KALENDER,
  akhirBulan,
  buildBukuBesarSemuaAoa,
  buildBukuBesarSingleAoa,
  hitungSaldoBerjalan,
  kelompokkanPerAkun,
  parseTahunInput,
  periodeBukuBesar,
} from "./bukuBesar";

const kas = { id: "a1", kode: "1-1001", nama: "Kas Kecil", saldo_normal: "D", jenis: "aset" };
const spp = { id: "a2", kode: "4-1001", nama: "Pendapatan SPP", saldo_normal: "K", jenis: "pendapatan" };
const sepi = { id: "a3", kode: "5-9999", nama: "Akun Tanpa Aktivitas", saldo_normal: "D", jenis: "beban" };

const m = (o: Record<string, unknown>) => ({
  tanggal: "2026-03-05", nomor: "JU-1", lembaga: "SMP", keterangan: "Setoran", debit: 0, kredit: 0, tipe: "normal", ...o,
});

describe("BULAN_KALENDER", () => {
  it("berurutan Januari–Desember sesuai logika saldo awal per tahun kalender", () => {
    expect(BULAN_KALENDER).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("parseTahunInput", () => {
  it("hanya menerima tahun 4 digit yang wajar", () => {
    expect(parseTahunInput("2026")).toBe(2026);
    expect(parseTahunInput(" 2026 ")).toBe(2026);
  });

  it("menolak nilai antara saat mengetik dan nilai tidak valid", () => {
    for (const bad of ["", "2", "20", "202", "20266", "0", "1999", "2101", "2026.5", "abc", "-2026"]) {
      expect(parseTahunInput(bad)).toBeNull();
    }
  });
});

describe("akhirBulan", () => {
  it("menangani Februari kabisat dan bulan 30/31 hari", () => {
    expect(akhirBulan(2024, 2)).toBe("2024-02-29");
    expect(akhirBulan(2026, 2)).toBe("2026-02-28");
    expect(akhirBulan(2026, 4)).toBe("2026-04-30");
    expect(akhirBulan(2026, 12)).toBe("2026-12-31");
  });
});

describe("periodeBukuBesar", () => {
  it("menghasilkan tanggal awal/akhir untuk periode valid", () => {
    expect(periodeBukuBesar(2026, 1, 12)).toEqual({ valid: true, tglAwal: "2026-01-01", tglAkhir: "2026-12-31" });
    expect(periodeBukuBesar(2026, 7, 7)).toEqual({ valid: true, tglAwal: "2026-07-01", tglAkhir: "2026-07-31" });
  });

  it("menandai Dari > Sampai tidak valid (query tidak boleh jalan)", () => {
    expect(periodeBukuBesar(2026, 7, 6)).toEqual({ valid: false, alasan: "urutan" });
  });

  it("menandai tahun kosong/tidak valid tidak valid", () => {
    expect(periodeBukuBesar(null, 1, 12)).toEqual({ valid: false, alasan: "tahun" });
  });
});

describe("hitungSaldoBerjalan", () => {
  it("akun saldo normal debit: debit menambah, kredit mengurangi", () => {
    const rows = hitungSaldoBerjalan(1000, [m({ debit: 500 }), m({ kredit: 200 })], "D");
    expect(rows.map((r) => r.saldo)).toEqual([1500, 1300]);
  });

  it("akun saldo normal kredit: kredit menambah, debit mengurangi", () => {
    const rows = hitungSaldoBerjalan(1000, [m({ kredit: 500 }), m({ debit: 200 })], "K");
    expect(rows.map((r) => r.saldo)).toEqual([1500, 1300]);
  });
});

describe("kelompokkanPerAkun", () => {
  const akunList = [kas, spp, sepi];
  const saldoAwal = { a1: 1000, a2: 0, a3: 0 };
  const mutasi = [
    { ...m({ debit: 500 }), akun_id: "a1" },
    { ...m({ kredit: 500, nomor: "JU-1" }), akun_id: "a2" },
    { ...m({ kredit: 200, nomor: "JU-2" }), akun_id: "a1" },
  ];
  const groups = kelompokkanPerAkun(akunList, saldoAwal, mutasi);

  it("hanya memuat akun yang punya saldo awal atau mutasi, urutan mengikuti daftar akun", () => {
    expect(groups.map((g) => g.akun.kode)).toEqual(["1-1001", "4-1001"]);
  });

  it("menghitung total dan saldo akhir per akun, saldo berjalan tidak tercampur antar akun", () => {
    const g1 = groups[0];
    expect(g1.saldoAwal).toBe(1000);
    expect(g1.totalDebit).toBe(500);
    expect(g1.totalKredit).toBe(200);
    expect(g1.saldoAkhir).toBe(1300);
    expect(g1.rows.map((r) => r.saldo)).toEqual([1500, 1300]);
    expect(groups[1].saldoAkhir).toBe(500);
  });

  it("akun dengan saldo awal tanpa mutasi tetap muncul", () => {
    const g = kelompokkanPerAkun([kas], { a1: 750 }, []);
    expect(g).toHaveLength(1);
    expect(g[0].saldoAkhir).toBe(750);
  });
});

describe("buildBukuBesarSingleAoa", () => {
  const info = { unitLabel: "Semua Unit", periodeLabel: "1 Januari 2026 s/d 31 Desember 2026" };
  const rows = hitungSaldoBerjalan(1000, [m({ debit: 500 }), m({ kredit: 200, tipe: "pembalik" })], "D");
  const aoa = buildBukuBesarSingleAoa({ ...info, akun: kas, saldoAwal: 1000, rows });
  const flat = aoa.map((r) => r.join("|"));

  it("memuat header akun, unit, dan periode", () => {
    expect(flat).toContain("Akun|1-1001 - Kas Kecil");
    expect(flat).toContain("Saldo Normal|Debit");
    expect(flat).toContain("Unit|Semua Unit");
    expect(flat).toContain("Periode|1 Januari 2026 s/d 31 Desember 2026");
  });

  it("memuat saldo awal, baris mutasi (angka), dan total", () => {
    const h = aoa.findIndex((r) => r[0] === "Tanggal");
    expect(aoa[h]).toEqual(["Tanggal", "No. Jurnal", "Tipe", "Lembaga", "Keterangan", "Debit", "Kredit", "Saldo"]);
    expect(aoa[h + 1]).toEqual(["", "", "", "", "Saldo Awal", "", "", 1000]);
    expect(aoa[h + 2]).toEqual(["2026-03-05", "JU-1", "Normal", "SMP", "Setoran", 500, 0, 1500]);
    expect(aoa[h + 3][2]).toBe("Pembalik");
    expect(aoa[h + 4]).toEqual(["", "", "", "", "Total", 500, 200, 1300]);
  });

  it("menetralkan formula injection pada keterangan", () => {
    const r = hitungSaldoBerjalan(0, [m({ keterangan: "=1+1", debit: 1 })], "D");
    const x = buildBukuBesarSingleAoa({ ...info, akun: kas, saldoAwal: 0, rows: r });
    expect(x.some((row) => row[4] === "'=1+1")).toBe(true);
  });
});

describe("buildBukuBesarSemuaAoa", () => {
  const groups = kelompokkanPerAkun(
    [kas, spp],
    { a1: 1000, a2: 0 },
    [
      { ...m({ debit: 500 }), akun_id: "a1" },
      { ...m({ kredit: 500 }), akun_id: "a2" },
    ],
  );
  const aoa = buildBukuBesarSemuaAoa({ unitLabel: "Semua Unit", periodeLabel: "Jan–Des 2026", groups });

  it("1 sheet datar dengan kolom akun, saldo awal, mutasi, dan total per akun", () => {
    const h = aoa.findIndex((r) => r[0] === "Kode Akun");
    expect(aoa[h]).toEqual(["Kode Akun", "Nama Akun", "Tanggal", "No. Jurnal", "Tipe", "Lembaga", "Keterangan", "Debit", "Kredit", "Saldo"]);
    expect(aoa[h + 1]).toEqual(["1-1001", "Kas Kecil", "", "", "", "", "Saldo Awal", "", "", 1000]);
    expect(aoa[h + 2]).toEqual(["1-1001", "Kas Kecil", "2026-03-05", "JU-1", "Normal", "SMP", "Setoran", 500, 0, 1500]);
    expect(aoa[h + 3]).toEqual(["1-1001", "Kas Kecil", "", "", "", "", "Total", 500, 0, 1500]);
    expect(aoa[h + 4][0]).toBe("4-1001");
  });

  it("memuat info unit dan periode di bagian atas", () => {
    const flat = aoa.map((r) => r.join("|"));
    expect(flat).toContain("Unit|Semua Unit");
    expect(flat).toContain("Periode|Jan–Des 2026");
  });
});
