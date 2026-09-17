import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateTagihan, batalkanTagihan, batalkanTagihanBatch } from "@/server/tagihan";
import { toast } from "sonner";
import { logAuditKeuangan } from "./useJurnal";
import { checkPeriodeLocked, formatRupiah } from "./useKeuangan";

export function useTagihanList(filters?: {
  tahun_ajaran_id?: string;
  jenis_id?: string;
  status?: string;
  siswa_id?: string;
}) {
  return useQuery({
    queryKey: ["tagihan", filters],
    queryFn: async () => {
      let q = supabase
        .from("tagihan")
        .select("*, siswa:siswa_id(id, nama, nis), jenis:jenis_id(id, nama, tipe), tahun_ajaran:tahun_ajaran_id(id, nama), kelas:kelas_id(id, nama)")
        .order("created_at", { ascending: false })
        .limit(500);

      if (filters?.tahun_ajaran_id) q = q.eq("tahun_ajaran_id", filters.tahun_ajaran_id);
      if (filters?.jenis_id) q = q.eq("jenis_id", filters.jenis_id);
      if (filters?.status) q = q.eq("status", filters.status);
      if (filters?.siswa_id) q = q.eq("siswa_id", filters.siswa_id);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTagihanBySiswa(
  siswaId?: string,
  jenisId?: string,
  bulan?: number,
  tahunBukuId?: string,
) {
  return useQuery({
    queryKey: ["tagihan", "siswa", siswaId, jenisId, bulan, tahunBukuId],
    enabled: !!siswaId && !!jenisId,
    queryFn: async () => {
      let q = supabase
        .from("tagihan")
        .select("id, nominal, status, jurnal_piutang_id, tahun_ajaran_id")
        .eq("siswa_id", siswaId!)
        .eq("jenis_id", jenisId!)
        .eq("status", "belum_bayar");

      if (tahunBukuId) q = q.eq("tahun_ajaran_id", tahunBukuId);

      if (bulan != null) {
        q = q.eq("bulan", bulan);
      } else {
        q = q.is("bulan", null);
      }

      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });
}

export function useGenerateTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      tahun_ajaran_id: string;
      jenis_id: string;
      bulan?: number;
      bulan_list?: number[];
      departemen_id?: string;
      angkatan_id?: string; // generate langsung untuk satu angkatan (tahun masuk)
      siswa_id?: string;   // T1 fix: expose ke type — edge function sudah support ini
      kelas_id?: string;   // T1 fix: expose ke type — edge function sudah support ini
      siswa_ids?: string[]; // input tarif massal: generate untuk daftar siswa sekaligus
    }) => {
      return await generateTagihan({ data: params });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });

      const adaError = data.errors && data.errors.length > 0;

      if (data.generated === 0 && adaError) {
        // Tidak ada satupun tagihan berhasil dibuat -- ini kegagalan total,
        // BUKAN sukses dengan hasil 0. Tampilkan sebagai error, bukan toast
        // hijau yang menyesatkan (sebelumnya server function selalu
        // mengembalikan success:true meski semua bulan gagal, sehingga
        // user melihat "berhasil di-generate: 0 tagihan baru" seolah tidak
        // terjadi apa-apa, padahal generate benar-benar gagal total).
        toast.error(
          `Generate tagihan GAGAL total (0 tagihan dibuat). Penyebab: ${data.errors![0]}` +
          (data.errors!.length > 1 ? ` (+${data.errors!.length - 1} error lain, lihat console)` : "")
        );
        if (data.errors!.length > 1) console.error("generate_tagihan errors:", data.errors);
        return;
      }

      if (adaError) {
        // Sebagian berhasil, sebagian gagal -- tetap tampilkan sebagai
        // warning supaya user tahu ada bulan/siswa yang tidak ter-generate,
        // bukan toast sukses polos yang menyembunyikan kegagalan parsial.
        toast.warning(
          `Sebagian tagihan berhasil (${data.generated} baru, ${data.skipped} sudah ada), tapi ada ${data.errors!.length} error. Penyebab: ${data.errors![0]}` +
          (data.errors!.length > 1 ? ` (+${data.errors!.length - 1} lainnya, lihat console)` : "")
        );
        console.error("generate_tagihan errors:", data.errors);
        return;
      }

      // Tagihan periode mendatang sengaja belum dijurnal (status 'terjadwal') --
      // sebutkan eksplisit supaya petugas keuangan tidak bingung mencari jurnal
      // piutangnya yang memang belum ada.
      const infoTerjadwal =
        data.scheduled > 0
          ? `, ${data.scheduled} di antaranya belum jatuh tempo (dijadwalkan, jurnal piutang menyusul saat jatuh tempo)`
          : "";
      toast.success(
        `Tagihan berhasil di-generate: ${data.generated} tagihan baru, ${data.skipped} sudah ada${infoTerjadwal}`
      );
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ─── Koreksi / Pembatalan Tagihan ────────────────────────────────────────────
// Membuat jurnal pembalik (posted) dari sebuah jurnal asal, mengembalikan id-nya.
async function buatJurnalPembalik(jurnalAsalId: string, tanggal: string): Promise<string> {
  const { data: jurnalAsal, error: e1 } = await supabase
    .from("jurnal")
    .select("*")
    .eq("id", jurnalAsalId)
    .single();
  if (e1) throw e1;
  const ja = jurnalAsal as any;
  if (ja.status !== "posted")
    throw new Error("Jurnal piutang asal belum diposting; tidak bisa dibalik otomatis.");

  const { data: detailAsal, error: e2 } = await supabase
    .from("jurnal_detail")
    .select("*")
    .eq("jurnal_id", jurnalAsalId)
    .order("urutan");
  if (e2) throw e2;

  const tahun = new Date(tanggal).getFullYear();
  const { data: nomor, error: eN } = await supabase.rpc("generate_nomor_jurnal", {
    p_prefix: "JU",
    p_tahun: tahun,
  });
  if (eN) throw eN;

  const totalAsal = Number(ja.total_debit) || 0;
  const { data: pembalik, error: e3 } = await (supabase.from("jurnal").insert({
    nomor,
    tanggal,
    keterangan: `KOREKSI/BATAL: ${ja.keterangan}`,
    referensi: ja.nomor,
    departemen_id: ja.departemen_id,
    program_dana_id: ja.program_dana_id,
    total_debit: totalAsal,
    total_kredit: totalAsal,
    status: "posted",
    tipe: "pembalik",
    jurnal_asal_id: jurnalAsalId,
  } as any) as any).select("id").single();
  if (e3) throw e3;

  const detailPembalik = (detailAsal as any[]).map((d, i) => ({
    jurnal_id: (pembalik as any).id,
    akun_id: d.akun_id,
    debit: Number(d.kredit) || 0,
    kredit: Number(d.debit) || 0,
    keterangan: d.keterangan ? `[BALIK] ${d.keterangan}` : "[BALIK]",
    urutan: i + 1,
  }));
  const { error: e4 } = await supabase.from("jurnal_detail").insert(detailPembalik);
  if (e4) throw e4;

  return (pembalik as any).id;
}

// Membuat jurnal piutang baru (D Piutang / K Pendapatan) untuk koreksi nominal.
async function buatJurnalPiutang(params: {
  tanggal: string;
  nominal: number;
  keterangan: string;
  departemen_id: string | null;
  piutangAkunId: string;
  pendapatanAkunId: string;
}): Promise<string> {
  const tahun = new Date(params.tanggal).getFullYear();
  const { data: nomor, error: eN } = await supabase.rpc("generate_nomor_jurnal", {
    p_prefix: "JPI",
    p_tahun: tahun,
  });
  if (eN) throw eN;

  const { data: jurnal, error: eJ } = await (supabase.from("jurnal").insert({
    nomor,
    tanggal: params.tanggal,
    keterangan: params.keterangan,
    departemen_id: params.departemen_id,
    total_debit: params.nominal,
    total_kredit: params.nominal,
    status: "posted",
  } as any) as any).select("id").single();
  if (eJ) throw eJ;

  const { error: eD } = await supabase.from("jurnal_detail").insert([
    { jurnal_id: (jurnal as any).id, akun_id: params.piutangAkunId,    debit: params.nominal, kredit: 0,             keterangan: "Piutang (koreksi nominal)",    urutan: 1 },
    { jurnal_id: (jurnal as any).id, akun_id: params.pendapatanAkunId, debit: 0,             kredit: params.nominal, keterangan: "Pendapatan (koreksi nominal)", urutan: 2 },
  ]);
  if (eD) throw eD;

  return (jurnal as any).id;
}

/**
 * @deprecated Gunakan useBatalkanTagihan / useBatalkanTagihanBatch (di bawah),
 * yang membungkus proses ini dalam RPC atomik lewat server function. Hook ini
 * menjalankan beberapa request Supabase terpisah langsung dari browser tanpa
 * transaksi — jika koneksi klien terputus di tengah proses, bisa menyisakan
 * jurnal pembalik yang sudah tercatat tapi status tagihan belum ter-update.
 * Dipertahankan untuk referensi/rollback, tidak lagi dipanggil dari UI manapun.
 */
export function useKoreksiTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      mode: "batal" | "koreksi_nominal";
      tagihan_id: string;
      alasan: string;
      nominal_baru?: number; // wajib untuk koreksi_nominal
      tanggal?: string;      // default hari ini
    }) => {
      const tanggal = params.tanggal || new Date().toISOString().split("T")[0];
      if (!params.alasan?.trim()) throw new Error("Alasan wajib diisi.");

      const { data: tagihan, error: eT } = await supabase
        .from("tagihan")
        .select("*, jenis:jenis_id(id, nama, akun_pendapatan_id), siswa:siswa_id(departemen_id)")
        .eq("id", params.tagihan_id)
        .single();
      if (eT) throw eT;
      const t = tagihan as any;
      const deptId: string | null = t.siswa?.departemen_id ?? null;

      if (t.status !== "belum_bayar")
        throw new Error(
          "Hanya tagihan berstatus 'belum bayar' yang bisa dibatalkan/dikoreksi lewat menu ini. Tagihan yang sudah dibayar perlu proses refund."
        );

      let nominalBaru = 0;
      if (params.mode === "koreksi_nominal") {
        nominalBaru = Number(params.nominal_baru);
        if (!nominalBaru || nominalBaru <= 0) throw new Error("Nominal baru harus lebih dari 0.");
        if (nominalBaru === Number(t.nominal)) throw new Error("Nominal baru sama dengan nominal lama.");
      }

      await checkPeriodeLocked(tanggal, deptId);

      // Balik jurnal piutang lama bila ada
      let jurnalPembalikId: string | null = null;
      if (t.jurnal_piutang_id) {
        jurnalPembalikId = await buatJurnalPembalik(t.jurnal_piutang_id, tanggal);
      }

      const { data: { user } } = await supabase.auth.getUser();

      if (params.mode === "batal") {
        const { error: eU } = await (supabase.from("tagihan").update({
          status: "dibatalkan",
          dibatalkan_alasan: params.alasan,
          dibatalkan_at: new Date().toISOString(),
          dibatalkan_oleh: user?.id ?? null,
          jurnal_pembalik_id: jurnalPembalikId,
        } as any) as any).eq("id", t.id);
        if (eU) throw eU;

        await logAuditKeuangan({
          tabel_sumber: "tagihan",
          record_id: t.id,
          aksi: "UPDATE",
          data_lama: { status: t.status, nominal: t.nominal, jurnal_piutang_id: t.jurnal_piutang_id },
          data_baru: { status: "dibatalkan", alasan: params.alasan, jurnal_pembalik_id: jurnalPembalikId },
          keterangan: `Pembatalan tagihan ${t.jenis?.nama ?? ""} ${formatRupiah(Number(t.nominal))} — ${params.alasan}`,
          departemen_id: deptId,
        });
        return { mode: "batal" as const };
      }

      // koreksi_nominal: buat jurnal piutang baru senilai nominal benar
      const { data: peng } = await supabase
        .from("pengaturan_akun")
        .select("akun_id")
        .eq("kode_setting", "piutang_siswa")
        .maybeSingle();
      const piutangAkunId = (peng as any)?.akun_id as string | undefined;
      const pendapatanAkunId = t.jenis?.akun_pendapatan_id as string | undefined;

      let jurnalBaruId: string | null = null;
      if (jurnalPembalikId && piutangAkunId && pendapatanAkunId) {
        jurnalBaruId = await buatJurnalPiutang({
          tanggal,
          nominal: nominalBaru,
          keterangan: `Piutang ${t.jenis?.nama ?? ""} (koreksi) - siswa ${t.siswa_id}`,
          departemen_id: deptId,
          piutangAkunId,
          pendapatanAkunId,
        });
      }

      const { error: eU } = await (supabase.from("tagihan").update({
        nominal: nominalBaru,
        jurnal_piutang_id: jurnalBaruId ?? null,
      } as any) as any).eq("id", t.id);
      if (eU) throw eU;

      await logAuditKeuangan({
        tabel_sumber: "tagihan",
        record_id: t.id,
        aksi: "UPDATE",
        data_lama: { nominal: t.nominal, jurnal_piutang_id: t.jurnal_piutang_id },
        data_baru: { nominal: nominalBaru, jurnal_piutang_id: jurnalBaruId, alasan: params.alasan },
        keterangan: `Koreksi nominal tagihan ${t.jenis?.nama ?? ""}: ${formatRupiah(Number(t.nominal))} → ${formatRupiah(nominalBaru)} — ${params.alasan}`,
        departemen_id: deptId,
      });

      const warnNoJurnal = jurnalPembalikId && !jurnalBaruId;
      return { mode: "koreksi_nominal" as const, warnNoJurnal };
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["buku_besar"] });
      qc.invalidateQueries({ queryKey: ["tunggakan"] });
      qc.invalidateQueries({ queryKey: ["tagihan_belum_lunas_writeoff"] });
      if (res?.mode === "batal") {
        toast.success("Tagihan berhasil dibatalkan & jurnal piutang dibalik.");
      } else if (res?.warnNoJurnal) {
        toast.warning("Nominal dikoreksi, tapi jurnal piutang baru tidak dibuat — cek akun piutang siswa / akun pendapatan jenis.");
      } else {
        toast.success("Nominal tagihan berhasil dikoreksi & jurnal disesuaikan.");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateTagihanLunas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pembayaran_id }: { id: string; pembayaran_id: string }) => {
      const { error } = await supabase
        .from("tagihan")
        .update({ status: "lunas", pembayaran_id })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tagihan"] });
    },
  });
}

// ─── Koreksi / Pembatalan Tagihan — versi atomik via server function ────────
// Menggantikan useKoreksiTagihan (di atas), yang menjalankan beberapa request
// Supabase terpisah langsung dari browser tanpa transaksi. Kedua hook di bawah
// memanggil server function (src/server/tagihan.ts) yang membungkus seluruh
// proses dalam satu RPC atomik (batalkan_tagihan_atomik) di sisi database.

export interface BatalkanTagihanParams {
  tagihan_id: string;
  mode: "batal" | "koreksi_nominal";
  alasan: string;
  tanggal?: string;
  nominal_baru?: number;
}

export function useBatalkanTagihan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: BatalkanTagihanParams) => {
      return await batalkanTagihan({ data: params });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["tagihan_dibatalkan"] });
      qc.invalidateQueries({ queryKey: ["tagihan_belum_lunas_writeoff"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["buku_besar"] });
      qc.invalidateQueries({ queryKey: ["tunggakan"] });
      if (res.mode === "batal") {
        toast.success("Tagihan berhasil dibatalkan & jurnal piutang dibalik.");
      } else if (res.warn_no_jurnal) {
        toast.warning("Nominal dikoreksi, tapi jurnal piutang baru tidak dibuat — cek akun piutang siswa / akun pendapatan jenis.");
      } else {
        toast.success("Nominal tagihan berhasil dikoreksi & jurnal disesuaikan.");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export interface BatalkanTagihanBatchParams {
  tagihan_ids: string[];
  alasan: string;
  tanggal?: string;
}

export function useBatalkanTagihanBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: BatalkanTagihanBatchParams) => {
      return await batalkanTagihanBatch({ data: params });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tagihan"] });
      qc.invalidateQueries({ queryKey: ["tagihan_dibatalkan"] });
      qc.invalidateQueries({ queryKey: ["tagihan_belum_lunas_writeoff"] });
      qc.invalidateQueries({ queryKey: ["jurnal"] });
      qc.invalidateQueries({ queryKey: ["buku_besar"] });
      qc.invalidateQueries({ queryKey: ["tunggakan"] });
      if (res.gagal.length === 0) {
        toast.success(`${res.berhasil} tagihan berhasil dibatalkan.`);
      } else if (res.berhasil === 0) {
        toast.error(`Semua ${res.gagal.length} tagihan gagal dibatalkan.`);
      } else {
        toast.warning(`${res.berhasil} berhasil, ${res.gagal.length} gagal dibatalkan.`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
}
