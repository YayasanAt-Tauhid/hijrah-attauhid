/**
 * Pencocokan ID Santri pihak ketiga (SiPaksa) ke tabel `siswa`.
 *
 * Fungsi murni tanpa I/O: menerima record API dan baris siswa, mengembalikan
 * rencana update beserta laporan. Penulisan ke database dilakukan pemanggil
 * (lihat `src/server/santriId.ts`), dan hanya setelah dry-run ditinjau.
 *
 * Aturan (sama dengan backfill produksi 28 Oktober 2026):
 * 1. NIS adalah kunci utama. NIS dibandingkan sebagai teks tanpa tanda hubung
 *    dan spasi di kedua sisi (SiPaksa `742-26` = Hijrah `74226`). Titik dan
 *    angka nol di depan dipertahankan (NIS MTA `2223.03.0012`).
 * 2. NISN hanya cadangan: dipakai bila NIS record kosong atau tidak ditemukan
 *    di Hijrah. Bila NIS record terisi tetapi tidak ketemu, dan NISN cocok ke
 *    siswa yang ber-NIS lain, kasus ditahan (`nis_nisn_bentrok`).
 * 3. Nama wajib mirip (Levenshtein ternormalisasi >= 0,85) sebagai pengaman,
 *    karena NIS lama yang pendek pernah dipakai orang berbeda (`nama_beda`).
 * 4. Ditahan (`held`), tidak pernah ditulis: dua record ber-ID berbeda dengan
 *    NIS sama (`nis_dobel_sipaksa`), dua record ber-ID berbeda menunjuk siswa
 *    yang sama (`target_ganda`), `nama_beda`, dan `nis_nisn_bentrok`.
 * 5. Siswa yang sudah ber-NIS mandiri (7 digit polos, atau YY-KK-NNN) tidak
 *    ditimpa ID pihak ketiga.
 * 6. Kecocokan nama saja TIDAK pernah menjadi update; hanya daftar tinjau.
 * 7. ID pihak ketiga yang sudah tersimpan dan berbeda tidak ditimpa (konflik).
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

export type HeldReason = "nis_dobel_sipaksa" | "target_ganda" | "nama_beda" | "nis_nisn_bentrok";

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

export interface SantriIdHeld {
  id_santri_pihak3: string;
  alasan: HeldReason;
  /** Siswa yang dituju; null untuk `nis_dobel_sipaksa` (belum ditetapkan). */
  siswa_id: string | null;
  nama: string | null;
}

export interface SantriIdMatchSummary {
  totalRecords: number;
  matched: number;
  unchanged: number;
  skippedNoId: number;
  skippedOwnNis: number;
  /** Record kembar (ID sama, siswa sama) yang digabung menjadi satu. */
  skippedDuplicateRecord: number;
  ambiguous: number;
  conflicts: number;
  duplicateSantriId: number;
  held: number;
  heldPerAlasan: Record<HeldReason, number>;
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
  held: SantriIdHeld[];
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

/**
 * Kunci NIS untuk pembandingan: tanpa spasi dan tanda hubung (termasuk
 * tanda pisah Unicode). Titik dan nol di depan dipertahankan. Kosong -> null.
 */
export function normalizeNis(value: string | null | undefined): string | null {
  const text = clean(value);
  if (text === null) return null;
  const key = text.replace(/[\s\-‐-―]/g, "");
  return key === "" ? null : key;
}

/** Ambang kemiripan nama minimal agar kecocokan kunci diterima. */
export const NAME_SIMILARITY_MIN = 0.85;

function foldName(value: string | null | undefined): string {
  const text = clean(value);
  if (text === null) return "";
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Kemiripan nama 0..1 (1 - jarak Levenshtein / panjang terpanjang) setelah
 * huruf kecil, tanpa diakritik, dan tanda baca/spasi ganda diratakan.
 * Salah satu sisi kosong = 0.
 */
export function nameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const x = foldName(a);
  const y = foldName(b);
  if (x === "" || y === "") return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

function nameMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  // Toleransi 1e-9 agar batas tepat 0,85 tidak bergantung pembulatan float.
  return nameSimilarity(a, b) >= NAME_SIMILARITY_MIN - 1e-9;
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

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

interface Resolved {
  idPihak3: string;
  nama: string | null;
  siswa: SiswaRow;
  via: MatchVia;
}

export function matchSantriIds(
  records: SipaksaRecord[],
  siswaRows: SiswaRow[],
): SantriIdMatchResult {
  const byNis = indexBy(siswaRows, (r) => normalizeNis(r.nis));
  const byNisn = indexBy(siswaRows, (r) => clean(r.nisn));
  const byName = indexBy(siswaRows, (r) => {
    const folded = foldName(r.nama);
    return folded === "" ? null : folded;
  });

  const result: SantriIdMatchResult = {
    updates: [],
    review: [],
    ambiguous: [],
    conflicts: [],
    unmatched: [],
    held: [],
    summary: {
      totalRecords: records.length,
      matched: 0,
      unchanged: 0,
      skippedNoId: 0,
      skippedOwnNis: 0,
      skippedDuplicateRecord: 0,
      ambiguous: 0,
      conflicts: 0,
      duplicateSantriId: 0,
      held: 0,
      heldPerAlasan: {
        nis_dobel_sipaksa: 0,
        target_ganda: 0,
        nama_beda: 0,
        nis_nisn_bentrok: 0,
      },
      review: 0,
      unmatched: 0,
      siswaTanpaPasangan: 0,
    },
  };

  const hold = (
    idPihak3: string,
    alasan: HeldReason,
    siswaId: string | null,
    nama: string | null,
  ) => {
    result.held.push({ id_santri_pihak3: idPihak3, alasan, siswa_id: siswaId, nama });
    result.summary.held += 1;
    result.summary.heldPerAlasan[alasan] += 1;
  };

  // Record ber-ID, dan NIS-nya: dua ID berbeda dengan NIS sama = NIS dobel di SiPaksa.
  const withId = records.flatMap((record) => {
    const idPihak3 = clean(record.santriId) ?? clean(record.id_santri);
    if (idPihak3 === null) {
      result.summary.skippedNoId += 1;
      return [];
    }
    return [{ record, idPihak3, nisKey: normalizeNis(record.nis) }];
  });
  const idPerNis = new Map<string, Set<string>>();
  for (const { idPihak3, nisKey } of withId) {
    if (nisKey === null) continue;
    const ids = idPerNis.get(nisKey);
    if (ids) ids.add(idPihak3);
    else idPerNis.set(nisKey, new Set([idPihak3]));
  }

  // Pass 1: resolusi tiap record ke tepat satu siswa (atau gugur dengan alasan).
  const resolved: Resolved[] = [];
  for (const { record, idPihak3, nisKey } of withId) {
    const namaRecord = clean(record.nama);

    if (nisKey !== null && (idPerNis.get(nisKey)?.size ?? 0) > 1) {
      hold(idPihak3, "nis_dobel_sipaksa", null, namaRecord);
      continue;
    }

    // NIS dulu; NISN hanya bila NIS kosong atau tidak ketemu di Hijrah.
    let candidates: SiswaRow[] | undefined = nisKey !== null ? byNis.get(nisKey) : undefined;
    let via: MatchVia = "nis";
    if (!candidates || candidates.length === 0) {
      const nisn = clean(record.nisn);
      candidates = nisn !== null ? byNisn.get(nisn) : undefined;
      via = "nisn";
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
      const target = candidates[0];
      if (via === "nisn" && nisKey !== null) {
        // NIS record terisi tetapi tidak ketemu; NISN menunjuk siswa ber-NIS lain.
        const nisTarget = normalizeNis(target.nis);
        if (nisTarget !== null && nisTarget !== nisKey) {
          hold(idPihak3, "nis_nisn_bentrok", target.id, namaRecord);
          continue;
        }
      }
      resolved.push({ idPihak3, nama: namaRecord, siswa: target, via });
      continue;
    }

    // Tidak ada kunci yang cocok: nama hanya untuk daftar tinjau.
    const nameKey = foldName(record.nama);
    const byNameCandidates = nameKey !== "" ? byName.get(nameKey) : undefined;
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

    result.unmatched.push({ id_santri_pihak3: idPihak3, nama: namaRecord });
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

  // Pass 2b: dua record ber-ID berbeda ke siswa yang sama ditahan semuanya.
  // Record kembar (ID sama) cukup digabung menjadi satu.
  const tanpaTargetGanda: Resolved[] = [];
  for (const list of groupBy(kandidat, (r) => r.siswa.id).values()) {
    if (new Set(list.map((r) => r.idPihak3)).size > 1) {
      for (const r of list) hold(r.idPihak3, "target_ganda", r.siswa.id, r.nama);
      continue;
    }
    result.summary.skippedDuplicateRecord += list.length - 1;
    tanpaTargetGanda.push(list[0]);
  }

  // Pass 2c: pengaman nama. Kunci cocok tetapi nama berbeda jauh = bisa orang lain.
  const lolosNama = tanpaTargetGanda.filter((r) => {
    if (nameMatches(r.nama, r.siswa.nama)) return true;
    hold(r.idPihak3, "nama_beda", r.siswa.id, r.nama);
    return false;
  });

  // Pass 2d: satu ID pihak ketiga tidak boleh dipakai dua siswa
  // (termasuk siswa lain yang sudah menyimpannya di database).
  const perId = groupBy(lolosNama, (r) => r.idPihak3);
  const dipakaiSiswaLain = new Map<string, string>();
  for (const row of siswaRows) {
    const tersimpan = clean(row.id_santri_pihak3);
    if (tersimpan !== null) dipakaiSiswaLain.set(tersimpan, row.id);
  }

  for (const r of lolosNama) {
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
