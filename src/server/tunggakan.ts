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

    // Pembayaran boleh diterima pada tahun buku berbeda dari tahun tagihan.
    // Rujukan tagihan_id menjadi sumber utama; tanpa rujukan gunakan fallback
    // periode yang sama untuk kompatibilitas pembayaran legacy.
    const { data: payments, error: paymentsErr } = await admin
      .from("pembayaran")
      .select("tagihan_id, jenis_id, bulan, jumlah, tahun_ajaran_id")
      .eq("siswa_id", siswa_id);
    if (paymentsErr) throw new Error("Gagal membaca pembayaran: " + paymentsErr.message);

    const kunci = (
      jenisId: string,
      bulan: number | null,
      periodeId: string | null
    ) => `${jenisId}|${bulan ?? "x"}|${periodeId ?? "x"}`;

    const terbayarMap = new Map<string, number>();
    const terbayarPerTagihan = new Map<string, number>();
    for (const p of payments || []) {
      if (p.tagihan_id) {
        terbayarPerTagihan.set(p.tagihan_id, (terbayarPerTagihan.get(p.tagihan_id) || 0) + (Number(p.jumlah) || 0));
      } else {
        const k = kunci(p.jenis_id!, p.bulan, p.tahun_ajaran_id);
        terbayarMap.set(k, (terbayarMap.get(k) || 0) + (Number(p.jumlah) || 0));
      }
    }

    const tunggakan: TunggakanRow[] = [];
    let total = 0;
    let totalBelumJatuhTempo = 0;

    for (const t of tagihanList as unknown as TagihanRow[]) {
      const nominal = Number(t.nominal) || 0;
      const k = kunci(t.jenis_id, t.bulan, t.tahun_ajaran_id);
      const terbayar = Math.min(Math.max(0, (terbayarPerTagihan.get(t.id) || 0) + (terbayarMap.get(k) || 0)), nominal);
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
  tanpa_kelas?: boolean;
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

    const { jenis_id, tahun_ajaran_id, kelas_id, bulan_list, tanpa_kelas } = data;
    const perTanggal = data.per_tanggal || new Date().toISOString().split("T")[0];

    if (!jenis_id || !tahun_ajaran_id) {
      throw new Error("jenis_id dan tahun_ajaran_id wajib diisi");
    }
    if (kelas_id && tanpa_kelas) throw new Error("Filter kelas tidak valid");

    // Filter kelas bersifat opsional. Sumber tunggakan adalah tagihan,
    // bukan tabel kelas_siswa: calon siswa lulus SPMB bisa belum ditempatkan.
    // Bila kelas dipilih, batasi berdasarkan penempatan aktif seperti sebelumnya.
    let selectedClassStudentIds: Set<string> | null = null;
    if (kelas_id) {
      const { data: matching, error } = await admin.from("kelas_siswa")
        .select("siswa_id").eq("aktif", true).eq("kelas_id", kelas_id);
      if (error) throw new Error("Gagal mengambil siswa kelas: " + error.message);
      selectedClassStudentIds = new Set((matching || []).map(row => row.siswa_id));
      if (!selectedClassStudentIds.size) return { rows: [], per_tanggal: perTanggal };
    }

    interface KelasSiswaRow {
      siswa_id: string;
      siswa: { nis: string | null; nama: string | null } | null;
      kelas: { nama: string | null; departemen_id: string | null } | null;
    }
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
      jenis_pembayaran?: { departemen_id: string | null } | null;
    };
    const tagihanRows: BatchTagihanRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let tagihanQuery = admin
        .from("tagihan")
.select("id, siswa_id, bulan, nominal, jatuh_tempo, jenis_pembayaran:jenis_id(departemen_id)")
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
        if (row.siswa_id && (!selectedClassStudentIds || selectedClassStudentIds.has(row.siswa_id))) {
          tagihanRows.push(row as BatchTagihanRow);
        }
      }
      if (!page || page.length < pageSize) break;
    }
    if (!tagihanRows.length) return { rows: [], per_tanggal: perTanggal };

    // Ambil identitas siswa dari tagihan yang benar-benar ada. Hindari
    // menganggap calon yang belum lulus (atau mantan siswa) sebagai penunggak.
    const studentIds = [...new Set(tagihanRows.map(row => row.siswa_id).filter((id): id is string => Boolean(id)))];
    const siswaMeta = new Map<string, KelasSiswaRow>();
    const studentStates = new Map<string, string>();
    const passedStudents = new Set<string>();
    // Pendaftaran internal yang sudah diterima tetapi belum berpindah jenjang
    // masih mempunyai kelas lama; untuk tagihan jenjang tujuan kelasnya kosong.
    const pendingInternalTarget = new Map<string, string>();
    for (let offset = 0; offset < studentIds.length; offset += 100) {
      const ids = studentIds.slice(offset, offset + 100);
      const [studentResult, classResult, detailResult] = await Promise.all([
        admin.from("siswa").select("id,nama,nis,status").in("id", ids),
        admin.from("kelas_siswa")
          .select("siswa_id,kelas:kelas_id(nama,departemen_id)")
          .eq("aktif", true).in("siswa_id", ids),
        (admin as any).from("siswa_detail")
          .select("siswa_id,spmb_siswa_internal,spmb_status_pendaftaran,spmb_tanggal_aktivasi,spmb_departemen_tujuan_id").in("siswa_id", ids)
          .eq("spmb_status_kelulusan", "lulus")
          .not("spmb_gelombang_id", "is", null),
      ]);
      if (studentResult.error) throw new Error("Gagal mengambil identitas siswa: " + studentResult.error.message);
      if (classResult.error) throw new Error("Gagal mengambil penempatan siswa: " + classResult.error.message);
      if (detailResult.error) throw new Error("Gagal memeriksa kelulusan SPMB: " + detailResult.error.message);
      for (const row of studentResult.data || []) {
        studentStates.set(row.id, row.status);
        siswaMeta.set(row.id, { siswa_id: row.id, siswa: row, kelas: null });
      }
      for (const row of detailResult.data || []) {
        if (!row.siswa_id) continue;
        passedStudents.add(row.siswa_id);
        if (row.spmb_siswa_internal === true &&
          row.spmb_status_pendaftaran === "diterima" &&
          !row.spmb_tanggal_aktivasi && row.spmb_departemen_tujuan_id) {
          pendingInternalTarget.set(row.siswa_id, row.spmb_departemen_tujuan_id);
        }
      }
      for (const row of classResult.data || []) {
        const meta = siswaMeta.get(row.siswa_id);
        if (meta && !meta.kelas) meta.kelas = row.kelas as KelasSiswaRow["kelas"];
      }
    }
    const siswaIdSet = new Set(studentIds.filter(id =>
      studentStates.get(id) === "aktif" ||
      (["calon", "diterima"].includes(String(studentStates.get(id))) && passedStudents.has(id)) ||
      (["keluar", "alumni", "pindah"].includes(String(studentStates.get(id))) && Boolean(siswaMeta.get(id)?.kelas))
    ));
    if (!siswaIdSet.size) return { rows: [], per_tanggal: perTanggal };

    // Pembayaran yang sudah terhubung ke tagihan harus dihitung dari ID
    // tagihan, walaupun uang diterima pada Tahun Buku yang berbeda.
    // Pembayaran legacy tanpa tagihan_id tetap memakai fallback tahun buku.
    type BatchPaymentRow = {
      tagihan_id: string | null;
      siswa_id: string | null;
      bulan: number | null;
      jumlah: number | string | null;
    };
    const payments: BatchPaymentRow[] = [];
    const billIds = tagihanRows.map(row => row.id);
    // Batas sekitar 180 UUID menjaga panjang URL PostgREST sekaligus
    // mengurangi jumlah subrequest Cloudflare Workers untuk SPP massal.
    for (let offset = 0; offset < billIds.length; offset += 180) {
      const billChunk = billIds.slice(offset, offset + 180);
      for (let from = 0; ; from += pageSize) {
        const { data: page, error: pErr } = await admin
          .from("pembayaran")
          .select("tagihan_id, siswa_id, bulan, jumlah")
          .in("tagihan_id", billChunk)
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (pErr) throw new Error("Gagal membaca pembayaran tagihan: " + pErr.message);
        payments.push(...((page || []) as BatchPaymentRow[]));
        if (!page || page.length < pageSize) break;
      }
    }
    // Kompatibilitas pembayaran lama yang tidak memiliki relasi tagihan.
    for (let from = 0; ; from += pageSize) {
      const { data: page, error: pErr } = await admin
        .from("pembayaran")
        .select("tagihan_id, siswa_id, bulan, jumlah")
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahun_ajaran_id)
        .is("tagihan_id", null)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (pErr) throw new Error("Gagal membaca pembayaran legacy: " + pErr.message);
      for (const row of page || []) {
        if (row.siswa_id && siswaIdSet.has(row.siswa_id)) payments.push(row as BatchPaymentRow);
      }
      if (!page || page.length < pageSize) break;
    }

    const kunci = (siswaId: string, bulan: number | null) => `${siswaId}|${bulan ?? "x"}`;
    const terbayarMap = new Map<string, number>();
    const terbayarPerTagihan = new Map<string, number>();
    for (const p of payments) {
      if (p.tagihan_id) {
        terbayarPerTagihan.set(p.tagihan_id, (terbayarPerTagihan.get(p.tagihan_id) || 0) + (Number(p.jumlah) || 0));
      } else {
        const k = kunci(p.siswa_id!, p.bulan);
        terbayarMap.set(k, (terbayarMap.get(k) || 0) + (Number(p.jumlah) || 0));
      }
    }

    // Satu baris hasil = satu tagihan/periode. Jangan gabungkan beberapa bulan
    // milik siswa menjadi satu total karena kasir harus bisa memilih tunggakan
    // tertentu (mis. November saja tanpa otomatis ikut Desember).
    const rows: TunggakanSiswaRow[] = [];
    for (const t of tagihanRows) {
      const nominal = Number(t.nominal) || 0;
      const k = kunci(t.siswa_id!, t.bulan);
      const terbayar = Math.min(Math.max(0, (terbayarPerTagihan.get(t.id) || 0) + (terbayarMap.get(k) || 0)), nominal);
      const sisa = nominal - terbayar;
      if (sisa <= 0) continue;
      if (!sudahMenunggak(t.jatuh_tempo, perTanggal)) continue; // belum jatuh tempo -> bukan tunggakan

      const ks = siswaMeta.get(t.siswa_id!);
      if (!ks || !siswaIdSet.has(t.siswa_id!)) continue;
      const pendingTargetDept = pendingInternalTarget.get(t.siswa_id!);
      const awaitingTargetClass = !!pendingTargetDept &&
        pendingTargetDept === t.jenis_pembayaran?.departemen_id;
      if (kelas_id && awaitingTargetClass) continue;
      if (tanpa_kelas && ks.kelas && !awaitingTargetClass) continue;

      rows.push({
        siswa_id: t.siswa_id!,
        nis: ks.siswa?.nis ?? null,
        nama: ks.siswa?.nama ?? null,
        kelas: awaitingTargetClass ? "Belum ditempatkan" : (ks.kelas?.nama ?? "Belum ditempatkan"),
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