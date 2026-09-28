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
  tagihan_tunggak: { tagihan_id: string; bulan: number; sisa: number }[];
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

    const { jenis_id, tahun_ajaran_id, kelas_id, bulan_list } = data;
    const perTanggal = data.per_tanggal || new Date().toISOString().split("T")[0];

    if (!jenis_id || !tahun_ajaran_id) {
      throw new Error("jenis_id dan tahun_ajaran_id wajib diisi");
    }

    // Gunakan kelas AKTIF siswa sebagai identitas tampilan, bukan kelas pada
    // tahun tagihan. Data migrasi dapat berisi tunggakan periode lama (mis.
    // SPP SD 2025) sementara histori kelas tahun tersebut tidak tersedia lagi
    // dan siswa sekarang sudah berada di jenjang lain. Sumber lembaga tetap
    // ditentukan oleh jenis pembayaran/tagihan yang dipilih.
    let siswaQuery = admin
      .from("kelas_siswa")
      .select("siswa_id, siswa:siswa_id(nis, nama), kelas:kelas_id(nama, departemen_id)")
      .eq("aktif", true);
    if (kelas_id) siswaQuery = siswaQuery.eq("kelas_id", kelas_id);
    const { data: kelasSiswaRows, error: ksErr } = await siswaQuery;
    if (ksErr)
      throw new Error("Gagal mengambil data kelas siswa: " + ksErr.message);

    interface KelasSiswaRow {
      siswa_id: string;
      siswa: { nis: string | null; nama: string | null } | null;
      kelas: { nama: string | null; departemen_id: string | null } | null;
    }
    const filtered = (kelasSiswaRows || []) as unknown as KelasSiswaRow[];
    if (!filtered.length) return { rows: [], per_tanggal: perTanggal };

    const siswaIds = Array.from(new Set(filtered.map((r) => r.siswa_id)));
    const siswaIdSet = new Set(siswaIds);

    // Jangan kirim >1.000 siswa aktif sebagai satu filter .in(...): selain URL
    // menjadi terlalu panjang, PostgREST juga membatasi satu response page.
    // Ambil tagihan per jenis+tahun secara berhalaman lalu saring ke siswa aktif
    // di server. Ini juga membuat laporan tetap lengkap bila satu jenis punya
    // >1.000 baris tagihan.
    type BatchTagihanRow = {
      id: string;
      siswa_id: string | null;
      bulan: number | null;
      nominal: number | string | null;
      jatuh_tempo: string | null;
    };
    const tagihanRows: BatchTagihanRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let tagihanQuery = admin
        .from("tagihan")
        .select("id, siswa_id, bulan, nominal, jatuh_tempo")
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahun_ajaran_id)
        .not("status", "in", `(${STATUS_SELESAI.join(",")})`)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (bulan_list && bulan_list.length > 0) {
        tagihanQuery = tagihanQuery.in("bulan", bulan_list);
      }

      const { data: page, error: tErr } = await tagihanQuery;
      if (tErr) throw new Error("Gagal mengambil data tagihan: " + tErr.message);
      for (const row of page || []) {
        if (row.siswa_id && siswaIdSet.has(row.siswa_id)) {
          tagihanRows.push(row as BatchTagihanRow);
        }
      }
      if (!page || page.length < pageSize) break;
    }
    if (!tagihanRows.length) return { rows: [], per_tanggal: perTanggal };

    // Pembayaran parsial juga dibaca berhalaman. Filtering siswa dilakukan di
    // server supaya tidak membangun query-string .in(...) yang sangat panjang.
    type BatchPaymentRow = {
      siswa_id: string | null;
      bulan: number | null;
      jumlah: number | string | null;
    };
    const payments: BatchPaymentRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data: page, error: pErr } = await admin
        .from("pembayaran")
        .select("siswa_id, bulan, jumlah")
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahun_ajaran_id)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (pErr) throw new Error("Gagal mengambil data pembayaran: " + pErr.message);
      for (const row of page || []) {
        if (row.siswa_id && siswaIdSet.has(row.siswa_id)) {
          payments.push(row as BatchPaymentRow);
        }
      }
      if (!page || page.length < pageSize) break;
    }

    const kunci = (siswaId: string, bulan: number | null) => `${siswaId}|${bulan ?? "x"}`;
    const terbayarMap = new Map<string, number>();
    for (const p of payments) {
      const k = kunci(p.siswa_id!, p.bulan);
      terbayarMap.set(k, (terbayarMap.get(k) || 0) + (Number(p.jumlah) || 0));
    }

    // Satu baris hasil = satu tagihan/periode. Jangan gabungkan beberapa bulan
    // milik siswa menjadi satu total karena kasir harus bisa memilih tunggakan
    // tertentu (mis. November saja tanpa otomatis ikut Desember).
    const siswaMeta = new Map<string, KelasSiswaRow>();
    for (const ks of filtered) {
      if (!siswaMeta.has(ks.siswa_id)) siswaMeta.set(ks.siswa_id, ks);
    }

    const rows: TunggakanSiswaRow[] = [];
    for (const t of tagihanRows) {
      const nominal = Number(t.nominal) || 0;
      const k = kunci(t.siswa_id!, t.bulan);
      const terbayar = Math.min(terbayarMap.get(k) || 0, nominal);
      const sisa = nominal - terbayar;
      if (sisa <= 0) continue;
      if (!sudahMenunggak(t.jatuh_tempo, perTanggal)) continue; // belum jatuh tempo -> bukan tunggakan

      const ks = siswaMeta.get(t.siswa_id!);
      if (!ks) continue;

      rows.push({
        siswa_id: t.siswa_id!,
        nis: ks.siswa?.nis ?? null,
        nama: ks.siswa?.nama ?? null,
        kelas: ks.kelas?.nama ?? null,
        bulan_tunggak: [t.bulan ?? 0],
        tagihan_tunggak: [{ tagihan_id: t.id, bulan: t.bulan ?? 0, sisa }],
        total: sisa,
      });
    }

    rows.sort((a, b) => {
      const byName = (a.nama ?? "").localeCompare(b.nama ?? "", "id");
      if (byName !== 0) return byName;
      return (a.bulan_tunggak[0] ?? 0) - (b.bulan_tunggak[0] ?? 0);
    });

    return { rows, per_tanggal: perTanggal };
  });