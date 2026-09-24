/**
 * Server function: generateTagihan
 * Migrasi dari supabase/functions/generate-tagihan.
 * Generate tagihan (piutang) + jurnal untuk sekelompok siswa. Hanya admin/keuangan.
 *
 * CATATAN PERBAIKAN (2026-07-14): Sebelumnya proses ini melakukan ~5 subrequest
 * Supabase PER SISWA PER BULAN (RPC tarif, RPC nomor jurnal, insert jurnal,
 * insert jurnal_detail, insert tagihan) secara sequential di dalam loop
 * JavaScript. Untuk generate 12 bulan x banyak siswa, ini gampang menembus
 * limit subrequest per invocation di Cloudflare Workers — begitu limit
 * tercapai, Worker berhenti paksa di tengah loop dan sisa bulan/siswa yang
 * belum diproses hilang tanpa pemberitahuan jelas ("tagihan bolong").
 *
 * Sekarang logic generate per-siswa dipindah ke stored procedure Postgres
 * `generate_tagihan_batch`, dipanggil SEKALI PER BULAN (bukan per siswa).
 * Ini menurunkan jumlah subrequest dari (siswa x bulan x 5) menjadi
 * (bulan x 1), sehingga generate massal jauh lebih tahan terhadap limit
 * subrequest dan juga jauh lebih cepat.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

export interface GenerateTagihanInput {
  /** Tahun Buku (keuangan) tempat tagihan bulan yang sedang diproses disimpan. */
  tahun_ajaran_id: string;
  /**
   * Tahun Ajaran (akademik) untuk mengambil penempatan kelas siswa. Jika tidak
   * diisi, fallback ke tahun_ajaran_id untuk kompatibilitas alur lama. Ini
   * penting ketika TA Juli–Juni dipecah ke dua Tahun Buku Jan–Des.
   */
  tahun_akademik_id?: string;
  jenis_id: string;
  bulan?: number | null;
  bulan_list?: number[];
  departemen_id?: string;
  /** Generate untuk satu angkatan (tahun masuk) tertentu. Sama seperti
   *  departemen_id, hanya diterapkan kalau siswa_ids/siswa_id/kelas_id
   *  kosong (filter yang lebih spesifik selalu menang). */
  angkatan_id?: string;
  siswa_id?: string;
  kelas_id?: string;
  /** Generate untuk daftar siswa tertentu sekaligus (input tarif massal).
   *  Lebih spesifik dari siswa_id/kelas_id — dipakai duluan bila terisi. */
  siswa_ids?: string[];
}

export interface GenerateTagihanResult {
  success: true;
  generated: number;
  skipped: number;
  /**
   * Bagian dari `generated` yang periodenya belum jatuh tempo, sehingga baru
   * tersimpan sebagai jadwal (status 'terjadwal') TANPA jurnal piutang.
   * Piutang & pendapatannya baru diakui saat jatuh tempo, lewat RPC
   * jalankan_akrual_jatuh_tempo.
   */
  scheduled: number;
  total_siswa?: number;
  bulan_count?: number;
  message?: string;
  errors?: string[];
}

export const generateTagihan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: GenerateTagihanInput) => d)
  .handler(async ({ data, context }): Promise<GenerateTagihanResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [
      "admin",
      "keuangan",
    ]);

    const {
      tahun_ajaran_id,
      tahun_akademik_id,
      jenis_id,
      bulan,
      bulan_list,
      departemen_id,
      angkatan_id,
      siswa_id,
      kelas_id,
      siswa_ids,
    } = data;

    const bulanArray: (number | null)[] =
      bulan_list && Array.isArray(bulan_list) && bulan_list.length > 0
        ? bulan_list
        : bulan != null
          ? [bulan]
          : [null];

    if (!tahun_ajaran_id || !jenis_id) {
      throw new Error("tahun_ajaran_id dan jenis_id wajib diisi");
    }

    // `tahun_ajaran_id` pada tabel keuangan tetap menunjuk Tahun Buku. Untuk
    // mencari kelas_siswa, gunakan Tahun Ajaran akademik bila UI mengirimkannya.
    const tahunKelasId = tahun_akademik_id || tahun_ajaran_id;

    const { data: jenis, error: jenisErr } = await admin
      .from("jenis_pembayaran")
      .select("id, nama, nominal, tipe, akun_pendapatan_id")
      .eq("id", jenis_id)
      .single();
    if (jenisErr || !jenis) throw new Error("Jenis pembayaran tidak ditemukan");

    const { data: pengaturan } = await admin
      .from("pengaturan_akun")
      .select("kode_setting, akun_id")
      .in("kode_setting", ["piutang_siswa"]);
    const piutangAkunId = pengaturan?.find(
      (p) => p.kode_setting === "piutang_siswa"
    )?.akun_id;

    if (!piutangAkunId) {
      throw new Error(
        "Akun piutang siswa belum dikonfigurasi di Pengaturan Akun"
      );
    }
    if (!jenis.akun_pendapatan_id) {
      throw new Error(`Akun pendapatan belum diset untuk jenis "${jenis.nama}"`);
    }

    // Ambil siswa berdasarkan filter: siswa_ids > siswa_id > kelas_id > semua
    let kelasSiswaList: { siswa_id: string; kelas_id: string }[] = [];

    if (siswa_ids && siswa_ids.length > 0) {
      const { data: rows, error } = await admin
        .from("kelas_siswa")
        .select("siswa_id, kelas_id")
        .in("siswa_id", siswa_ids)
        .eq("tahun_ajaran_id", tahunKelasId)
        .eq("aktif", true);
      if (error)
        throw new Error("Gagal mengambil data kelas siswa: " + error.message);
      kelasSiswaList = rows || [];
      // Siswa tanpa penempatan kelas aktif di tahun ini tetap diikutkan
      // (kelas null) — konsisten dengan perilaku parameter siswa_id tunggal
      const adaKelas = new Set(kelasSiswaList.map((ks) => ks.siswa_id));
      for (const id of siswa_ids) {
        if (!adaKelas.has(id)) {
          kelasSiswaList.push({ siswa_id: id, kelas_id: null as unknown as string });
        }
      }
    } else if (siswa_id) {
      const { data: rows, error } = await admin
        .from("kelas_siswa")
        .select("siswa_id, kelas_id")
        .eq("siswa_id", siswa_id)
        .eq("tahun_ajaran_id", tahunKelasId)
        .eq("aktif", true);
      if (error)
        throw new Error("Gagal mengambil data kelas siswa: " + error.message);
      kelasSiswaList = rows || [];
      if (kelasSiswaList.length === 0) {
        kelasSiswaList = [{ siswa_id, kelas_id: (kelas_id || null) as string }];
      }
    } else if (kelas_id) {
      const { data: rows, error } = await admin
        .from("kelas_siswa")
        .select("siswa_id, kelas_id")
        .eq("kelas_id", kelas_id)
        .eq("tahun_ajaran_id", tahunKelasId)
        .eq("aktif", true);
      if (error)
        throw new Error("Gagal mengambil data kelas siswa: " + error.message);
      kelasSiswaList = rows || [];
    } else {
      const { data: rows, error } = await admin
        .from("kelas_siswa")
        .select("siswa_id, kelas_id")
        .eq("aktif", true)
        .eq("tahun_ajaran_id", tahunKelasId);
      if (error)
        throw new Error("Gagal mengambil data kelas siswa: " + error.message);
      kelasSiswaList = rows || [];
    }

    if (kelasSiswaList.length === 0) {
      return {
        success: true,
        generated: 0,
        skipped: 0,
        scheduled: 0,
        message: "Tidak ada siswa yang cocok dengan kriteria",
      };
    }

    // Filter by departemen bila diminta & belum difilter siswa/kelas eksplisit
    if (departemen_id && !siswa_ids?.length && !siswa_id && !kelas_id) {
      const kelasIds = [
        ...new Set(kelasSiswaList.map((ks) => ks.kelas_id).filter(Boolean)),
      ];
      if (kelasIds.length > 0) {
        const { data: kelasData } = await admin
          .from("kelas")
          .select("id")
          .eq("departemen_id", departemen_id)
          .in("id", kelasIds);
        const validKelasIds = new Set((kelasData || []).map((k) => k.id));
        kelasSiswaList = kelasSiswaList.filter((ks) =>
          validKelasIds.has(ks.kelas_id)
        );
      }
    }

    // Filter by angkatan bila diminta & belum difilter siswa/kelas eksplisit
    // -- mis. generate "Uang Gedung Baru" langsung untuk seluruh angkatan
    // 2024 tanpa harus cari siswa/kelas satu-satu dulu.
    if (angkatan_id && !siswa_ids?.length && !siswa_id && !kelas_id) {
      const { data: siswaAngkatan } = await admin
        .from("siswa")
        .select("id")
        .eq("angkatan_id", angkatan_id)
        .in(
          "id",
          kelasSiswaList.map((ks) => ks.siswa_id)
        );
      const validSiswaIds = new Set((siswaAngkatan || []).map((s) => s.id));
      kelasSiswaList = kelasSiswaList.filter((ks) =>
        validSiswaIds.has(ks.siswa_id)
      );
    }

    let generated = 0;
    let skipped = 0;
    let scheduled = 0;
    const errors: string[] = [];

    // Satu panggilan RPC PER BULAN, bukan per siswa. Stored procedure
    // `generate_tagihan_batch` melakukan seluruh proses (tarif + jurnal +
    // jurnal_detail + tagihan, untuk semua siswa dalam daftar) dalam satu
    // transaksi di sisi database. Kalau satu bulan gagal total (mis. RPC
    // error jaringan), bulan lain tetap lanjut diproses karena kita
    // membungkus tiap panggilan dengan try/catch sendiri-sendiri.
    for (const currentBulan of bulanArray) {
      try {
        const { data: result, error: rpcErr } = await admin.rpc(
          "generate_tagihan_batch",
          {
            p_jenis_id: jenis_id,
            p_tahun_ajaran_id: tahun_ajaran_id,
            p_bulan: currentBulan,
            p_departemen_id: departemen_id || null,
            p_siswa_list: kelasSiswaList.map((ks) => ({
              siswa_id: ks.siswa_id,
              kelas_id: ks.kelas_id || null,
            })),
            p_created_by: userId,
          }
        );

        if (rpcErr) {
          errors.push(
            `Bulan ${currentBulan ?? "-"}: gagal generate (${rpcErr.message})`
          );
          continue;
        }

        // RPC bertipe RETURNS TABLE — hasilnya array dengan 1 baris
        const row = Array.isArray(result) ? result[0] : result;
        generated += row?.generated ?? 0;
        skipped += row?.skipped ?? 0;
        scheduled += row?.scheduled ?? 0;
        if (row?.errors && Array.isArray(row.errors) && row.errors.length > 0) {
          errors.push(
            ...row.errors.map((e: string) => `Bulan ${currentBulan ?? "-"}: ${e}`)
          );
        }
      } catch (err) {
        // Kegagalan tak terduga (mis. network) untuk SATU bulan tidak boleh
        // menghentikan proses bulan-bulan lainnya.
        errors.push(
          `Bulan ${currentBulan ?? "-"}: ${err instanceof Error ? err.message : "gagal"}`
        );
      }
    }

    return {
      success: true,
      generated,
      skipped,
      scheduled,
      total_siswa: kelasSiswaList.length,
      bulan_count: bulanArray.filter((b) => b !== null).length || 1,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    };
  });

// ─── Koreksi / Pembatalan Tagihan (atomik via RPC) ──────────────────────────
// Menggantikan logic yang sebelumnya dijalankan langsung dari browser di
// src/hooks/useTagihan.ts (useKoreksiTagihan), yang melakukan beberapa
// request Supabase terpisah secara berurutan (jurnal pembalik -> update
// tagihan -> audit log) tanpa dibungkus transaksi. Kalau koneksi klien
// timeout/putus di tengah proses, itu bisa menyisakan jurnal pembalik yang
// sudah tercatat tapi status tagihan belum ter-update — data tidak konsisten.
//
// Di sini seluruh proses dibungkus SATU RPC atomik (batalkan_tagihan_atomik,
// lihat migration terkait) yang dipanggil dari server function memakai admin
// client. Kalau koneksi browser pengguna terputus setelah request terkirim,
// RPC di database tetap selesai (commit atau rollback) secara utuh —
// tidak ada state "setengah jalan".

export interface KoreksiTagihanInput {
  tagihan_id: string;
  mode: "batal" | "koreksi_nominal";
  alasan: string;
  tanggal?: string; // "yyyy-MM-dd", default hari ini
  nominal_baru?: number; // wajib untuk mode koreksi_nominal
}

export interface KoreksiTagihanResult {
  success: true;
  mode: "batal" | "koreksi_nominal";
  tagihan_id: string;
  jurnal_pembalik_id: string | null;
  jurnal_baru_id?: string | null;
  warn_no_jurnal?: boolean;
}

export const batalkanTagihan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: KoreksiTagihanInput) => d)
  .handler(async ({ data, context }): Promise<KoreksiTagihanResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [
      "admin",
      "keuangan",
    ]);

    const { tagihan_id, mode, alasan, nominal_baru } = data;
    const tanggal = data.tanggal || new Date().toISOString().split("T")[0];

    if (!tagihan_id) throw new Error("tagihan_id wajib diisi");
    if (!alasan || !alasan.trim()) throw new Error("Alasan wajib diisi");
    if (mode === "koreksi_nominal" && (!nominal_baru || nominal_baru <= 0)) {
      throw new Error("Nominal baru harus lebih dari 0");
    }

    const { data: result, error: rpcErr } = await admin.rpc(
      "batalkan_tagihan_atomik",
      {
        p_tagihan_id: tagihan_id,
        p_mode: mode,
        p_alasan: alasan,
        p_tanggal: tanggal,
        p_user_id: userId,
        p_nominal_baru: mode === "koreksi_nominal" ? nominal_baru : null,
      }
    );
    if (rpcErr) {
      throw new Error(
        mode === "batal"
          ? "Gagal membatalkan tagihan: " + rpcErr.message
          : "Gagal mengoreksi tagihan: " + rpcErr.message
      );
    }

    const r = (result || {}) as {
      jurnal_pembalik_id?: string | null;
      jurnal_baru_id?: string | null;
      warn_no_jurnal?: boolean;
    };

    return {
      success: true,
      mode,
      tagihan_id,
      jurnal_pembalik_id: r.jurnal_pembalik_id ?? null,
      jurnal_baru_id: r.jurnal_baru_id ?? null,
      warn_no_jurnal: r.warn_no_jurnal ?? false,
    };
  });

export interface BatalkanTagihanBatchInput {
  tagihan_ids: string[];
  alasan: string;
  tanggal?: string;
}

export interface BatalkanTagihanBatchResult {
  success: true;
  berhasil: number;
  gagal: { tagihan_id: string; error: string }[];
}

// Batas jumlah tagihan per panggilan batch. RPC atomik hanya 1 subrequest per
// tagihan (dibanding ~5 subrequest/siswa/bulan pada generateTagihan versi
// lama), tapi tetap dibatasi supaya satu invocation Worker tidak memproses
// terlalu banyak transaksi database berurutan sekaligus.
const MAX_BATCH_SIZE = 100;

export const batalkanTagihanBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: BatalkanTagihanBatchInput) => d)
  .handler(async ({ data, context }): Promise<BatalkanTagihanBatchResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [
      "admin",
      "keuangan",
    ]);

    const { tagihan_ids, alasan } = data;
    const tanggal = data.tanggal || new Date().toISOString().split("T")[0];

    if (!Array.isArray(tagihan_ids) || tagihan_ids.length === 0) {
      throw new Error("tagihan_ids wajib diisi (minimal 1)");
    }
    if (tagihan_ids.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Maksimal ${MAX_BATCH_SIZE} tagihan per proses. Pilih lebih sedikit lalu ulangi untuk sisanya.`
      );
    }
    if (!alasan || !alasan.trim()) throw new Error("Alasan wajib diisi");

    // SATU panggilan RPC untuk seluruh batch (1 subrequest dari sisi Worker),
    // bukan loop admin.rpc() per tagihan seperti versi sebelumnya. Versi loop
    // sempat menembus limit "Too many subrequests by single Worker invocation"
    // Cloudflare Workers ketika batch berisi banyak tagihan (mis. 13 tagihan
    // bulanan untuk satu siswa) — tiap panggilan admin.rpc() dihitung sebagai
    // subrequest tersendiri. RPC batalkan_tagihan_batch memindahkan loop-nya
    // ke dalam Postgres, dengan tiap tagihan tetap diproses dalam sub-block
    // BEGIN...EXCEPTION...END sehingga satu tagihan gagal tidak membatalkan
    // tagihan lain yang sudah berhasil — pola sama seperti generate_tagihan_batch.
    const { data: rows, error: rpcErr } = await admin.rpc("batalkan_tagihan_batch", {
      p_tagihan_ids: tagihan_ids,
      p_alasan: alasan,
      p_tanggal: tanggal,
      p_user_id: userId,
    });
    if (rpcErr) {
      throw new Error("Gagal memproses pembatalan massal: " + rpcErr.message);
    }

    let berhasil = 0;
    const gagal: { tagihan_id: string; error: string }[] = [];
    for (const row of rows || []) {
      if (row.berhasil) {
        berhasil++;
      } else {
        gagal.push({ tagihan_id: row.tagihan_id, error: row.error_message || "Gagal tidak diketahui" });
      }
    }

    return { success: true, berhasil, gagal };
  });