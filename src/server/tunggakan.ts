/**
 * Server function: rekapTunggakan
 * Migrasi dari supabase/functions/rekap-tunggakan.
 * Rekap sisa tunggakan siswa. Boleh staff, atau siswa/ortu terkait.
 *
 * CATATAN PERBAIKAN (2026-07-28): versi lama menganggap SEMUA tagihan yang
 * belum lunas sebagai tunggakan. Dua akibatnya:
 *
 *   1. Bulan yang belum tiba ikut dihitung menunggak. Sekolah meng-input SPP
 *      sampai 6 tahun ke depan (kelas 1 SD) — dengan logika lama, siswa baru
 *      yang belum telat sepeser pun langsung tampil menunggak 72 bulan.
 *   2. Nominalnya diambil dari `jenis_pembayaran.nominal` (tarif umum) dan
 *      bulan 1..12 di-loop untuk setiap jenis aktif, tanpa melihat tabel
 *      `tagihan` sama sekali — jadi siswa yang tarifnya beda (beasiswa,
 *      keringanan) atau yang memang tidak ditagih bulan tsb tetap muncul.
 *
 * Sekarang tunggakan dibaca dari tabel `tagihan` yang benar-benar ada, dan
 * hanya tagihan yang tanggal jatuh temponya SUDAH LEWAT yang dihitung sebagai
 * tunggakan. Tagihan yang belum jatuh tempo dilaporkan terpisah (tidak
 * dijumlahkan ke total tunggakan) supaya tetap bisa ditampilkan sebagai
 * "tagihan mendatang".
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";
import { hariTerlambat, sudahMenunggak } from "@/lib/jatuhTempo";

export interface RekapTunggakanInput {
  siswa_id: string;
  tahun_ajaran_id?: string;
  /** Ikut sertakan tagihan yang belum jatuh tempo di daftar (default false). */
  sertakan_belum_jatuh_tempo?: boolean;
  /** Tanggal acuan "hari ini" dalam format yyyy-MM-dd. Default: hari ini. */
  per_tanggal?: string;
}

export interface TunggakanRow {
  tagihan_id: string;
  jenis: string;
  /** 0 = sekali bayar (konvensi UI), 1-12 = bulanan. */
  bulan: number;
  nominal: number;
  terbayar: number;
  sisa: number;
  tipe: string;
  status: string;
  jatuh_tempo: string | null;
  /** Selisih hari sejak jatuh tempo; 0 kalau belum jatuh tempo. */
  hari_terlambat: number;
  menunggak: boolean;
}

export interface RekapTunggakanResult {
  tunggakan: TunggakanRow[];
  /** Total yang benar-benar menunggak (sudah lewat jatuh tempo). */
  total: number;
  /** Total tagihan yang sudah terbit tapi belum jatuh tempo. */
  total_belum_jatuh_tempo: number;
  per_tanggal: string;
}

/** Status tagihan yang sudah tidak menagih apa pun lagi. */
const STATUS_SELESAI = ["lunas", "dibatalkan", "dihapusbuku"];

/**
 * Bentuk baris tagihan yang dibaca di sini. Relasi `jenis` di-embed lewat
 * PostgREST, yang tidak tercermin di tipe hasil generate — karena itu hasil
 * query di-cast ke tipe ini secara eksplisit.
 */
interface TagihanRow {
  id: string;
  jenis_id: string;
  bulan: number | null;
  nominal: number;
  status: string;
  jatuh_tempo: string | null;
  tahun_ajaran_id: string;
  jenis: { nama: string | null; tipe: string | null } | null;
}

export const rekapTunggakan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: RekapTunggakanInput) => d)
  .handler(async ({ data, context }): Promise<RekapTunggakanResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    const {
      siswa_id,
      tahun_ajaran_id,
      sertakan_belum_jatuh_tempo = false,
    } = data;
    const perTanggal =
      data.per_tanggal || new Date().toISOString().split("T")[0];

    const { data: profile } = await admin
      .from("users_profile")
      .select("role")
      .eq("id", userId)
      .single();

    const staffRoles = ["admin", "keuangan", "kasir"];
    const isStaff = profile && staffRoles.includes(profile.role);

    if (!isStaff) {
      const { data: isOwn } = await admin.rpc("is_own_siswa", {
        _user_id: userId,
        _siswa_id: siswa_id,
      });
      const { data: isParent } = await admin.rpc("is_ortu_of", {
        p_user_id: userId,
        p_siswa_id: siswa_id,
      });
      if (!isOwn && !isParent) throw new Error("Forbidden: akses ditolak");
    }

    let tagihanQuery = admin
      .from("tagihan")
      .select(
        "id, jenis_id, bulan, nominal, status, jatuh_tempo, tahun_ajaran_id, jenis:jenis_id(nama, tipe)"
      )
      .eq("siswa_id", siswa_id)
      .not("status", "in", `(${STATUS_SELESAI.join(",")})`);
    if (tahun_ajaran_id)
      tagihanQuery = tagihanQuery.eq("tahun_ajaran_id", tahun_ajaran_id);

    const { data: tagihanList, error: tagihanErr } = await tagihanQuery;
    if (tagihanErr)
      throw new Error("Gagal mengambil data tagihan: " + tagihanErr.message);
    if (!tagihanList?.length)
      return {
        tunggakan: [],
        total: 0,
        total_belum_jatuh_tempo: 0,
        per_tanggal: perTanggal,
      };

    // Pembayaran parsial: satu tagihan bisa dicicil lewat beberapa baris
    // pembayaran, jadi sisa dihitung dari total yang sudah masuk untuk
    // kombinasi jenis+bulan+periode yang sama.
    let pembayaranQuery = admin
      .from("pembayaran")
      .select("jenis_id, bulan, jumlah, tahun_ajaran_id")
      .eq("siswa_id", siswa_id);
    if (tahun_ajaran_id)
      pembayaranQuery = pembayaranQuery.eq("tahun_ajaran_id", tahun_ajaran_id);

    const { data: payments } = await pembayaranQuery;

    const kunci = (
      jenisId: string,
      bulan: number | null,
      periodeId: string | null
    ) => `${jenisId}|${bulan ?? "x"}|${periodeId ?? "x"}`;

    const terbayarMap = new Map<string, number>();
    for (const p of payments || []) {
      const k = kunci(p.jenis_id!, p.bulan, p.tahun_ajaran_id);
      terbayarMap.set(k, (terbayarMap.get(k) || 0) + (Number(p.jumlah) || 0));
    }

    const tunggakan: TunggakanRow[] = [];
    let total = 0;
    let totalBelumJatuhTempo = 0;

    for (const t of tagihanList as unknown as TagihanRow[]) {
      const nominal = Number(t.nominal) || 0;
      const k = kunci(t.jenis_id, t.bulan, t.tahun_ajaran_id);
      const terbayar = Math.min(terbayarMap.get(k) || 0, nominal);
      const sisa = nominal - terbayar;
      if (sisa <= 0) continue;

      const jatuhTempo: string | null = t.jatuh_tempo ?? null;
      const menunggak = sudahMenunggak(jatuhTempo, perTanggal);
      const terlambat = hariTerlambat(jatuhTempo, perTanggal);

      if (menunggak) {
        total += sisa;
      } else {
        totalBelumJatuhTempo += sisa;
        if (!sertakan_belum_jatuh_tempo) continue;
      }

      tunggakan.push({
        tagihan_id: t.id,
        jenis: t.jenis?.nama ?? "-",
        bulan: t.bulan ?? 0,
        nominal,
        terbayar,
        sisa,
        tipe: t.jenis?.tipe ?? "bulanan",
        status: t.status,
        jatuh_tempo: jatuhTempo,
        hari_terlambat: terlambat,
        menunggak,
      });
    }

    // Paling telat di atas; tagihan mendatang menyusul secara kronologis.
    tunggakan.sort((a, b) => {
      if (a.menunggak !== b.menunggak) return a.menunggak ? -1 : 1;
      return (a.jatuh_tempo ?? "").localeCompare(b.jatuh_tempo ?? "");
    });

    return {
      tunggakan,
      total,
      total_belum_jatuh_tempo: totalBelumJatuhTempo,
      per_tanggal: perTanggal,
    };
  });

// ─── rekapTunggakanBatch: sama seperti rekapTunggakan, tapi untuk BANYAK ────
// siswa sekaligus (dipakai halaman TunggakanPembayaran untuk bayar massal).
//
// CATATAN PERBAIKAN (2026-07-28): versi lama halaman ini (lihat git log
// TunggakanPembayaran.tsx) tidak membaca tabel `tagihan` sama sekali --
// "menunggak" dihitung dari ada/tidaknya baris `pembayaran` untuk kombinasi
// siswa+jenis+bulan dalam rentang bulan yang dipilih user secara manual.
// Akibatnya bulan yang belum pernah ditagih (tagihan belum di-generate, atau
// sudah di-generate tapi masih berstatus 'terjadwal' karena belum jatuh
// tempo) tetap tampil sebagai tunggakan. Sekarang sumbernya tabel `tagihan`
// yang sebenarnya, dan hanya baris yang jatuh temponya SUDAH LEWAT yang
// dihitung -- persis logika rekapTunggakan di atas, hanya digeneralisasi ke
// banyak siswa dalam satu kelas/jenis pembayaran sekaligus.
export interface RekapTunggakanBatchInput {
  jenis_id: string;
  tahun_ajaran_id: string;
  kelas_id?: string;
  departemen_id?: string;
  /** Filter bulan (tipe bulanan). Kosong/undefined = semua bulan. */
  bulan_list?: number[];
  per_tanggal?: string;
}

export interface TunggakanSiswaRow {
  siswa_id: string;
  nis: string | null;
  nama: string | null;
  kelas: string | null;
  /** 0 = sekali bayar (konvensi UI), 1-12 = bulanan; hanya bulan yang menunggak. */
  bulan_tunggak: number[];
  total: number;
}

export interface RekapTunggakanBatchResult {
  rows: TunggakanSiswaRow[];
  per_tanggal: string;
}

export const rekapTunggakanBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: RekapTunggakanBatchInput) => d)
  .handler(async ({ data, context }): Promise<RekapTunggakanBatchResult> => {
    const admin = createAdminClient();
    await requireRole(admin, requireContext(context).userId, [
      "admin",
      "keuangan",
      "kasir",
    ]);

    const { jenis_id, tahun_ajaran_id, kelas_id, departemen_id, bulan_list } = data;
    const perTanggal = data.per_tanggal || new Date().toISOString().split("T")[0];

    if (!jenis_id || !tahun_ajaran_id) {
      throw new Error("jenis_id dan tahun_ajaran_id wajib diisi");
    }

    // Siswa aktif sesuai filter kelas/lembaga
    let siswaQuery = admin
      .from("kelas_siswa")
      .select("siswa_id, siswa:siswa_id(nis, nama), kelas:kelas_id(nama, departemen_id)")
      .eq("aktif", true)
      .eq("tahun_ajaran_id", tahun_ajaran_id);
    if (kelas_id) siswaQuery = siswaQuery.eq("kelas_id", kelas_id);
    const { data: kelasSiswaRows, error: ksErr } = await siswaQuery;
    if (ksErr)
      throw new Error("Gagal mengambil data kelas siswa: " + ksErr.message);

    interface KelasSiswaRow {
      siswa_id: string;
      siswa: { nis: string | null; nama: string | null } | null;
      kelas: { nama: string | null; departemen_id: string | null } | null;
    }
    let filtered = (kelasSiswaRows || []) as unknown as KelasSiswaRow[];
    if (departemen_id)
      filtered = filtered.filter((r) => r.kelas?.departemen_id === departemen_id);
    if (!filtered.length) return { rows: [], per_tanggal: perTanggal };

    const siswaIds = filtered.map((r) => r.siswa_id);

    // Tagihan yang masih menagih (belum lunas/dibatalkan/dihapusbuku)
    let tagihanQuery = admin
      .from("tagihan")
      .select("siswa_id, bulan, nominal, jatuh_tempo")
      .eq("jenis_id", jenis_id)
      .eq("tahun_ajaran_id", tahun_ajaran_id)
      .in("siswa_id", siswaIds)
      .not("status", "in", `(${STATUS_SELESAI.join(",")})`);
    if (bulan_list && bulan_list.length > 0) tagihanQuery = tagihanQuery.in("bulan", bulan_list);
    const { data: tagihanRows, error: tErr } = await tagihanQuery;
    if (tErr) throw new Error("Gagal mengambil data tagihan: " + tErr.message);
    if (!tagihanRows?.length) return { rows: [], per_tanggal: perTanggal };

    // Pembayaran (untuk sisa parsial -- satu tagihan bisa dicicil)
    const { data: payments } = await admin
      .from("pembayaran")
      .select("siswa_id, bulan, jumlah")
      .eq("jenis_id", jenis_id)
      .eq("tahun_ajaran_id", tahun_ajaran_id)
      .in("siswa_id", siswaIds);

    const kunci = (siswaId: string, bulan: number | null) => `${siswaId}|${bulan ?? "x"}`;
    const terbayarMap = new Map<string, number>();
    for (const p of payments || []) {
      const k = kunci(p.siswa_id!, p.bulan);
      terbayarMap.set(k, (terbayarMap.get(k) || 0) + (Number(p.jumlah) || 0));
    }

    const bySiswa = new Map<string, { bulanTunggak: number[]; total: number }>();
    for (const t of tagihanRows) {
      const nominal = Number(t.nominal) || 0;
      const k = kunci(t.siswa_id!, t.bulan);
      const terbayar = Math.min(terbayarMap.get(k) || 0, nominal);
      const sisa = nominal - terbayar;
      if (sisa <= 0) continue;
      if (!sudahMenunggak(t.jatuh_tempo, perTanggal)) continue; // belum jatuh tempo -> bukan tunggakan

      const entry = bySiswa.get(t.siswa_id!) || { bulanTunggak: [], total: 0 };
      entry.bulanTunggak.push(t.bulan ?? 0);
      entry.total += sisa;
      bySiswa.set(t.siswa_id!, entry);
    }

    const rows: TunggakanSiswaRow[] = [];
    for (const ks of filtered) {
      const agg = bySiswa.get(ks.siswa_id);
      if (!agg) continue;
      rows.push({
        siswa_id: ks.siswa_id,
        nis: ks.siswa?.nis ?? null,
        nama: ks.siswa?.nama ?? null,
        kelas: ks.kelas?.nama ?? null,
        bulan_tunggak: agg.bulanTunggak.sort((a, b) => a - b),
        total: agg.total,
      });
    }

    return { rows, per_tanggal: perTanggal };
  });
