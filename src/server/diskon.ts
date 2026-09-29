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


export interface KebijakanKeringananListItem {
  id: string;
  kode: string;
  versi: number;
  nama: string;
  skema_diskon_id: string;
  jenis_id: string;
  kelas_regex: string | null;
  tipe: "persen" | "nominal";
  nilai: number;
  otomatis: boolean;
  perlu_pengajuan: boolean;
  berlaku_mulai: string;
  berlaku_selesai: string | null;
  aktif: boolean;
  keterangan: string | null;
  created_at: string;
  skema_diskon: { nama: string; kategori: string } | null;
  jenis_pembayaran: { nama: string; departemen_id: string | null } | null;
}

export interface BuatVersiKebijakanInput {
  kode: string;
  nama: string;
  skema_diskon_id: string;
  jenis_id: string;
  kelas_regex?: string | null;
  tipe: "persen" | "nominal";
  nilai: number;
  otomatis: boolean;
  perlu_pengajuan: boolean;
  berlaku_mulai: string;
  berlaku_selesai?: string | null;
  keterangan?: string | null;
}

export const listKebijakanKeringanan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { hanya_aktif?: boolean } | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<{ items: KebijakanKeringananListItem[] }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_LIHAT_KERINGANAN);

    let q = (admin as any)
      .from("kebijakan_keringanan")
      .select(
        "id,kode,versi,nama,skema_diskon_id,jenis_id,kelas_regex,tipe,nilai," +
          "otomatis,perlu_pengajuan,berlaku_mulai,berlaku_selesai,aktif,keterangan,created_at," +
          "skema_diskon:skema_diskon_id(nama,kategori)," +
          "jenis_pembayaran:jenis_id(nama,departemen_id)"
      )
      .order("kode")
      .order("versi", { ascending: false });

    if (data.hanya_aktif) q = q.eq("aktif", true);

    const { data: rows, error } = await q;
    if (error) throw new Error("Gagal memuat kebijakan keringanan: " + error.message);
    return { items: (rows ?? []) as KebijakanKeringananListItem[] };
  });

export const buatVersiKebijakanKeringanan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: BuatVersiKebijakanInput) => d)
  .handler(async ({ data, context }): Promise<{ item: KebijakanKeringananListItem }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_PENGAJU);

    if (!data.kode?.trim() || !data.nama?.trim()) {
      throw new Error("Kode dan nama kebijakan wajib diisi");
    }
    if (!data.skema_diskon_id || !data.jenis_id || !data.berlaku_mulai) {
      throw new Error("Skema, jenis pembayaran, dan tanggal mulai wajib diisi");
    }
    if (!Number.isFinite(Number(data.nilai)) || Number(data.nilai) < 0) {
      throw new Error("Nilai kebijakan tidak valid");
    }
    if (data.tipe === "persen" && Number(data.nilai) > 100) {
      throw new Error("Persentase tidak boleh lebih dari 100%");
    }

    const { data: row, error } = await (admin as any).rpc(
      "buat_versi_kebijakan_keringanan",
      {
        p_kode: data.kode.trim(),
        p_nama: data.nama.trim(),
        p_skema_diskon_id: data.skema_diskon_id,
        p_jenis_id: data.jenis_id,
        p_kelas_regex: data.kelas_regex?.trim() || null,
        p_tipe: data.tipe,
        p_nilai: Number(data.nilai),
        p_otomatis: data.otomatis,
        p_perlu_pengajuan: data.perlu_pengajuan,
        p_berlaku_mulai: data.berlaku_mulai,
        p_berlaku_selesai: data.berlaku_selesai || null,
        p_keterangan: data.keterangan?.trim() || null,
        p_user_id: userId,
      }
    );
    if (error) throw new Error("Gagal membuat versi kebijakan: " + error.message);
    return { item: row as KebijakanKeringananListItem };
  });

export interface CariKebijakanKeringananInput {
  siswa_id: string;
  skema_diskon_id: string;
  jenis_id: string;
  periode_mulai: string;
  periode_selesai?: string | null;
}

export const cariKebijakanKeringananAktif = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CariKebijakanKeringananInput) => d)
  .handler(async ({ data, context }): Promise<{ item: KebijakanKeringananListItem | null }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ROLE_LIHAT_KERINGANAN);

    if (!data.siswa_id || !data.skema_diskon_id || !data.jenis_id || !data.periode_mulai) {
      return { item: null };
    }

    const { data: kelasRows } = await (admin as any)
      .from("kelas_siswa")
      .select("kelas:kelas_id(nama)")
      .eq("siswa_id", data.siswa_id)
      .eq("aktif", true)
      .order("id", { ascending: false })
      .limit(1);
    const kelasNama = String(kelasRows?.[0]?.kelas?.nama || "");

    let q = (admin as any)
      .from("kebijakan_keringanan")
      .select(
        "id,kode,versi,nama,skema_diskon_id,jenis_id,kelas_regex,tipe,nilai," +
          "otomatis,perlu_pengajuan,berlaku_mulai,berlaku_selesai,aktif,keterangan,created_at," +
          "skema_diskon:skema_diskon_id(nama,kategori)," +
          "jenis_pembayaran:jenis_id(nama,departemen_id)"
      )
      .eq("aktif", true)
      .eq("skema_diskon_id", data.skema_diskon_id)
      .eq("jenis_id", data.jenis_id)
      .lte("berlaku_mulai", data.periode_mulai)
      .or("berlaku_selesai.is.null,berlaku_selesai.gte." + (data.periode_selesai || data.periode_mulai))
      .order("berlaku_mulai", { ascending: false })
      .order("versi", { ascending: false });

    const { data: rows, error } = await q;
    if (error) throw new Error("Gagal mencari kebijakan aktif: " + error.message);

    for (const row of (rows ?? []) as KebijakanKeringananListItem[]) {
      if (!row.kelas_regex) return { item: row };
      try {
        if (kelasNama && new RegExp(row.kelas_regex, "i").test(kelasNama)) {
          return { item: row };
        }
      } catch {
        // Regex kebijakan yang rusak tidak boleh membuat pengajuan gagal total.
      }
    }
    return { item: null };
  });

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
  kebijakan_keringanan_id: string | null;
  tipe_snapshot: string | null;
  nilai_snapshot: number | null;
  kebijakan_snapshot: Record<string, unknown> | null;
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
          "kebijakan_keringanan_id, tipe_snapshot, nilai_snapshot, kebijakan_snapshot, " +
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
  /** Versi kebijakan yang menjadi dasar pengajuan, bila ada. */
  kebijakan_keringanan_id?: string | null;
  /** Override nilai kebijakan/default skema. Kosong = pakai nilai yang berlaku. */
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

    const { data: skema, error: skemaError } = await (admin as any)
      .from("skema_diskon")
      .select("id,tipe,nilai_default")
      .eq("id", data.skema_diskon_id)
      .eq("aktif", true)
      .single();
    if (skemaError || !skema) throw new Error("Skema keringanan tidak ditemukan atau tidak aktif");

    let policy: any = null;
    if (data.kebijakan_keringanan_id) {
      const { data: policyRow, error: policyError } = await (admin as any)
        .from("kebijakan_keringanan")
        .select("id,skema_diskon_id,jenis_id,tipe,nilai,berlaku_mulai,berlaku_selesai,aktif")
        .eq("id", data.kebijakan_keringanan_id)
        .eq("aktif", true)
        .single();
      if (policyError || !policyRow) throw new Error("Kebijakan keringanan tidak ditemukan atau tidak aktif");
      if (policyRow.skema_diskon_id !== data.skema_diskon_id || policyRow.jenis_id !== data.jenis_id) {
        throw new Error("Kebijakan keringanan tidak sesuai skema atau jenis pembayaran");
      }
      if (
        data.periode_mulai < policyRow.berlaku_mulai ||
        (policyRow.berlaku_selesai && data.periode_selesai > policyRow.berlaku_selesai)
      ) {
        throw new Error("Periode pengajuan melewati masa berlaku kebijakan");
      }
      policy = policyRow;
    }

    const nilaiAktual = Number(
      data.nilai ?? policy?.nilai ?? skema.nilai_default ?? 0
    );
    const tipeAktual = String(policy?.tipe ?? skema.tipe);
    if (!Number.isFinite(nilaiAktual) || nilaiAktual <= 0) {
      throw new Error("Nilai keringanan harus lebih dari 0");
    }
    if (tipeAktual === "persen" && nilaiAktual > 100) {
      throw new Error("Persentase keringanan tidak boleh lebih dari 100%");
    }

    const { data: baris, error } = await (admin as any)
      .from("siswa_diskon")
      .insert({
        siswa_id: data.siswa_id,
        skema_diskon_id: data.skema_diskon_id,
        jenis_id: data.jenis_id,
        kebijakan_keringanan_id: data.kebijakan_keringanan_id ?? null,
        periode_mulai: data.periode_mulai,
        periode_selesai: data.periode_selesai,
        nilai: nilaiAktual,
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
  sumber: "no_kk" | "nik_ortu" | "akun_ortu" | "nama_ortu";
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
 * Kandidat kelompok kakak-adik untuk DIREVIEW sebelum keluarga dikonfirmasi.
 * Setelah konfirmasi, sinkronisasi bulanan dapat menerapkan potongan kakak/adik
 * otomatis selama tidak ada keringanan lain yang tumpang tindih.
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
  sinkronisasi?: {
    dibuat?: number;
    dilewati_karena_diskon_lain?: number;
    diterapkan_ke_tagihan_existing?: number;
  } | null;
  sinkron_error?: string | null;
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

    const today = new Date().toISOString().slice(0, 10);
    const { data: sinkronisasi, error: sinkronError } = await (admin as any).rpc(
      "sinkronkan_diskon_kakak_adik_bulanan",
      { p_tanggal: today }
    );

    return {
      success: true,
      keluarga_id: keluargaId as string,
      sinkronisasi: (sinkronisasi || null) as KonfirmasiKeluargaResult["sinkronisasi"],
      sinkron_error: sinkronError?.message || null,
    };
  });