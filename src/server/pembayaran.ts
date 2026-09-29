/**
 * Server functions: prosesPembayaran, batalkanPembayaran
 * Migrasi dari supabase/functions/proses-pembayaran & batalkan-pembayaran.
 *
 * Seluruh mutasi keuangan dibungkus RPC PostgreSQL (transaksi atomik):
 *   - proses_pembayaran_atomik
 *   - batalkan_pembayaran_atomik
 */
import { createServerFn } from "@tanstack/react-start";
import { resolvePaymentBookYear } from "@/lib/paymentBookYear";
import { resolvePaymentAmount } from "@/lib/paymentTariff";
import { calculateRemainingBill, resolveInstallmentAmount } from "@/lib/installment";
import { authMiddleware, requireContext, requireRole } from "./auth";
import { createAdminClient } from "./supabase";

export interface ProsesPembayaranInput {
  siswa_id: string;
  jenis_id: string;
  bulan: number; // 0 = sekali bayar, 1-12 = bulanan
  jumlah: number; // nominal dari frontend (divalidasi ulang dari DB)
  tanggal_bayar: string; // "yyyy-MM-dd"
  keterangan?: string;
  departemen_id?: string;
  tahun_ajaran_id: string;
  is_bayar_dimuka: boolean;
  tagihan_id?: string;
}

export interface ProsesPembayaranResult {
  success: true;
  pembayaran_id: string;
  jurnal_id: string;
  nomor_jurnal: string;
  jumlah: number;
  petugas_nama: string | null;
  status_tagihan: string | null;
  sisa_tagihan: number | null;
}

export interface LegacyOutstandingBreakdownRow {
  kode_lama: string | null;
  nama_lama: string;
  nominal: number;
  breakdown_total: number;
  current_total: number;
  exact_match: boolean;
}

export interface CariSiswaPembayaranInput {
  search: string;
  status?: "aktif" | "calon";
  departemen_id?: string;
  limit?: number;
}

export interface SiswaPembayaranRingkas {
  id: string;
  nis: string | null;
  nisn: string | null;
  nama: string;
  foto_url: string | null;
  status: string | null;
  angkatan_id: string | null;
  departemen_id: string | null;
  kelas_siswa: Array<{
    kelas_id: string;
    aktif: boolean | null;
    kelas: {
      id: string;
      nama: string;
      departemen_id: string | null;
    } | null;
  }>;
}

/**
 * Pencarian siswa khusus loket pembayaran.
 *
 * Dibaca melalui service role di server, tetapi hanya bisa dipanggil role
 * admin/keuangan/kasir dan hanya mengembalikan field minimum yang diperlukan
 * form pembayaran. Ini menghindari pemberian SELECT penuh tabel siswa kepada
 * kasir hanya agar autocomplete bekerja.
 */
export const cariSiswaPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: CariSiswaPembayaranInput) => d)
  .handler(async ({ data, context }): Promise<{ items: SiswaPembayaranRingkas[] }> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan", "kasir"]);

    const search = String(data?.search ?? "").trim().replace(/\s+/g, " ");
    if (search.length < 2) return { items: [] };

    const status = data?.status === "calon" ? "calon" : "aktif";
    const limit = Math.min(Math.max(Number(data?.limit ?? 10), 1), 20);
    const select =
      "id, nis, nisn, nama, foto_url, status, angkatan_id, departemen_id, kelas_siswa(kelas_id, aktif, kelas:kelas_id(id, nama, departemen_id))";

    // Untuk siswa aktif, token kelas di akhir pencarian boleh digabung dengan
    // nama/NIS, misalnya "Shofiyya 2C" atau "2538144422 5C". Token kelas
    // dipisahkan dari pencarian nama/NIS lalu divalidasi terhadap kelas aktif.
    const parts = search.split(" ");
    const lastPart = parts.at(-1) ?? "";
    const isClassToken = /^(?:(?:[1-9]|1[0-2])[a-z]?|(?:x|xi|xii)[a-z]?)$/i.test(lastPart);
    const kelasSearch = status === "aktif" && parts.length > 1 && isClassToken ? lastPart : null;
    const identitySearch = kelasSearch ? parts.slice(0, -1).join(" ").trim() : search;
    if (identitySearch.length < 2) return { items: [] };

    const buildQuery = (field: "nama" | "nis") => {
      let q = admin
        .from("siswa")
        .select(select)
        .eq("status", status)
        .ilike(field, "%" + identitySearch + "%")
        // Ambil kandidat lebih banyak sebelum filter kelas diterapkan, agar
        // nama yang sama di beberapa kelas tidak terpotong terlalu dini.
        .limit(kelasSearch ? 100 : limit);
      if (data?.departemen_id) q = q.eq("departemen_id", data.departemen_id);
      return q;
    };

    const [byNama, byNis] = await Promise.all([
      buildQuery("nama"),
      buildQuery("nis"),
    ]);

    if (byNama.error) throw new Error("Gagal mencari siswa: " + byNama.error.message);
    if (byNis.error) throw new Error("Gagal mencari siswa: " + byNis.error.message);

    const unik = new Map<string, SiswaPembayaranRingkas>();
    for (const row of [...(byNama.data ?? []), ...(byNis.data ?? [])] as any[]) {
      unik.set(row.id, {
        id: row.id,
        nis: row.nis?.trim() || null,
        nisn: row.nisn?.trim() || null,
        nama: row.nama?.trim() || "—",
        foto_url: row.foto_url ?? null,
        status: row.status ?? null,
        angkatan_id: row.angkatan_id ?? null,
        departemen_id: row.departemen_id ?? null,
        kelas_siswa: Array.isArray(row.kelas_siswa) ? row.kelas_siswa : [],
      });
    }

    const normalizeKelas = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const kelasNeedle = kelasSearch ? normalizeKelas(kelasSearch) : null;

    return {
      items: Array.from(unik.values())
        .filter((siswa) => {
          if (!kelasNeedle) return true;
          return siswa.kelas_siswa.some((ks) => {
            if (!ks.aktif || !ks.kelas?.nama) return false;
            return normalizeKelas(ks.kelas.nama).includes(kelasNeedle);
          });
        })
        .sort((a, b) => a.nama.localeCompare(b.nama, "id-ID"))
        .slice(0, limit),
    };
  });

export interface RekapKasirSayaInput {
  tanggal: string;
}

export interface RekapKasirSayaRow {
  id: string;
  jumlah: number;
  tanggal_bayar: string | null;
  bulan: number | null;
  keterangan: string | null;
  siswa_id: string | null;
  siswa_nama: string;
  siswa_nis: string | null;
  siswa_nisn: string | null;
  siswa_status: string | null;
  kelas_nama: string | null;
  jenis_nama: string;
  departemen_nama: string;
  departemen_kode: string | null;
  jurnal_nomor: string | null;
}

export interface RekapKasirSayaResult {
  petugas_nama: string | null;
  items: RekapKasirSayaRow[];
  jumlah_transaksi: number;
  total_penerimaan: number;
  transaksi_spmb: number;
  transaksi_siswa: number;
}

/**
 * Rekap transaksi loket milik petugas yang sedang login.
 *
 * Kasir sengaja tidak mendapat akses Rekap Harian yayasan. Query ini selalu
 * dibatasi ke pegawai yang terhubung ke akun login, sehingga "Rekap Kasir
 * Saya" tidak dapat dipakai untuk membaca transaksi petugas lain.
 */
export const getRekapKasirSaya = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: RekapKasirSayaInput) => d)
  .handler(async ({ data, context }): Promise<RekapKasirSayaResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan", "kasir"]);

    const tanggal = String(data?.tanggal ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
      throw new Error("Tanggal rekap tidak valid");
    }

    const { data: profile, error: profileError } = await admin
      .from("users_profile")
      .select("pegawai_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      throw new Error("Gagal membaca profil petugas: " + profileError.message);
    }
    if (!profile?.pegawai_id) {
      throw new Error(
        "Akun ini belum terhubung ke data pegawai. Hubungkan akun ke pegawai terlebih dahulu agar Rekap Kasir Saya dapat digunakan."
      );
    }

    const { data: pegawai } = await admin
      .from("pegawai")
      .select("nama")
      .eq("id", profile.pegawai_id)
      .maybeSingle();

    const { data: rows, error } = await admin
      .from("pembayaran")
      .select(
        "id, jumlah, tanggal_bayar, bulan, keterangan, siswa_id, jenis_pembayaran:jenis_id(nama), siswa:siswa_id(nama, nis, nisn, status, kelas_siswa(aktif, kelas:kelas_id(nama))), departemen:departemen_id(kode, nama), jurnal:jurnal_id(nomor)"
      )
      .eq("tanggal_bayar", tanggal)
      // Pembayaran loket saat ini menyimpan auth user id sebagai petugas_id.
      // Data historis/legacy dapat menyimpan pegawai_id, jadi terima keduanya
      // agar Rekap Kasir Saya tetap terbatas pada identitas petugas yang sama.
      .in("petugas_id", [userId, profile.pegawai_id]);

    if (error) {
      throw new Error("Gagal mengambil rekap kasir: " + error.message);
    }

    const items: RekapKasirSayaRow[] = ((rows ?? []) as any[]).map((row) => {
      const kelasAktif = Array.isArray(row.siswa?.kelas_siswa)
        ? row.siswa.kelas_siswa.find((ks: any) => ks?.aktif) ?? row.siswa.kelas_siswa[0]
        : null;
      return {
        id: row.id,
        jumlah: Number(row.jumlah ?? 0),
        tanggal_bayar: row.tanggal_bayar ?? null,
        bulan: row.bulan ?? null,
        keterangan: row.keterangan ?? null,
        siswa_id: row.siswa_id ?? null,
        siswa_nama: row.siswa?.nama?.trim() || "—",
        siswa_nis: row.siswa?.nis?.trim() || null,
        siswa_nisn: row.siswa?.nisn?.trim() || null,
        siswa_status: row.siswa?.status ?? null,
        kelas_nama: kelasAktif?.kelas?.nama ?? null,
        jenis_nama: row.jenis_pembayaran?.nama ?? "—",
        departemen_nama: row.departemen?.nama ?? "—",
        departemen_kode: row.departemen?.kode ?? null,
        jurnal_nomor: row.jurnal?.nomor ?? null,
      };
    });

    const totalPenerimaan = items.reduce((sum, item) => sum + item.jumlah, 0);
    const transaksiSpmb = items.filter((item) => item.siswa_status === "calon").length;

    return {
      petugas_nama: pegawai?.nama?.trim() || null,
      items,
      jumlah_transaksi: items.length,
      total_penerimaan: totalPenerimaan,
      transaksi_spmb: transaksiSpmb,
      transaksi_siswa: items.length - transaksiSpmb,
    };
  });

export const getLegacyOutstandingBreakdown = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: { siswa_id: string }) => d)
  .handler(async ({ data, context }): Promise<LegacyOutstandingBreakdownRow[]> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, ["admin", "keuangan", "kasir"]);

    if (!data.siswa_id) return [];

    const { data: rows, error } = await (admin as any).rpc(
      "get_legacy_outstanding_breakdown",
      { p_siswa_id: data.siswa_id }
    );
    if (error) {
      throw new Error("Gagal mengambil rincian tagihan legacy: " + error.message);
    }

    return (rows ?? []).map((row: any) => ({
      kode_lama: row.kode_lama ?? null,
      nama_lama: String(row.nama_lama ?? ""),
      nominal: Number(row.nominal ?? 0),
      breakdown_total: Number(row.breakdown_total ?? 0),
      current_total: Number(row.current_total ?? 0),
      exact_match: Boolean(row.exact_match),
    }));
  });

export const prosesPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: ProsesPembayaranInput) => d)
  .handler(async ({ data, context }): Promise<ProsesPembayaranResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    const role = await requireRole(admin, userId, [
      "admin",
      "keuangan",
      "kasir",
    ]);

    const {
      siswa_id,
      jenis_id,
      bulan,
      tanggal_bayar: requestedTanggalBayar,
      keterangan,
      departemen_id,
      tahun_ajaran_id,
      is_bayar_dimuka,
      tagihan_id,
    } = data;

    // Kasir tidak boleh mengubah tanggal transaksi. Server menjadi sumber
    // kebenaran agar pembatasan tidak dapat dilewati dengan request manual.
    // Admin/keuangan tetap boleh menginput transaksi historis/koreksi.
    const tanggal_bayar =
      role === "kasir"
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date())
        : requestedTanggalBayar;

    if (!siswa_id || !jenis_id || !tanggal_bayar || !tahun_ajaran_id) {
      throw new Error(
        "Field wajib tidak lengkap: siswa_id, jenis_id, tanggal_bayar, tahun_ajaran_id"
      );
    }

    const { data: periodeData } = await admin
      .from("tahun_buku")
      .select("id, nama, ditutup")
      .lte("tanggal_mulai", tanggal_bayar)
      .gte("tanggal_selesai", tanggal_bayar)
      .limit(1);
    const periodeBuku = periodeData?.[0] ?? null;
    const periodeLocked = (periodeData || []).find((p) => p.ditutup === true);
    if (periodeLocked) {
      throw new Error(
        `Transaksi ditolak: periode "${periodeLocked.nama}" sudah ditutup buku`
      );
    }

    const { data: jenis, error: jenisErr } = await admin
      .from("jenis_pembayaran")
      .select(
        "id, nama, nominal, tipe, departemen_id, akun_pendapatan_id, akun_dimuka_id, perlu_dimuka"
      )
      .eq("id", jenis_id)
      .single();
    if (jenisErr || !jenis) throw new Error("Jenis pembayaran tidak ditemukan");
    const isSekali = jenis.tipe === "sekali";
    const bulanNormalized: number | null =
      isSekali || bulan === 0 ? null : bulan;

    const tahunAjaranEfektifId = resolvePaymentBookYear({
      requestedBookYearId: tahun_ajaran_id,
      paymentDateBookYearId: periodeBuku?.id ?? null,
    });

    // `pembayaran.tahun_ajaran_id` menunjuk Tahun Buku saat uang diterima,
    // sedangkan tagihan yang dipilih bisa berasal dari Tahun Buku sebelumnya.
    // Ambil tagihan berdasarkan ID terlebih dahulu agar tarif dan akun piutang
    // tetap memakai periode asal tagihan.
    let tagihanTerpilih: {
      id: string;
      status: string | null;
      tahun_ajaran_id: string | null;
      siswa_id: string;
      jenis_id: string;
      bulan: number | null;
      nominal: number;
    } | null = null;
    if (tagihan_id) {
      const { data: tagihanData, error: tagihanError } = await admin
        .from("tagihan")
        .select("id, status, tahun_ajaran_id, siswa_id, jenis_id, bulan, nominal")
        .eq("id", tagihan_id)
        .maybeSingle();
      if (tagihanError) throw new Error("Gagal mengambil tagihan: " + tagihanError.message);
      if (!tagihanData) throw new Error("Tagihan tidak ditemukan");
      if (
        tagihanData.siswa_id !== siswa_id ||
        tagihanData.jenis_id !== jenis_id ||
        tagihanData.bulan !== bulanNormalized
      ) {
        throw new Error("Tagihan tidak sesuai dengan siswa, jenis, atau bulan pembayaran");
      }
      if (!["belum_bayar", "sebagian", "terjadwal"].includes(tagihanData.status ?? "")) {
        throw new Error("Tagihan ini sudah lunas atau tidak dapat dibayar");
      }
      tagihanTerpilih = tagihanData;
    }
    // Untuk pembayaran sekali bayar, tagihan existing harus menjadi sumber utama
    // walaupun caller tidak mengirim tagihan_id. Ini mencegah saldo migrasi
    // parsial dibayar kembali memakai tarif bruto/asli.
    if (!tagihanTerpilih && isSekali) {
      const { data: openOnceRows, error: openOnceError } = await admin
        .from("tagihan")
        .select("id, status, tahun_ajaran_id, siswa_id, jenis_id, bulan, nominal")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahun_ajaran_id)
        .is("bulan", null)
        .in("status", ["belum_bayar", "sebagian", "terjadwal"])
        .limit(1);
      if (openOnceError) {
        throw new Error("Gagal mengambil tagihan sekali bayar: " + openOnceError.message);
      }
      tagihanTerpilih = openOnceRows?.[0] ?? null;

      if (!tagihanTerpilih) {
        const { data: settledOnceRows, error: settledOnceError } = await admin
          .from("tagihan")
          .select("id")
          .eq("siswa_id", siswa_id)
          .eq("jenis_id", jenis_id)
          .eq("tahun_ajaran_id", tahun_ajaran_id)
          .is("bulan", null)
          .eq("status", "lunas")
          .limit(1);
        if (settledOnceError) {
          throw new Error("Gagal memeriksa tagihan sekali bayar yang sudah lunas: " + settledOnceError.message);
        }
        if ((settledOnceRows ?? []).length > 0) {
          throw new Error("Pembayaran ini sudah lunas");
        }
      }
    }

    const tahunBukuTagihanId =
      tagihanTerpilih?.tahun_ajaran_id || tahunAjaranEfektifId;

    const { data: siswaRow } = await admin
      .from("siswa")
      .select("nama")
      .eq("id", siswa_id)
      .maybeSingle();

    // Tagihan netto Rp0 yang sudah berstatus lunas berarti kewajibannya
    // diselesaikan lewat potongan/promo, bukan lewat kas masuk. Blokir jalur
    // pembayaran generik supaya tidak pernah menagih ulang beasiswa/promo 100%.
    const { data: settledByDiscount, error: settledByDiscountError } = await admin
      .from("tagihan")
      .select("id")
      .eq("siswa_id", siswa_id)
      .eq("jenis_id", jenis_id)
      .eq("tahun_ajaran_id", tahunBukuTagihanId)
      .eq("status", "lunas")
      .eq("nominal", 0)
      .gt("nominal_diskon", 0)
      .limit(1)
      .maybeSingle();
    if (settledByDiscountError) {
      throw new Error(
        "Gagal memeriksa penyelesaian tagihan: " + settledByDiscountError.message
      );
    }
    if (settledByDiscount) {
      throw new Error(
        "Tagihan ini sudah diselesaikan melalui potongan/promo 100%. Tidak perlu membuat pembayaran."
      );
    }

    // Ambil tarif dari DB — JANGAN pakai nominal dari frontend
    const { data: kelasRow } = await admin
      .from("kelas_siswa")
      .select("kelas_id")
      .eq("siswa_id", siswa_id)
      .eq("aktif", true)
      .maybeSingle();

    let tarifNominalRaw: number | null = null;
    if (!tagihanTerpilih) {
      const { data, error } = await admin.rpc("get_tarif_siswa", {
        p_jenis_id: jenis_id,
        p_siswa_id: siswa_id,
        p_kelas_id: kelasRow?.kelas_id ?? null,
        p_tahun_ajaran_id: tahunBukuTagihanId,
      });
      if (error) throw new Error("Gagal mengambil tarif: " + error.message);
      tarifNominalRaw = data;
    }

    // Tagihan sekali bayar (mis. Uang Pangkal) yang sudah jatuh tempo
    // boleh dicicil bebas. Setiap pembayaran ditautkan ke tagihan exact, jadi
    // sisa tidak lagi ditebak dari tahun buku pembayaran.
    let jumlahValid: number;
    if (tagihanTerpilih) {
      const { data: pembayaranTagihan, error: pembayaranTagihanError } = await admin
        .from("pembayaran")
        .select("jumlah")
        .eq("tagihan_id", tagihanTerpilih.id);
      if (pembayaranTagihanError) {
        throw new Error("Gagal menghitung cicilan tagihan: " + pembayaranTagihanError.message);
      }
      const totalSudahBayar = (pembayaranTagihan || []).reduce(
        (sum, row) => sum + Number(row.jumlah || 0),
        0
      );
      const { remaining } = calculateRemainingBill(tagihanTerpilih.nominal, totalSudahBayar);
      const allowPartial = isSekali && tagihanTerpilih.status !== "terjadwal";
      jumlahValid = resolveInstallmentAmount({
        requestedAmount: data.jumlah,
        remainingAmount: remaining,
        allowPartial,
      });
    } else {
      jumlahValid = resolvePaymentAmount(undefined, tarifNominalRaw, jenis.nominal);
      if (!Number.isFinite(jumlahValid) || jumlahValid <= 0) {
        throw new Error("Tarif pembayaran belum dikonfigurasi untuk siswa ini");
      }
    }

    // Cek duplikasi. Pembayaran sekali bayar dengan tagihan exact sengaja
    // boleh memiliki banyak baris pembayaran (cicilan).
    if (isSekali && !tagihanTerpilih) {
      const { data: existingPay } = await admin
        .from("pembayaran")
        .select("jumlah")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahunBukuTagihanId);
      const totalSudahBayar = (existingPay || []).reduce(
        (sum, row) => sum + Number(row.jumlah || 0),
        0
      );
      if (totalSudahBayar >= jumlahValid) {
        throw new Error("Pembayaran ini sudah lunas");
      }
    } else if (!isSekali) {
      const { data: dupCheck } = await admin
        .from("pembayaran")
        .select("id")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("bulan", bulanNormalized)
        .eq("tahun_ajaran_id", tahunBukuTagihanId)
        .maybeSingle();
      if (dupCheck)
        throw new Error(`Pembayaran bulan ${bulan} untuk jenis ini sudah ada`);

      // Pembayaran tunggakan periode lama dicatat pada tahun buku kas saat
      // uang diterima, sehingga baris pembayaran bisa berada di tahun yang
      // berbeda dari tahun tagihan. Status tagihan lunas tetap harus memblokir
      // percobaan pembayaran ulang walaupun payment-year berbeda.
      const { data: settledCharge, error: settledChargeError } = await admin
        .from("tagihan")
        .select("id")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahunBukuTagihanId)
        .eq("bulan", bulanNormalized)
        .eq("status", "lunas")
        .limit(1)
        .maybeSingle();
      if (settledChargeError) {
        throw new Error("Gagal memeriksa status tagihan bulanan: " + settledChargeError.message);
      }
      if (settledCharge) throw new Error("Pembayaran bulan ini sudah lunas");
    }

    // Konfigurasi akun
    const { data: pengaturanList } = await admin
      .from("pengaturan_akun")
      .select("kode_setting, akun_id")
      .in("kode_setting", [
        "kas_tunai",
        "piutang_siswa",
        "AKUN_PENDAPATAN_DIMUKA",
      ]);

    const getAkun = (kode: string) =>
      pengaturanList?.find((p) => p.kode_setting === kode)?.akun_id ?? null;

    const kasAkunId = getAkun("kas_tunai");
    const piutangAkunId = getAkun("piutang_siswa");
    const dimukaAkunId = getAkun("AKUN_PENDAPATAN_DIMUKA");

    if (!kasAkunId)
      throw new Error("Akun Kas Tunai belum dikonfigurasi di Pengaturan Akun");

    // Tagihan 'terjadwal' belum pernah dibukukan sebagai piutang. Untuk jenis
    // yang memang perlu pendapatan dimuka, pembayaran sebelum jatuh tempo masuk
    // liabilitas. Untuk jenis yang perlu_dimuka=false (mis. biaya pendaftaran),
    // pembayaran langsung diakui sebagai pendapatan dan tidak boleh mengkredit
    // Piutang yang belum pernah dibentuk.
    let tagihanFound = tagihanTerpilih;
    if (!tagihanFound) {
      let tagihanQuery = admin
        .from("tagihan")
        .select("id, status, tahun_ajaran_id, siswa_id, jenis_id, bulan, nominal")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahunAjaranEfektifId)
        .in("status", ["belum_bayar", "sebagian", "terjadwal"]);
      tagihanQuery =
        bulanNormalized == null
          ? tagihanQuery.is("bulan", null)
          : tagihanQuery.eq("bulan", bulanNormalized);
      const { data: tagihanRows } = await tagihanQuery.limit(1);
      tagihanFound = tagihanRows?.[0] ?? null;
    }
    const belumJatuhTempo = tagihanFound?.status === "terjadwal";
    const tagihanSudahDiakuiPiutang =
      tagihanFound?.status === "belum_bayar" || tagihanFound?.status === "sebagian";
    const pakaiDimuka =
      jenis.perlu_dimuka !== false && (is_bayar_dimuka || belumJatuhTempo);
    // Tagihan efektif = yang dikirim caller, atau yang ditemukan lewat
    // siswa+jenis+bulan+tahun_ajaran di atas (mis. pembayaran massal tunggakan
    // yang tidak mengirim tagihan_id sama sekali). Tanpa fallback ini,
    // piutang yang sudah dibukukan saat jatuh tempo tidak pernah dilunasi di
    // jurnal -- kredit jatuh ke Pendapatan lagi (dobel).
    const tagihanEfektifId = tagihanFound?.id ?? null;

    let kreditAkunId: string | null;
    let kreditLabel: string;

    if (pakaiDimuka) {
      const dimukaJenisAkunId = jenis.akun_dimuka_id ?? dimukaAkunId;
      if (!dimukaJenisAkunId)
        throw new Error(
          "Akun Pendapatan Diterima di Muka belum dikonfigurasi"
        );
      kreditAkunId = dimukaJenisAkunId;
      kreditLabel = `Pendapatan Diterima di Muka — ${jenis.nama}`;
    } else if (tagihanSudahDiakuiPiutang && piutangAkunId) {
      kreditAkunId = piutangAkunId;
      kreditLabel = "Piutang Siswa";
    } else {
      kreditAkunId = jenis.akun_pendapatan_id;
      kreditLabel = `Pendapatan ${jenis.nama}`;
    }
    if (!kreditAkunId) throw new Error("Akun kredit belum dikonfigurasi");

    // Identitas transaksi disamakan dengan jurnal pembentukan piutang (JPI):
    // "<jenis>-B<bulan> - <nama siswa>".
    const namaSiswa = siswaRow?.nama ?? "Siswa";
    const identitasTagihan = `${jenis.nama}${
      bulanNormalized != null ? `-B${bulanNormalized}` : ""
    } - ${namaSiswa}`;
    const autoKet = pakaiDimuka
      ? `Pembayaran Diterima di Muka ${identitasTagihan}`
      : tagihanSudahDiakuiPiutang && piutangAkunId
        ? `Pembayaran Piutang ${identitasTagihan}`
        : `Pembayaran ${identitasTagihan}`;
    const keteranganFinal = keterangan
      ? `${keterangan} | ${autoKet}`
      : autoKet;

    const { data: result, error: rpcErr } = await admin.rpc(
      "proses_pembayaran_atomik",
      {
        p_siswa_id: siswa_id,
        p_jenis_id: jenis_id,
        p_bulan: bulanNormalized,
        p_jumlah: jumlahValid,
        p_tanggal_bayar: tanggal_bayar,
        p_keterangan: keteranganFinal,
        p_departemen_id: jenis.departemen_id ?? departemen_id ?? null,
        p_tahun_ajaran_id: tahunAjaranEfektifId,
        p_is_bayar_dimuka: pakaiDimuka,
        p_tagihan_id: tagihanEfektifId,
        p_kas_akun_id: kasAkunId,
        p_kredit_akun_id: kreditAkunId,
        p_kredit_label: kreditLabel,
        p_prefix_jurnal: pakaiDimuka ? "JD" : "JP",
        p_petugas_id: userId,
        p_jenis_nama: jenis.nama,
      }
    );

    if (rpcErr)
      throw new Error("Gagal memproses pembayaran: " + rpcErr.message);

    const r = result as {
      pembayaran_id: string;
      jurnal_id: string;
      nomor_jurnal: string;
      status_tagihan?: string | null;
      sisa_tagihan?: number | null;
    };

    const { data: petugasProfile } = await admin
      .from("users_profile")
      .select("pegawai_id")
      .eq("id", userId)
      .maybeSingle();
    let petugasNama: string | null = null;
    if (petugasProfile?.pegawai_id) {
      const { data: pegawai } = await admin
        .from("pegawai")
        .select("nama")
        .eq("id", petugasProfile.pegawai_id)
        .maybeSingle();
      petugasNama = pegawai?.nama?.trim() || null;
    }

    return {
      success: true,
      pembayaran_id: r.pembayaran_id,
      jurnal_id: r.jurnal_id,
      nomor_jurnal: r.nomor_jurnal,
      jumlah: jumlahValid,
      petugas_nama: petugasNama,
      status_tagihan: r.status_tagihan ?? null,
      sisa_tagihan: r.sisa_tagihan == null ? null : Number(r.sisa_tagihan),
    };
  });

export interface BatalkanPembayaranInput {
  pembayaran_id: string;
  alasan: string;
  tanggal?: string; // "yyyy-MM-dd", default hari ini
}

export const batalkanPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: BatalkanPembayaranInput) => d)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ success: true; jurnal_pembalik_id: string | null }> => {
      const admin = createAdminClient();
      const { userId } = requireContext(context);
      // BUKAN kasir — hanya admin/keuangan
      await requireRole(admin, userId, [
        "admin",
        "keuangan",
      ]);

      const { pembayaran_id, alasan } = data;
      const tanggal = data.tanggal || new Date().toISOString().split("T")[0];

      if (!pembayaran_id) throw new Error("pembayaran_id wajib diisi");
      if (!alasan || !alasan.trim()) throw new Error("Alasan wajib diisi");

      const { data: periodeData } = await admin
        .from("tahun_buku")
        .select("nama, ditutup")
        .lte("tanggal_mulai", tanggal)
        .gte("tanggal_selesai", tanggal)
        .limit(1);
      const periodeLocked = (periodeData || []).find((p) => p.ditutup === true);
      if (periodeLocked) {
        throw new Error(
          `Transaksi ditolak: periode "${periodeLocked.nama}" sudah ditutup buku`
        );
      }

      const { data: result, error: rpcErr } = await admin.rpc(
        "batalkan_pembayaran_atomik",
        {
          p_pembayaran_id: pembayaran_id,
          p_alasan: alasan,
          p_tanggal: tanggal,
          p_user_id: userId,
        }
      );
      if (rpcErr)
        throw new Error("Gagal membatalkan pembayaran: " + rpcErr.message);

      const r = (result || {}) as { jurnal_pembalik_id?: string | null };
      return { success: true, jurnal_pembalik_id: r.jurnal_pembalik_id ?? null };
    }
  );