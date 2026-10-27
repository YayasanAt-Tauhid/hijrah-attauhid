/**
 * Pencocokan ID Santri pihak ketiga (SiPaksa) ke tabel `siswa`.
 *
 * Fungsi murni tanpa I/O: menerima record API dan baris siswa, mengembalikan
 * rencana update beserta laporan. Penulisan ke database dilakukan pemanggil
 * (lihat `src/server/santriId.ts`), dan hanya setelah dry-run ditinjau.
 *
 * Aturan:
 * - Kunci pencocokan otomatis: NISN dulu, lalu NIS. Dibandingkan sebagai teks
 *   (angka nol di depan dipertahankan).
 * - Kecocokan nama TIDAK pernah menjadi update; hanya masuk daftar tinjau.
 * - Aturan mandiri: siswa yang sudah ber-NIS mandiri (7 digit polos, atau YY-KK-NNN) dari
 *   aplikasi tidak ditimpa ID pihak ketiga.
 * - ID pihak ketiga yang sudah tersimpan dan berbeda tidak ditimpa (konflik).
 */

export interface SipaksaRecord {
  santriId?: string | null;
  id_santri?: string | null;
  nis?: string | null;
  nisn?: string | null;
  nama?: string | null;
}

export interface SiswaRow {
  id: string;
  nama: string;
  nis: string | null;
  nisn: string | null;
  id_santri_pihak3: string | null;
}

export type MatchVia = "nisn" | "nis";

export interface SantriIdUpdate {
  siswa_id: string;
  id_santri_pihak3: string;
  via: MatchVia;
}

export interface SantriIdReview {
  id_santri_pihak3: string;
  siswa_id: string;
  alasan: "nama";
}

export interface SantriIdAmbiguous {
  id_santri_pihak3: string;
  siswa_ids: string[];
}

export interface SantriIdConflict {
  siswa_id: string;
  tersimpan: string;
  baru: string;
}

export interface SantriIdUnmatched {
  id_santri_pihak3: string;
  nama: string | null;
}

export interface SantriIdMatchSummary {
  totalRecords: number;
  matched: number;
  unchanged: number;
  skippedNoId: number;
  skippedOwnNis: number;
  ambiguous: number;
  conflicts: number;
  duplicateTarget: number;
  duplicateSantriId: number;
  review: number;
  unmatched: number;
  siswaTanpaPasangan: number;
}

export interface SantriIdMatchResult {
  updates: SantriIdUpdate[];
  review: SantriIdReview[];
  ambiguous: SantriIdAmbiguous[];
  conflicts: SantriIdConflict[];
  unmatched: SantriIdUnmatched[];
  summary: SantriIdMatchSummary;
}

/**
 * Validasi payload `/api/setoran` SiPaksa dan kembalikan daftar record.
 * Menolak payload yang bukan `{ ok: true, data: [...] }` serta respons yang
 * terpotong (`meta.total` lebih besar dari jumlah data), karena pencocokan di
 * atas data parsial akan menghasilkan laporan "tidak cocok" yang menyesatkan.
 */
export function parseSipaksaPayload(payload: unknown): SipaksaRecord[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Payload SiPaksa tidak valid: bukan objek");
  }
  const body = payload as { ok?: unknown; data?: unknown; meta?: unknown };
  if (body.ok !== true) {
    throw new Error("Payload SiPaksa tidak valid: ok bukan true");
  }
  if (!Array.isArray(body.data)) {
    throw new Error("Payload SiPaksa tidak valid: data bukan array");
  }

  const meta = body.meta as { total?: unknown } | null | undefined;
  const total = meta && typeof meta.total === "number" ? meta.total : null;
  if (total !== null && total > body.data.length) {
    throw new Error(
      `Respons SiPaksa terpotong: meta.total ${total} > data ${body.data.length}. Naikkan limit lalu ulangi.`,
    );
  }

  return body.data as SipaksaRecord[];
}

// NIS resmi buatan aplikasi = YY + KK + NNN (lihat `nis_get_or_create_for_department`).
// Database menyimpannya TANPA tanda hubung (trigger `normalisasi_nis_tanpa_hubung`),
// sehingga bentuk di data nyata adalah 7 digit polos (mis. 2601001). Bentuk
// berhubung YY-KK-NNN tetap dikenali karena itulah format tampilan resminya.
const OWN_NIS_PATTERN = /^(\d{2}-\d{2}-\d{3}|\d{7})$/;

/** Apakah NIS ini NIS mandiri buatan aplikasi (7 digit polos, atau YY-KK-NNN). */
export function isOwnNis(nis: string | null | undefined): boolean {
  return typeof nis === "string" && OWN_NIS_PATTERN.test(nis.trim());
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeName(value: string | null | undefined): string | null {
  const text = clean(value);
  return text === null ? null : text.toLowerCase().replace(/\s+/g, " ");
}

function indexBy(
  rows: SiswaRow[],
  key: (row: SiswaRow) => string | null,
): Map<string, SiswaRow[]> {
  const index = new Map<string, SiswaRow[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = index.get(k);
    if (list) list.push(row);
    else index.set(k, [row]);
  }
  return index;
}

interface Resolved {
  idPihak3: string;
  siswa: SiswaRow;
  via: MatchVia;
}

export function matchSantriIds(
  records: SipaksaRecord[],
  siswaRows: SiswaRow[],
): SantriIdMatchResult {
  const byNisn = indexBy(siswaRows, (r) => clean(r.nisn));
  const byNis = indexBy(siswaRows, (r) => clean(r.nis));
  const byName = indexBy(siswaRows, (r) => normalizeName(r.nama));

  const result: SantriIdMatchResult = {
    updates: [],
    review: [],
    ambiguous: [],
    conflicts: [],
    unmatched: [],
    summary: {
      totalRecords: records.length,
      matched: 0,
      unchanged: 0,
      skippedNoId: 0,
      skippedOwnNis: 0,
      ambiguous: 0,
      conflicts: 0,
      duplicateTarget: 0,
      duplicateSantriId: 0,
      review: 0,
      unmatched: 0,
      siswaTanpaPasangan: 0,
    },
  };

  // Pass 1: resolusi tiap record ke tepat satu siswa (atau gugur dengan alasan).
  const resolved: Resolved[] = [];
  for (const record of records) {
    const idPihak3 = clean(record.santriId) ?? clean(record.id_santri);
    if (idPihak3 === null) {
      result.summary.skippedNoId += 1;
      continue;
    }

    let candidates: SiswaRow[] | undefined;
    let via: MatchVia = "nisn";

    const nisn = clean(record.nisn);
    if (nisn !== null) candidates = byNisn.get(nisn);

    if (!candidates || candidates.length === 0) {
      const nis = clean(record.nis);
      candidates = nis !== null ? byNis.get(nis) : undefined;
      via = "nis";
    }

    if (candidates && candidates.length > 1) {
      result.ambiguous.push({
        id_santri_pihak3: idPihak3,
        siswa_ids: candidates.map((c) => c.id),
      });
      result.summary.ambiguous += 1;
      continue;
    }

    if (candidates && candidates.length === 1) {
      resolved.push({ idPihak3, siswa: candidates[0], via });
      continue;
    }

    // Tidak ada kunci yang cocok: nama hanya untuk daftar tinjau.
    const nameKey = normalizeName(record.nama);
    const byNameCandidates = nameKey !== null ? byName.get(nameKey) : undefined;
    if (byNameCandidates && byNameCandidates.length === 1) {
      const target = byNameCandidates[0];
      if (!isOwnNis(target.nis) && clean(target.id_santri_pihak3) === null) {
        result.review.push({
          id_santri_pihak3: idPihak3,
          siswa_id: target.id,
          alasan: "nama",
        });
        result.summary.review += 1;
        continue;
      }
    }

    result.unmatched.push({ id_santri_pihak3: idPihak3, nama: clean(record.nama) });
    result.summary.unmatched += 1;
  }

  // Siswa yang punya pasangan di API (sebelum penyaringan lanjutan).
  const berpasangan = new Set(resolved.map((r) => r.siswa.id));
  result.summary.siswaTanpaPasangan = siswaRows.filter((s) => !berpasangan.has(s.id)).length;

  // Pass 2a: aturan mandiri.
  const kandidat = resolved.filter((r) => {
    if (isOwnNis(r.siswa.nis)) {
      result.summary.skippedOwnNis += 1;
      return false;
    }
    return true;
  });

  // Pass 2b: dua record ke siswa yang sama dibatalkan semuanya.
  const perSiswa = new Map<string, Resolved[]>();
  for (const r of kandidat) {
    const list = perSiswa.get(r.siswa.id);
    if (list) list.push(r);
    else perSiswa.set(r.siswa.id, [r]);
  }
  const tanpaTargetGanda: Resolved[] = [];
  for (const list of perSiswa.values()) {
    if (list.length > 1) result.summary.duplicateTarget += list.length;
    else tanpaTargetGanda.push(list[0]);
  }

  // Pass 2c: satu ID pihak ketiga tidak boleh dipakai dua siswa
  // (termasuk siswa lain yang sudah menyimpannya di database).
  const perId = new Map<string, Resolved[]>();
  for (const r of tanpaTargetGanda) {
    const list = perId.get(r.idPihak3);
    if (list) list.push(r);
    else perId.set(r.idPihak3, [r]);
  }
  const dipakaiSiswaLain = new Map<string, string>();
  for (const row of siswaRows) {
    const tersimpan = clean(row.id_santri_pihak3);
    if (tersimpan !== null) dipakaiSiswaLain.set(tersimpan, row.id);
  }

  for (const r of tanpaTargetGanda) {
    const sama = perId.get(r.idPihak3) ?? [];
    const pemilikLain = dipakaiSiswaLain.get(r.idPihak3);
    if (sama.length > 1 || (pemilikLain !== undefined && pemilikLain !== r.siswa.id)) {
      result.summary.duplicateSantriId += 1;
      continue;
    }

    const tersimpan = clean(r.siswa.id_santri_pihak3);
    if (tersimpan === r.idPihak3) {
      result.summary.unchanged += 1;
    } else if (tersimpan !== null) {
      result.conflicts.push({ siswa_id: r.siswa.id, tersimpan, baru: r.idPihak3 });
      result.summary.conflicts += 1;
    } else {
      result.updates.push({
        siswa_id: r.siswa.id,
        id_santri_pihak3: r.idPihak3,
        via: r.via,
      });
      result.summary.matched += 1;
    }
  }

  return result;
}
