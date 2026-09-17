/**
 * Server functions: prosesPembayaran, batalkanPembayaran
 * Migrasi dari supabase/functions/proses-pembayaran & batalkan-pembayaran.
 *
 * Seluruh mutasi keuangan dibungkus RPC PostgreSQL (transaksi atomik):
 *   - proses_pembayaran_atomik
 *   - batalkan_pembayaran_atomik
 */
import { createServerFn } from "@tanstack/react-start";
import { resolvePaymentTariff } from "@/lib/paymentTariff";
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
}

export const prosesPembayaran = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((d: ProsesPembayaranInput) => d)
  .handler(async ({ data, context }): Promise<ProsesPembayaranResult> => {
    const admin = createAdminClient();
    const { userId } = requireContext(context);
    await requireRole(admin, userId, [
      "admin",
      "kepala_sekolah",
      "keuangan",
      "kasir",
    ]);

    const {
      siswa_id,
      jenis_id,
      bulan,
      tanggal_bayar,
      keterangan,
      departemen_id,
      tahun_ajaran_id,
      is_bayar_dimuka,
      tagihan_id,
    } = data;

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
    const periodeLocked = (periodeData || []).find((p) => p.ditutup === true);
    if (periodeLocked) {
      throw new Error(
        `Transaksi ditolak: periode "${periodeLocked.nama}" sudah ditutup buku`
      );
    }

    const { data: jenis, error: jenisErr } = await admin
      .from("jenis_pembayaran")
      .select(
        "id, nama, nominal, tipe, akun_pendapatan_id, akun_dimuka_id, perlu_dimuka"
      )
      .eq("id", jenis_id)
      .single();
    if (jenisErr || !jenis) throw new Error("Jenis pembayaran tidak ditemukan");
    const isSekali = jenis.tipe === "sekali";
    const bulanNormalized: number | null =
      isSekali || bulan === 0 ? null : bulan;

    const { data: siswaRow } = await admin
      .from("siswa")
      .select("nama")
      .eq("id", siswa_id)
      .maybeSingle();

    // Ambil tarif dari DB — JANGAN pakai nominal dari frontend
    const { data: kelasRow } = await admin
      .from("kelas_siswa")
      .select("kelas_id")
      .eq("siswa_id", siswa_id)
      .eq("aktif", true)
      .maybeSingle();

    const { data: tarifNominalRaw, error: tarifErr } = await admin.rpc(
      "get_tarif_siswa",
      {
        p_jenis_id: jenis_id,
        p_siswa_id: siswa_id,
        p_kelas_id: kelasRow?.kelas_id ?? null,
        p_tahun_ajaran_id: tahun_ajaran_id,
      }
    );
    if (tarifErr) throw new Error("Gagal mengambil tarif: " + tarifErr.message);

    // Tarif khusus tetap paling tinggi prioritasnya. Jika tidak ada, gunakan
    // nominal default jenis pembayaran (mis. biaya pendaftaran SPMB).
    // Nilai dari frontend sengaja tidak dipakai sebagai sumber nominal.
    const jumlahValid = resolvePaymentTariff(
      tarifNominalRaw,
      jenis.nominal
    );
    if (jumlahValid <= 0) {
      throw new Error("Tarif pembayaran belum dikonfigurasi untuk siswa ini");
    }

    // Cek duplikasi
    if (isSekali) {
      const { data: existingPay } = await admin
        .from("pembayaran")
        .select("jumlah")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("tahun_ajaran_id", tahun_ajaran_id);
      const totalSudahBayar = (existingPay || []).reduce(
        (s, r) => s + Number(r.jumlah || 0),
        0
      );
      if (totalSudahBayar >= jumlahValid) {
        throw new Error("Pembayaran ini sudah lunas");
      }
    } else {
      const { data: dupCheck } = await admin
        .from("pembayaran")
        .select("id")
        .eq("siswa_id", siswa_id)
        .eq("jenis_id", jenis_id)
        .eq("bulan", bulanNormalized)
        .eq("tahun_ajaran_id", tahun_ajaran_id)
        .maybeSingle();
      if (dupCheck)
        throw new Error(`Pembayaran bulan ${bulan} untuk jenis ini sudah ada`);
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
    let tagihanQuery = admin
      .from("tagihan")
      .select("id, status")
      .eq("siswa_id", siswa_id)
      .eq("jenis_id", jenis_id)
      .eq("tahun_ajaran_id", tahun_ajaran_id)
      .in("status", ["belum_bayar", "terjadwal"]);
    tagihanQuery =
      bulanNormalized == null
        ? tagihanQuery.is("bulan", null)
        : tagihanQuery.eq("bulan", bulanNormalized);
    if (tagihan_id) tagihanQuery = tagihanQuery.eq("id", tagihan_id);

    const { data: tagihanRows } = await tagihanQuery.limit(1);
    const tagihanFound = tagihanRows?.[0];
    const belumJatuhTempo = tagihanFound?.status === "terjadwal";
    const tagihanSudahDiakuiPiutang = tagihanFound?.status === "belum_bayar";
    const pakaiDimuka =
      jenis.perlu_dimuka !== false && (is_bayar_dimuka || belumJatuhTempo);
    // Tagihan efektif = yang dikirim caller, atau yang ditemukan lewat
    // siswa+jenis+bulan+tahun_ajaran di atas (mis. pembayaran massal tunggakan
    // yang tidak mengirim tagihan_id sama sekali). Tanpa fallback ini,
    // piutang yang sudah dibukukan saat jatuh tempo tidak pernah dilunasi di
    // jurnal -- kredit jatuh ke Pendapatan lagi (dobel).
    const tagihanEfektifId = tagihan_id ?? tagihanFound?.id ?? null;

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
        p_departemen_id: departemen_id ?? null,
        p_tahun_ajaran_id: tahun_ajaran_id,
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
    };
    return {
      success: true,
      pembayaran_id: r.pembayaran_id,
      jurnal_id: r.jurnal_id,
      nomor_jurnal: r.nomor_jurnal,
      jumlah: jumlahValid,
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
      // BUKAN kasir — hanya admin/kepala/keuangan
      await requireRole(admin, userId, [
        "admin",
        "kepala_sekolah",
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
