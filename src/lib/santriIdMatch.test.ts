import { describe, expect, it } from "vitest";
import {
  isOwnNis,
  matchSantriIds,
  parseSipaksaPayload,
  type SipaksaRecord,
  type SiswaRow,
} from "./santriIdMatch";

describe("parseSipaksaPayload", () => {
  it("mengembalikan data bila payload valid", () => {
    const records = parseSipaksaPayload({
      ok: true,
      meta: { total: 2, fetched: 2 },
      data: [{ santriId: "21.01.001" }, { santriId: "21.01.002" }],
    });
    expect(records).toHaveLength(2);
  });

  it.each([null, "teks", 42, [], {}, { ok: false, data: [] }, { ok: true }, { ok: true, data: "x" }])(
    "menolak payload tidak valid: %j",
    (payload) => {
      expect(() => parseSipaksaPayload(payload)).toThrow();
    },
  );

  it("menolak respons terpotong (meta.total lebih besar dari data)", () => {
    expect(() =>
      parseSipaksaPayload({ ok: true, meta: { total: 1146 }, data: [{ santriId: "21.01.001" }] }),
    ).toThrow(/terpotong/i);
  });

  it("menerima payload tanpa meta", () => {
    expect(parseSipaksaPayload({ ok: true, data: [] })).toEqual([]);
  });
});

const siswa = (over: Partial<SiswaRow> & { id: string }): SiswaRow => ({
  nama: "Nama Siswa Bawaan",
  nis: null,
  nisn: null,
  id_santri_pihak3: null,
  ...over,
});

const rec = (over: Partial<SipaksaRecord>): SipaksaRecord => ({
  santriId: "21.01.001",
  nis: null,
  nisn: null,
  nama: "Nama Record Bawaan",
  ...over,
});

describe("isOwnNis", () => {
  it.each(["21-01-001", "26-03-120"])("mengenali NIS mandiri format YY-KK-NNN: %s", (nis) => {
    expect(isOwnNis(nis)).toBe(true);
  });

  it.each([null, undefined, "", "2538027221", "21.01.001", "21-01-1", "ab-01-001"])(
    "bukan NIS mandiri: %s",
    (nis) => {
      expect(isOwnNis(nis)).toBe(false);
    },
  );
});

describe("matchSantriIds", () => {
  it("mencocokkan lewat NISN dan menghasilkan update", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nisn: "0148997558" })],
      [siswa({ id: "s1", nisn: "0148997558" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s1", id_santri_pihak3: "21.01.001", via: "nisn" },
    ]);
    expect(hasil.summary.matched).toBe(1);
  });

  it("menjaga angka nol di depan (NISN dibandingkan sebagai teks)", () => {
    const hasil = matchSantriIds(
      [rec({ nisn: "0148997558" })],
      [siswa({ id: "s1", nisn: "148997558" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.unmatched).toBe(1);
  });

  it("jatuh ke NIS bila NISN tidak ada yang cocok", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.002", nis: "2538027221", nisn: "9999999999" })],
      [siswa({ id: "s2", nis: "2538027221" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s2", id_santri_pihak3: "21.01.002", via: "nis" },
    ]);
  });

  it("membaca id dari id_santri bila santriId kosong", () => {
    const hasil = matchSantriIds(
      [{ id_santri: "21.01.003", nisn: "111" }],
      [siswa({ id: "s3", nisn: "111" })],
    );
    expect(hasil.updates[0]?.id_santri_pihak3).toBe("21.01.003");
  });

  it("melewati record tanpa ID pihak ketiga", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: null, nisn: "111" })],
      [siswa({ id: "s1", nisn: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.skippedNoId).toBe(1);
  });

  it("menandai ambigu bila satu kunci cocok ke lebih dari satu siswa", () => {
    const hasil = matchSantriIds(
      [rec({ nisn: "111" })],
      [siswa({ id: "a", nisn: "111" }), siswa({ id: "b", nisn: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.ambiguous).toHaveLength(1);
    expect(hasil.ambiguous[0]?.siswa_ids.sort()).toEqual(["a", "b"]);
  });

  it("aturan mandiri: siswa ber-NIS YY-KK-NNN tidak ditimpa ID pihak ketiga", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nisn: "111" })],
      [siswa({ id: "s1", nisn: "111", nis: "21-01-001" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.skippedOwnNis).toBe(1);
  });

  it("tidak menimpa ID pihak ketiga berbeda yang sudah tersimpan", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.009", nisn: "111" })],
      [siswa({ id: "s1", nisn: "111", id_santri_pihak3: "21.01.001" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.conflicts).toEqual([
      { siswa_id: "s1", tersimpan: "21.01.001", baru: "21.01.009" },
    ]);
  });

  it("idempoten: ID yang sama tidak menghasilkan update lagi", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nisn: "111" })],
      [siswa({ id: "s1", nisn: "111", id_santri_pihak3: "21.01.001" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.unchanged).toBe(1);
  });

  it("dua record ke siswa yang sama dibatalkan keduanya (target ganda)", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "21.01.001", nisn: "111" }),
        rec({ santriId: "21.01.777", nisn: "111" }),
      ],
      [siswa({ id: "s1", nisn: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.duplicateTarget).toBe(2);
  });

  it("ID pihak ketiga yang sama dipakai dua siswa berbeda tidak ditulis", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "21.01.001", nisn: "111" }),
        rec({ santriId: "21.01.001", nisn: "222" }),
      ],
      [siswa({ id: "a", nisn: "111" }), siswa({ id: "b", nisn: "222" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.duplicateSantriId).toBe(2);
  });

  it("kecocokan nama hanya masuk daftar tinjau, tidak pernah jadi update", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.005", nama: "  Budi  Santoso " })],
      [siswa({ id: "s5", nama: "budi santoso" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.review).toEqual([
      { id_santri_pihak3: "21.01.005", siswa_id: "s5", alasan: "nama" },
    ]);
  });

  it("nama kembar tidak masuk tinjau, dihitung tidak cocok", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.005", nama: "Budi" })],
      [siswa({ id: "a", nama: "Budi" }), siswa({ id: "b", nama: "Budi" })],
    );
    expect(hasil.review).toHaveLength(0);
    expect(hasil.summary.unmatched).toBe(1);
  });

  it("ringkasan memuat total record dan siswa tanpa pasangan", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nisn: "111" })],
      [siswa({ id: "a", nisn: "111" }), siswa({ id: "b", nisn: "222" })],
    );
    expect(hasil.summary.totalRecords).toBe(1);
    expect(hasil.summary.siswaTanpaPasangan).toBe(1);
  });
});
