/**
 * Server functions: diskon/keringanan SPP
 *
 * Semua RPC yang disentuh di sini dikunci ke `service_role` di database
 * (migrasi 20260728140002 & 20260728140005), jadi memang harus lewat server
 * function — tidak bisa dipanggil langsung dari browser.
 *
 * Pembagian peran yang ditegakkan:
 *   - staf keuangan/admin  : mengajukan diskon, mengelompokkan keluarga
 *   - sekretaris yayasan   : menyetujui/menolak pengajuan
 * Pemisahan itu juga dijaga di sisi DB (putuskan_diskon_siswa memeriksa
 * is_penyetuju_diskon), jadi bukan hanya pagar di layer TypeScript.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

const ROLE_PENGAJU = ["admin", "keuangan"];
const ROLE_PENYETUJU = ["admin", "sekretaris_yayasan"];
const ROLE_LIHAT_KERINGANAN = [
  "admin",
  "keuangan",
  "sekretaris_yayasan",
];

type StatusDiskon = "diajukan" | "disetujui" | "ditolak" | "dibatalkan";

/** Hasil penerapan diskon ke baris tagihan yang sudah ada. */
export interface PenerapanDiskon {
  /** Tagihan 'terjadwal' yang nominalnya langsung diubah (belum punya jurnal). */
  terjadwal_diubah: number;
  /** Tagihan 'belum_bayar' yang dikoreksi lewat jurnal D Potongan / K Piutang. */
  dikoreksi_jurnal: number;
  /** Tagihan yang dilewati (lunas/sebagian) — perlu penanganan manual. */
  dilewati: number;
  total_potongan: number;
  errors?: string[];
}

function bacaPenerapan(raw: unknown): PenerapanDiskon {
  const r = (raw || {}) as Record<string, unknown>;
  const errors = Array.isArray(r.errors) ? (r.errors as string[]) : [];
  return {
    terjadwal_diubah: Number(r.terjadwal_diubah ?? 0),
    dikoreksi_jurnal: Number(r.dikoreksi_jurnal ?? 0),
    dilewati: Number(r.dilewati ?? 0),
    total_potongan: Number(r.total_potongan ?? 0),
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  };
}

/**
 * Pesan constraint Postgres tidak layak ditampilkan ke pengguna akhir.
 * Diterjemahkan ke bahasa yang menjelaskan APA yang harus diperbaiki.
 */
function terjemahkanErrorDiskon(pesan: string): string {
  if (pesan.includes("siswa_diskon_no_overlap")) {
    return (
      "Siswa ini sudah punya keringanan lain untuk jenis pembayaran dan " +
      "rentang waktu yang sama. Satu siswa hanya boleh menerima satu " +
      "keringanan per jenis pembayaran dalam satu periode — batalkan yang " +
      "lama dulu, atau pilih rentang waktu yang tidak tumpang tindih."
    );
  }
  if (pesan.includes("Potongan kakak-adik")) return pesan;
  if (pesan.includes("siswa_diskon_periode_check")) {
    return "Periode selesai tidak boleh lebih awal dari periode mulai.";
  }
  return pesan;
}

// ── Daftar keringanan ──────────────────────────────────────────────────────
// Dibaca lewat server/admin client agar sekretaris yayasan dapat melihat nama
// dan NIS siswa yang memang diperlukan untuk proses persetujuan, tanpa membuka
// SELECT langsung ke seluruh tabel `siswa` melalui RLS browser.

export interface ListSiswaDiskonInput {
  status?: StatusDiskon;
  siswa_id?: string;
}

export interface SiswaDiskonListItem {
  id: string;
  siswa_id: string;
  skema_diskon_id: string;
  jenis_id: string;
  periode_mulai: string;
  periode_selesai: string;
  nilai: number | null;
  status: StatusDiskon;
  catatan: string | null;
  dokumen_url: string | null;
  alasan_penolakan: string | null;
  diajukan_at: string;
  diputuskan_at: string | null;
  diterapkan_at: string | null;
  siswa: { nama: string; nis: string | null } | null;
  skema_diskon: {
    nama: string;
    kategori: string;
    tipe: string;
    nilai_default: number;
  } | null;
  jenis_pembayaran: { nama: string } | null;
  /** Jumlah pengajuan lama untuk siswa+jenis+periode yang sama. */
  riwayat_count: number;
}

function rapikanBarisDiskon(
  row: Omit<SiswaDiskonListItem, "riwayat_count">,
  riwayatCount = 0
): SiswaDiskonListItem {
  const alasan = row.alasan_penolakan?.trim();
  return {
    ...row,
    siswa: row.siswa
      ? {
          nama: row.siswa.nama?.trim() || "—",
          nis: row.siswa.nis?.trim() || null,
        }
      : null,
    alasan_penolakan: alasan ? `Alasan: ${alasan}` : null,
    riwayat_count: riwayatCount,
  };
}

export const listSiswaDiskon = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: ListSiswaDiskonInput | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<{ items: SiswaDiskonListItem[] }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_LIHAT_KERINGANAN);

    let q = admin
      .from("siswa_diskon")
      .select(
        "id, siswa_id, skema_diskon_id, jenis_id, periode_mulai, periode_selesai, nilai, " +
          "status, catatan, dokumen_url, alasan_penolakan, diajukan_at, diputuskan_at, diterapkan_at, " +
          "siswa:siswa_id(nama, nis), " +
          "skema_diskon:skema_diskon_id(nama, kategori, tipe, nilai_default), " +
          "jenis_pembayaran:jenis_id(nama)"
      )
      .order("diajukan_at", { ascending: false });

    if (data.status) q = q.eq("status", data.status);
    if (data.siswa_id) q = q.eq("siswa_id", data.siswa_id);

    const { data: hasil, error } = await q;
    if (error) throw new Error("Gagal memuat daftar keringanan: " + error.message);

    const rows = (hasil ?? []) as unknown as Array<
      Omit<SiswaDiskonListItem, "riwayat_count">
    >;

    // Pada tampilan "Semua status", satu siklus pengajuan hanya ditampilkan
    // sekali. Pengajuan lama (mis. ditolak lalu diajukan ulang) tetap tersimpan
    // sebagai audit trail dan tetap dapat dilihat saat memfilter statusnya.
    if (!data.status) {
      const terkini = new Map<string, SiswaDiskonListItem>();
      for (const row of rows) {
        const key = [
          row.siswa_id,
          row.jenis_id,
          row.periode_mulai,
          row.periode_selesai,
        ].join("|");
        const existing = terkini.get(key);
        if (existing) {
          existing.riwayat_count += 1;
        } else {
          terkini.set(key, rapikanBarisDiskon(row));
        }
      }
      return { items: Array.from(terkini.values()) };
    }

    return { items: rows.map((row) => rapikanBarisDiskon(row)) };
  });

// ── Pengajuan ──────────────────────────────────────────────────────────────

export interface AjukanDiskonInput {
  siswa_id: string;
  skema_diskon_id: string;
  jenis_id: string;
  /** "yyyy-MM-dd". Dinormalisasi ke awal bulan oleh trigger DB. */
  periode_mulai: string;
  /** "yyyy-MM-dd". Dinormalisasi ke akhir bulan oleh trigger DB. */
  periode_selesai: string;
  /** Override nilai default skema. Kosong = pakai default skema. */
  nilai?: number | null;
  catatan?: string | null;
  dokumen_url?: string | null;
}

export interface AjukanDiskonResult {
  success: true;
  id: string;
}

export const ajukanDiskonSiswa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: AjukanDiskonInput) => d)
  .handler(async ({ data, context }): Promise<AjukanDiskonResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_PENGAJU);

    if (!data?.siswa_id || !data?.skema_diskon_id || !data?.jenis_id) {
      throw new Error("Siswa, skema diskon, dan jenis pembayaran wajib diisi");
    }
    if (!data.periode_mulai || !data.periode_selesai) {
      throw new Error("Periode berlaku keringanan wajib diisi");
    }

    const { data: baris, error } = await admin
      .from("siswa_diskon")
      .insert({
        siswa_id: data.siswa_id,
        skema_diskon_id: data.skema_diskon_id,
        jenis_id: data.jenis_id,
        periode_mulai: data.periode_mulai,
        periode_selesai: data.periode_selesai,
        nilai: data.nilai ?? null,
        catatan: data.catatan ?? null,
        dokumen_url: data.dokumen_url ?? null,
        diajukan_oleh: userId,
      })
      .select("id")
      .single();

    if (error) throw new Error(terjemahkanErrorDiskon(error.message));

    return { success: true, id: baris.id };
  });

// ── Keputusan sekretaris yayasan ───────────────────────────────────────────

export interface PutuskanDiskonInput {
  siswa_diskon_id: string;
  setujui: boolean;
  /** Wajib bila menolak. */
  alasan?: string | null;
}

export interface PutuskanDiskonResult {
  success: true;
  status: "disetujui" | "ditolak";
  /** Hanya terisi bila disetujui — diskon langsung dikenakan ke tagihan. */
  penerapan?: PenerapanDiskon;
}

export const putuskanDiskonSiswa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: PutuskanDiskonInput) => d)
  .handler(async ({ data, context }): Promise<PutuskanDiskonResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_PENYETUJU);

    if (!data?.siswa_diskon_id) throw new Error("Pengajuan diskon tidak dipilih");
    if (!data.setujui && !data.alasan?.trim()) {
      throw new Error("Alasan penolakan wajib diisi");
    }

    const { data: hasil, error } = await admin.rpc("putuskan_diskon_siswa", {
      p_siswa_diskon_id: data.siswa_diskon_id,
      p_setujui: data.setujui,
      p_user_id: userId,
      p_alasan: data.alasan ?? null,
    });

    if (error) throw new Error("Gagal memutuskan pengajuan: " + error.message);

    const r = (hasil || {}) as Record<string, unknown>;
    const status = r.status === "disetujui" ? "disetujui" : "ditolak";

    return {
      success: true,
      status,
      penerapan: status === "disetujui" ? bacaPenerapan(r.penerapan) : undefined,
    };
  });

// ── Terapkan ulang ke tagihan ──────────────────────────────────────────────

export interface TerapkanDiskonInput {
  siswa_diskon_id: string;
}

export interface TerapkanDiskonResult extends PenerapanDiskon {
  success: true;
}

/**
 * Menerapkan ulang diskon yang SUDAH disetujui ke tagihan yang ada. Dipakai
 * ketika tagihan baru di-generate untuk periode yang sudah tercakup diskon,
 * atau setelah nominal keringanannya diubah.
 */
export const terapkanDiskonSiswa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: TerapkanDiskonInput) => d)
  .handler(async ({ data, context }): Promise<TerapkanDiskonResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [...ROLE_PENGAJU, "sekretaris_yayasan"]);

    if (!data?.siswa_diskon_id) throw new Error("Diskon tidak dipilih");

    const { data: hasil, error } = await admin.rpc("terapkan_diskon_siswa", {
      p_siswa_diskon_id: data.siswa_diskon_id,
      p_user_id: userId,
    });

    if (error) throw new Error("Gagal menerapkan diskon: " + error.message);

    return { success: true, ...bacaPenerapan(hasil) };
  });

// ── Kelompok keluarga (kakak-adik) ─────────────────────────────────────────

export interface SaranKeluarga {
  sumber: "akun_ortu" | "nama_ortu";
  kunci: string;
  skor: number;
  jumlah_siswa: number;
  siswa: Array<{
    siswa_id: string;
    nama: string;
    nis: string | null;
    tanggal_lahir: string | null;
  }>;
}

export interface SaranKeluargaResult {
  success: true;
  saran: SaranKeluarga[];
}

/**
 * Kandidat kelompok kakak-adik untuk DIREVIEW, bukan diterapkan otomatis:
 * kecocokan nama orang tua adalah heuristik, dan salah mengelompokkan berarti
 * memberi potongan ke anak yang keliru.
 */
export const saranKelompokKeluarga = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<SaranKeluargaResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [...ROLE_PENGAJU, "sekretaris_yayasan"]);

    const { data: hasil, error } = await admin.rpc("saran_kelompok_keluarga", {
      p_limit: data?.limit ?? 200,
    });

    if (error) throw new Error("Gagal mengambil saran keluarga: " + error.message);

    const saran = (hasil ?? []).map((row) => ({
      sumber: row.sumber as SaranKeluarga["sumber"],
      kunci: row.kunci,
      skor: Number(row.skor ?? 0),
      jumlah_siswa: Number(row.jumlah_siswa ?? 0),
      siswa: (row.siswa ?? []) as SaranKeluarga["siswa"],
    }));

    return { success: true, saran };
  });

export interface KonfirmasiKeluargaInput {
  nama: string;
  siswa_ids: string[];
  keterangan?: string | null;
}

export interface KonfirmasiKeluargaResult {
  success: true;
  keluarga_id: string;
}

export const konfirmasiKelompokKeluarga = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: KonfirmasiKeluargaInput) => d)
  .handler(async ({ data, context }): Promise<KonfirmasiKeluargaResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_PENGAJU);

    if (!data?.nama?.trim()) throw new Error("Nama keluarga wajib diisi");
    if (!data?.siswa_ids || data.siswa_ids.length < 2) {
      throw new Error(
        "Kelompok keluarga minimal berisi 2 siswa — potongan kakak-adik " +
          "memang hanya berlaku untuk yang bersaudara"
      );
    }

    const { data: keluargaId, error } = await admin.rpc(
      "konfirmasi_kelompok_keluarga",
      {
        p_nama: data.nama.trim(),
        p_siswa_ids: data.siswa_ids,
        p_user_id: userId,
        p_keterangan: data.keterangan ?? null,
      }
    );

    if (error) throw new Error("Gagal menyimpan kelompok keluarga: " + error.message);

    return { success: true, keluarga_id: keluargaId as string };
  });
