import { describe, expect, it } from "vitest";
import {
  NAME_SIMILARITY_MIN,
  isOwnNis,
  matchSantriIds,
  nameSimilarity,
  normalizeNis,
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

// Nama bawaan SAMA di record dan siswa: tes yang tidak membahas nama tidak
// boleh tertahan oleh pengaman kemiripan nama.
const NAMA = "Ahmad Fauzan Hidayat";
// Nama yang tidak sama dengan siswa mana pun: untuk tes "tidak cocok" agar
// record tidak jatuh ke daftar tinjau (kecocokan nama unik).
const NAMA_LAIN = "Zulkifli Ramadhan Putra";

const siswa = (over: Partial<SiswaRow> & { id: string }): SiswaRow => ({
  nama: NAMA,
  nis: null,
  nisn: null,
  id_santri_pihak3: null,
  ...over,
});

const rec = (over: Partial<SipaksaRecord>): SipaksaRecord => ({
  santriId: "21.01.001",
  nis: null,
  nisn: null,
  nama: NAMA,
  ...over,
});

describe("isOwnNis", () => {
  // Database menyimpan NIS tanpa tanda hubung (trigger normalisasi_nis_tanpa_hubung),
  // jadi bentuk yang berlaku di data nyata adalah 7 digit polos: YY + KK + NNN.
  it.each(["2601001", "2701003", " 2601001 "])(
    "mengenali NIS mandiri 7 digit tanpa hubung: %s",
    (nis) => {
      expect(isOwnNis(nis)).toBe(true);
    },
  );

  it.each(["21-01-001", "26-03-120"])(
    "tetap mengenali bentuk berhubung YY-KK-NNN: %s",
    (nis) => {
      expect(isOwnNis(nis)).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "2538027221", // 10 digit: bukan NIS mandiri
    "260100", // 6 digit
    "26010011", // 8 digit
    "21.01.001",
    "21-01-1",
    "ab-01-001",
    "2601-001", // setengah berhubung
  ])("bukan NIS mandiri: %s", (nis) => {
    expect(isOwnNis(nis)).toBe(false);
  });
});

describe("normalizeNis", () => {
  it.each([
    ["742-26", "74226"],
    [" 742 26 ", "74226"],
    ["742–26", "74226"], // en dash
    ["2223.03.0012", "2223.03.0012"], // NIS MTA bertitik dipertahankan
    ["0012", "0012"], // nol di depan dipertahankan
  ])("%j -> %j", (masuk, keluar) => {
    expect(normalizeNis(masuk)).toBe(keluar);
  });

  it.each([null, undefined, "", "   ", "-", " - "])("kosong -> null: %j", (nilai) => {
    expect(normalizeNis(nilai)).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("nama sama persis (abaikan huruf besar, spasi ganda, tanda baca) = 1", () => {
    expect(nameSimilarity("  Budi   SANTOSO ", "budi santoso")).toBe(1);
    expect(nameSimilarity("Siti Aisyah, S.Pd", "siti aisyah s pd")).toBe(1);
  });

  it("selisih satu huruf pada nama panjang tetap di atas ambang", () => {
    expect(nameSimilarity("Muhammad Abdullah", "Muhammad Abdulah")).toBeGreaterThanOrEqual(
      NAME_SIMILARITY_MIN,
    );
  });

  it("nama berbeda jauh di bawah ambang", () => {
    expect(nameSimilarity("Budi Santoso", "Siti Aminah")).toBeLessThan(NAME_SIMILARITY_MIN);
  });

  it("tepat di ambang (3 sunting dari 20 karakter = 0,85) diterima", () => {
    expect(nameSimilarity("abcdefghijklmnopqrst", "abcdefghijklmnopqXYZ")).toBeCloseTo(0.85, 10);
    const hasil = matchSantriIds(
      [rec({ nis: "111", nama: "abcdefghijklmnopqrst" })],
      [siswa({ id: "s1", nis: "111", nama: "abcdefghijklmnopqXYZ" })],
    );
    expect(hasil.updates).toHaveLength(1);
  });

  it("kosong di salah satu sisi = 0", () => {
    expect(nameSimilarity("", "Budi")).toBe(0);
    expect(nameSimilarity(null, "Budi")).toBe(0);
    expect(nameSimilarity("Budi", undefined)).toBe(0);
  });
});

describe("matchSantriIds — kunci pencocokan", () => {
  it("NIS adalah kunci utama dan menghasilkan update via nis", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.002", nis: "2538027221" })],
      [siswa({ id: "s2", nis: "2538027221" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s2", id_santri_pihak3: "21.01.002", via: "nis" },
    ]);
    expect(hasil.summary.matched).toBe(1);
  });

  it("NIS menang atas NISN bila keduanya cocok ke siswa berbeda", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.010", nis: "111", nisn: "9999999999" })],
      [
        siswa({ id: "pemilikNis", nis: "111" }),
        siswa({ id: "pemilikNisn", nisn: "9999999999" }),
      ],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "pemilikNis", id_santri_pihak3: "21.01.010", via: "nis" },
    ]);
  });

  it("NIS dibandingkan tanpa tanda hubung dan spasi (742-26 = 74226)", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "742-26" })],
      [siswa({ id: "s1", nis: "74226" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s1", id_santri_pihak3: "21.01.001", via: "nis" },
    ]);
  });

  it("normalisasi berlaku juga untuk NIS di sisi siswa", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "74226" })],
      [siswa({ id: "s1", nis: "742-26" })],
    );
    expect(hasil.updates).toHaveLength(1);
  });

  it("NIS MTA bertitik hanya cocok dengan bentuk bertitik yang sama", () => {
    const cocok = matchSantriIds(
      [rec({ nis: "2223.03.0012" })],
      [siswa({ id: "s1", nis: "2223.03.0012" })],
    );
    expect(cocok.updates).toHaveLength(1);

    const tidakCocok = matchSantriIds(
      [rec({ nis: "2223030012", nama: NAMA_LAIN })],
      [siswa({ id: "s1", nis: "2223.03.0012" })],
    );
    expect(tidakCocok.updates).toHaveLength(0);
    expect(tidakCocok.summary.unmatched).toBe(1);
  });

  it("menjaga angka nol di depan (dibandingkan sebagai teks)", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "0012", nama: NAMA_LAIN })],
      [siswa({ id: "s1", nis: "12" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.unmatched).toBe(1);
  });

  it("NISN dipakai bila NIS di record kosong", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nisn: "0148997558" })],
      [siswa({ id: "s1", nisn: "0148997558" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s1", id_santri_pihak3: "21.01.001", via: "nisn" },
    ]);
  });

  it("NISN dipakai bila NIS record tidak ditemukan dan siswa belum ber-NIS", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "999", nisn: "0148997558" })],
      [siswa({ id: "s1", nis: null, nisn: "0148997558" })],
    );
    expect(hasil.updates).toEqual([
      { siswa_id: "s1", id_santri_pihak3: "21.01.001", via: "nisn" },
    ]);
  });

  it("NISN tidak dibandingkan dengan nol di depan yang hilang", () => {
    const hasil = matchSantriIds(
      [rec({ nisn: "0148997558", nama: NAMA_LAIN })],
      [siswa({ id: "s1", nisn: "148997558" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.unmatched).toBe(1);
  });

  it("membaca id dari id_santri bila santriId kosong", () => {
    const hasil = matchSantriIds(
      [{ id_santri: "21.01.003", nisn: "111", nama: NAMA }],
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

  it("ambigu bila satu NISN cocok ke lebih dari satu siswa", () => {
    const hasil = matchSantriIds(
      [rec({ nisn: "111" })],
      [siswa({ id: "a", nisn: "111" }), siswa({ id: "b", nisn: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.ambiguous).toHaveLength(1);
    expect(hasil.ambiguous[0]?.siswa_ids.sort()).toEqual(["a", "b"]);
  });

  it("ambigu bila satu NIS (setelah normalisasi) cocok ke lebih dari satu siswa", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "74226" })],
      [siswa({ id: "a", nis: "742-26" }), siswa({ id: "b", nis: "74226" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.summary.ambiguous).toBe(1);
  });
});

describe("matchSantriIds — aturan mandiri, konflik, idempoten", () => {
  it.each(["21-01-001", "2101001"])(
    "siswa ber-NIS mandiri (%s) tidak ditimpa ID pihak ketiga",
    (nisMandiri) => {
      const hasil = matchSantriIds(
        [rec({ santriId: "21.01.001", nisn: "111" })],
        [siswa({ id: "s1", nisn: "111", nis: nisMandiri })],
      );
      expect(hasil.updates).toHaveLength(0);
      expect(hasil.summary.skippedOwnNis).toBe(1);
    },
  );

  it("NIS mandiri dilewati meski nama berbeda (bukan dihitung ditahan)", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "2601001", nama: "Orang Lain Sama Sekali" })],
      [siswa({ id: "s1", nis: "2601001" })],
    );
    expect(hasil.summary.skippedOwnNis).toBe(1);
    expect(hasil.summary.held).toBe(0);
    expect(hasil.held).toHaveLength(0);
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
});

describe("matchSantriIds — kasus ditahan (held)", () => {
  it("nis_dobel_sipaksa: dua record ber-ID berbeda dengan NIS sama ditahan keduanya", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "21.01.001", nis: "742-26" }),
        rec({ santriId: "21.01.777", nis: "74226" }),
      ],
      [siswa({ id: "s1", nis: "74226" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held.map((h) => [h.id_santri_pihak3, h.alasan]).sort()).toEqual([
      ["21.01.001", "nis_dobel_sipaksa"],
      ["21.01.777", "nis_dobel_sipaksa"],
    ]);
    expect(hasil.summary.held).toBe(2);
  });

  it("record ganda identik (ID dan NIS sama) bukan NIS dobel", () => {
    const hasil = matchSantriIds(
      [rec({ santriId: "21.01.001", nis: "111" }), rec({ santriId: "21.01.001", nis: "111" })],
      [siswa({ id: "s1", nis: "111" })],
    );
    expect(hasil.held.filter((h) => h.alasan === "nis_dobel_sipaksa")).toHaveLength(0);
    expect(hasil.updates).toEqual([
      { siswa_id: "s1", id_santri_pihak3: "21.01.001", via: "nis" },
    ]);
  });

  it("target_ganda: dua record ke siswa yang sama (satu via NIS, satu via NISN) ditahan keduanya", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "21.01.001", nis: "111" }),
        rec({ santriId: "21.01.777", nisn: "0148997558" }),
      ],
      [siswa({ id: "s1", nis: "111", nisn: "0148997558" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held).toHaveLength(2);
    expect(hasil.held.every((h) => h.alasan === "target_ganda" && h.siswa_id === "s1")).toBe(true);
    expect(hasil.summary.held).toBe(2);
  });

  it("target_ganda: dua record NISN sama ke satu siswa ditahan keduanya", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "21.01.001", nisn: "111" }),
        rec({ santriId: "21.01.777", nisn: "111" }),
      ],
      [siswa({ id: "s1", nisn: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held.map((h) => h.alasan)).toEqual(["target_ganda", "target_ganda"]);
  });

  it("nis_nisn_bentrok: NIS record tidak ketemu, NISN cocok ke siswa ber-NIS lain", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "111", nisn: "0148997558" })],
      [siswa({ id: "s1", nis: "222", nisn: "0148997558" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held).toEqual([
      { id_santri_pihak3: "21.01.001", alasan: "nis_nisn_bentrok", siswa_id: "s1", nama: NAMA },
    ]);
  });

  it("bukan bentrok bila NIS siswa sama setelah normalisasi", () => {
    // NIS record cocok ke s1 lewat NIS; NISN tidak diperiksa.
    const hasil = matchSantriIds(
      [rec({ nis: "742-26", nisn: "0148997558" })],
      [siswa({ id: "s1", nis: "74226", nisn: "0148997558" })],
    );
    expect(hasil.held).toHaveLength(0);
    expect(hasil.updates).toHaveLength(1);
  });

  it("nama_beda: NIS cocok tetapi nama berbeda jauh ditahan", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "736-25", nama: "Siti Aminah" })],
      [siswa({ id: "s1", nis: "73625", nama: "Budi Santoso" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held).toEqual([
      { id_santri_pihak3: "21.01.001", alasan: "nama_beda", siswa_id: "s1", nama: "Siti Aminah" },
    ]);
  });

  it("nama_beda berlaku juga untuk kecocokan lewat NISN", () => {
    const hasil = matchSantriIds(
      [rec({ nisn: "111", nama: "Siti Aminah" })],
      [siswa({ id: "s1", nisn: "111", nama: "Budi Santoso" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held[0]?.alasan).toBe("nama_beda");
  });

  it("nama mirip (selisih satu huruf) lolos dan menghasilkan update", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "111", nama: "Muhammad Abdullah" })],
      [siswa({ id: "s1", nis: "111", nama: "Muhammad Abdulah" })],
    );
    expect(hasil.held).toHaveLength(0);
    expect(hasil.updates).toHaveLength(1);
  });

  it("nama record kosong tidak bisa diverifikasi sehingga ditahan sebagai nama_beda", () => {
    const hasil = matchSantriIds(
      [rec({ nis: "111", nama: null })],
      [siswa({ id: "s1", nis: "111" })],
    );
    expect(hasil.updates).toHaveLength(0);
    expect(hasil.held[0]?.alasan).toBe("nama_beda");
  });

  it("ringkasan merinci jumlah ditahan per alasan", () => {
    const hasil = matchSantriIds(
      [
        rec({ santriId: "A", nis: "111", nama: "Siti Aminah" }), // nama_beda
        rec({ santriId: "B", nis: "222" }), // update
        rec({ santriId: "C", nisn: "333" }), // target_ganda
        rec({ santriId: "D", nisn: "333" }), // target_ganda
      ],
      [
        siswa({ id: "s1", nis: "111", nama: "Budi Santoso" }),
        siswa({ id: "s2", nis: "222" }),
        siswa({ id: "s3", nisn: "333" }),
      ],
    );
    expect(hasil.summary.matched).toBe(1);
    expect(hasil.summary.held).toBe(3);
    expect(hasil.summary.heldPerAlasan).toEqual({
      nis_dobel_sipaksa: 0,
      target_ganda: 2,
      nama_beda: 1,
      nis_nisn_bentrok: 0,
    });
  });
});

describe("matchSantriIds — nama untuk daftar tinjau", () => {
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
