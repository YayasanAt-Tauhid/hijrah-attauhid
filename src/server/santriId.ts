/**
 * Server function: syncIdSantriPihak3
 *
 * Mengisi `siswa.id_santri_pihak3` dari API pihak ketiga (SiPaksa). Pencocokan
 * ada di `src/lib/santriIdMatch.ts` (NIS kunci utama tanpa tanda hubung/spasi;
 * NISN cadangan; nama harus mirip >= 0,85; kasus meragukan ditahan di `held`;
 * siswa ber-NIS mandiri 7 digit polos / YY-KK-NNN tidak pernah ditimpa).
 *
 * Default DRY-RUN: hanya mengembalikan laporan, tidak menulis apa pun. Penulisan
 * hanya terjadi bila pemanggil mengirim `dry_run: false` secara eksplisit, dan
 * dilakukan lewat satu RPC atomik (`sync_id_santri_pihak3`).
 */
import { createServerFn } from "@tanstack/react-start";
import { fetchAllPages } from "@/lib/fetchAll";
import {
  matchSantriIds,
  parseSipaksaPayload,
  type SantriIdAmbiguous,
  type SantriIdConflict,
  type SantriIdHeld,
  type SantriIdMatchSummary,
  type SantriIdReview,
  type SantriIdUnmatched,
  type SantriIdUpdate,
  type SiswaRow,
} from "@/lib/santriIdMatch";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const ROLE_SYNC_ID_SANTRI = ["admin"];
const SIPAKSA_SETORAN_URL =
  "https://sipaksa.azaseradigital.workers.dev/api/setoran?jenjang=all&limit=2000";
const FETCH_TIMEOUT_MS = 20_000;
const SAMPLE_LIMIT = 20;
const PG_UNDEFINED_COLUMN = "42703";

export interface SyncIdSantriInput {
  /** Default true. Tulis ke database hanya bila `false` secara eksplisit. */
  dry_run?: boolean;
}

export interface SyncIdSantriOutput {
  dry_run: boolean;
  /** true bila migrasi kolom `siswa.id_santri_pihak3` belum diterapkan. */
  kolomBelumAda: boolean;
  summary: SantriIdMatchSummary;
  sampel: {
    updates: SantriIdUpdate[];
    review: SantriIdReview[];
    ambiguous: SantriIdAmbiguous[];
    conflicts: SantriIdConflict[];
    unmatched: SantriIdUnmatched[];
    /** Ditahan, tidak pernah ditulis: perbaiki di SiPaksa atau putuskan manual. */
    held: SantriIdHeld[];
  };
  diterapkan: { requested: number; updated: number; skipped: number } | null;
}

function toError(error: unknown, prefix: string): Error {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new Error(`${prefix}: ${message}`);
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

/**
 * Tipe sempit untuk membaca `siswa` dengan daftar kolom dinamis: tipe klien
 * Supabase tidak mengenal kolom yang mungkin belum dimigrasi di database.
 */
interface SiswaReader {
  from(table: "siswa"): {
    select(columns: string): {
      order(column: string): {
        range(
          from: number,
          to: number,
        ): PromiseLike<{
          data: Record<string, unknown>[] | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
}

async function loadSiswa(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ rows: SiswaRow[]; kolomBelumAda: boolean }> {
  const db = admin as unknown as SiswaReader;
  const select = (columns: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      db.from("siswa").select(columns).order("id").range(from, to),
    );

  const toRow = (raw: Record<string, unknown>): SiswaRow => ({
    id: String(raw.id),
    nama: String(raw.nama ?? ""),
    nis: (raw.nis as string | null | undefined) ?? null,
    nisn: (raw.nisn as string | null | undefined) ?? null,
    id_santri_pihak3: (raw.id_santri_pihak3 as string | null | undefined) ?? null,
  });

  try {
    const rows = await select("id,nama,nis,nisn,id_santri_pihak3");
    return { rows: rows.map(toRow), kolomBelumAda: false };
  } catch (error) {
    if (errorCode(error) !== PG_UNDEFINED_COLUMN) throw toError(error, "Gagal membaca siswa");
  }

  try {
    const rows = await select("id,nama,nis,nisn");
    return { rows: rows.map(toRow), kolomBelumAda: true };
  } catch (error) {
    throw toError(error, "Gagal membaca siswa");
  }
}

export const syncIdSantriPihak3 = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: SyncIdSantriInput | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<SyncIdSantriOutput> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_SYNC_ID_SANTRI);

    const dryRun = data.dry_run !== false;

    const response = await fetch(SIPAKSA_SETORAN_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`SiPaksa membalas HTTP ${response.status}`);
    }
    const records = parseSipaksaPayload(await response.json());

    const { rows, kolomBelumAda } = await loadSiswa(admin);
    const hasil = matchSantriIds(records, rows);

    let diterapkan: SyncIdSantriOutput["diterapkan"] = null;
    if (!dryRun) {
      if (kolomBelumAda) {
        throw new Error(
          "Kolom siswa.id_santri_pihak3 belum ada. Terapkan migrasi 20261028052500 terlebih dulu.",
        );
      }
      if (hasil.updates.length > 0) {
        const { data: rpcData, error } = await admin.rpc("sync_id_santri_pihak3", {
          p_updates: hasil.updates.map((u) => ({
            siswa_id: u.siswa_id,
            id_santri_pihak3: u.id_santri_pihak3,
          })),
        });
        if (error) throw toError(error, "Gagal menulis ID Santri pihak ketiga");
        diterapkan = rpcData as NonNullable<SyncIdSantriOutput["diterapkan"]>;
      } else {
        diterapkan = { requested: 0, updated: 0, skipped: 0 };
      }
    }

    return {
      dry_run: dryRun,
      kolomBelumAda,
      summary: hasil.summary,
      sampel: {
        updates: hasil.updates.slice(0, SAMPLE_LIMIT),
        review: hasil.review.slice(0, SAMPLE_LIMIT),
        ambiguous: hasil.ambiguous.slice(0, SAMPLE_LIMIT),
        conflicts: hasil.conflicts.slice(0, SAMPLE_LIMIT),
        unmatched: hasil.unmatched.slice(0, SAMPLE_LIMIT),
        held: hasil.held.slice(0, SAMPLE_LIMIT),
      },
      diterapkan,
    };
  });
