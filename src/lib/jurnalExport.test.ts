import { describe, expect, it } from "vitest";
import {
  JURNAL_BULK_HEADERS,
  buildJurnalBulkRows,
  buildJurnalSingleAoa,
  jurnalSingleFilename,
  labelPenginput,
  labelTipeJurnal,
} from "./jurnalExport";

const jurnalA = {
  id: "j1",
  nomor: "JU-2026-0001",
  tanggal: "2026-11-05",
  status: "posted",
  tipe: "normal",
  keterangan: "Setoran SPP Oktober",
  referensi: null,
  departemen: { kode: "SMP", nama: "SMP At-Tauhid" },
  penginput: { nama: "Fitri Yanto" },
  total_debit: 500000,
  total_kredit: 500000,
};

const detailsA = [
  { urutan: 2, keterangan: "Pendapatan SPP", debit: 0, kredit: 500000, akun_rekening: { kode: "4-1001", nama: "Pendapatan SPP" } },
  { urutan: 1, keterangan: "Kas", debit: 500000, kredit: 0, akun_rekening: { kode: "1-1001", nama: "Kas Kecil" } },
];

describe("labelTipeJurnal", () => {
  it("memetakan tipe ke label yang sama dengan badge di layar", () => {
    expect(labelTipeJurnal("normal", false)).toBe("Normal");
    expect(labelTipeJurnal(null, false)).toBe("Normal");
    expect(labelTipeJurnal("pembalik", false)).toBe("Pembalik");
    expect(labelTipeJurnal("pengganti", false)).toBe("Pengganti");
  });

  it("jurnal normal yang sudah dikoreksi berlabel Dikoreksi", () => {
    expect(labelTipeJurnal("normal", true)).toBe("Dikoreksi");
    expect(labelTipeJurnal(null, true)).toBe("Dikoreksi");
  });
});

describe("labelPenginput", () => {
  it("memakai nama penginput bila ada", () => {
    expect(labelPenginput({ penginput: { nama: "Bagus Dewantoro" }, referensi: null })).toBe("Bagus Dewantoro");
  });

  it("jurnal webhook online payment (referensi HAT-) berlabel otomatis", () => {
    expect(labelPenginput({ penginput: null, referensi: "HAT-123" })).toBe("Otomatis (Online Payment)");
  });

  it("selain itu strip", () => {
    expect(labelPenginput({ penginput: null, referensi: "MANUAL-1" })).toBe("-");
    expect(labelPenginput({})).toBe("-");
  });
});

describe("buildJurnalBulkRows", () => {
  it("menghasilkan 1 baris per baris akun, terurut sesuai urutan, dengan nilai terbaca (bukan JSON)", () => {
    const rows = buildJurnalBulkRows([jurnalA], { j1: detailsA }, new Set());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      "JU-2026-0001", "2026-11-05", "Posted", "Normal", "SMP", "Fitri Yanto",
      "Setoran SPP Oktober", "1-1001", "Kas Kecil", "Kas", 500000, 0,
    ]);
    expect(rows[1][7]).toBe("4-1001");
    expect(rows[1][10]).toBe(0);
    expect(rows[1][11]).toBe(500000);
    expect(rows[0]).toHaveLength(JURNAL_BULK_HEADERS.length);
    expect(JSON.stringify(rows)).not.toContain('{"');
  });

  it("jurnal tanpa baris detail tetap muncul 1 baris (tidak hilang dari export)", () => {
    const rows = buildJurnalBulkRows([jurnalA], {}, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("JU-2026-0001");
    expect(rows[0][7]).toBe("");
    expect(rows[0][10]).toBe(0);
    expect(rows[0][11]).toBe(0);
  });

  it("menandai jurnal yang sudah dikoreksi dan draft", () => {
    const draft = { ...jurnalA, id: "j2", nomor: "JU-2026-0002", status: "draft" };
    const rows = buildJurnalBulkRows([jurnalA, draft], { j1: detailsA, j2: detailsA }, new Set(["j1"]));
    expect(rows[0][3]).toBe("Dikoreksi");
    expect(rows[2][2]).toBe("Draft");
  });

  it("menetralkan formula injection pada teks bebas", () => {
    const j = { ...jurnalA, keterangan: "=HYPERLINK(\"http://x\")" };
    const d = [{ urutan: 1, keterangan: "+cmd", debit: 1, kredit: 0, akun_rekening: { kode: "1", nama: "@A" } }];
    const [row] = buildJurnalBulkRows([j], { j1: d }, new Set());
    expect(row[6]).toBe("'=HYPERLINK(\"http://x\")");
    expect(row[8]).toBe("'@A");
    expect(row[9]).toBe("'+cmd");
  });
});

describe("buildJurnalSingleAoa", () => {
  const aoa = buildJurnalSingleAoa({ ...jurnalA, details: detailsA }, false);
  const flat = aoa.map((r) => r.join("|"));

  it("memuat header jurnal lengkap", () => {
    expect(flat).toContain("Nomor|JU-2026-0001");
    expect(flat).toContain("Tanggal|5 November 2026");
    expect(flat).toContain("Status|Posted");
    expect(flat).toContain("Lembaga|SMP");
    expect(flat).toContain("Diinput Oleh|Fitri Yanto");
    expect(flat).toContain("Keterangan|Setoran SPP Oktober");
  });

  it("memuat tabel akun terurut + baris total berisi angka", () => {
    const headerIdx = aoa.findIndex((r) => r[0] === "Kode Akun");
    expect(aoa[headerIdx]).toEqual(["Kode Akun", "Nama Akun", "Keterangan", "Debit", "Kredit"]);
    expect(aoa[headerIdx + 1]).toEqual(["1-1001", "Kas Kecil", "Kas", 500000, 0]);
    expect(aoa[headerIdx + 2]).toEqual(["4-1001", "Pendapatan SPP", "Pendapatan SPP", 0, 500000]);
    expect(aoa[headerIdx + 3]).toEqual(["", "", "Total", 500000, 500000]);
  });

  it("total dihitung dari baris detail bila total_debit/kredit kosong", () => {
    const x = buildJurnalSingleAoa({ ...jurnalA, total_debit: null, total_kredit: null, details: detailsA }, false);
    expect(x[x.length - 1]).toEqual(["", "", "Total", 500000, 500000]);
  });
});

describe("jurnalSingleFilename", () => {
  it("aman dipakai sebagai nama file", () => {
    expect(jurnalSingleFilename("JU-2026/0001 x")).toBe("jurnal-JU-2026-0001-x");
  });
});
