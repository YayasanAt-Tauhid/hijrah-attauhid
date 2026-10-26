import type { SpmbBillingCandidate } from "@/server/spmbBilling";
import type { AlumniAsrama, FaseMta, UangPangkalPreview } from "./spmbUangPangkal";
import { bulanKalenderTahunAjaran, kelompokkanBulanKeTahunBuku, type PeriodeTanggal } from "./periodeTagihan";
import { isSppPaymentName } from "./installment";

export const MAX_BULK_STUDENTS = 100;
export interface BulkPaymentType {
  id: string; nama: string; tipe: string; departemen_id: string | null; nominal: number | null; aktif?: boolean;
}
export interface BulkBillingDraft {
  siswa: SpmbBillingCandidate;
  sppMode: "none" | "awal" | "rencana";
  jenisId: string;
  nominal: string;
  mulai: string;
  pangkal: boolean;
  fase: FaseMta | "";
  alumni: AlumniAsrama | "";
  bruto: string;
  catatan: string;
}
export type BulkRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export interface PreparedBulkRow {
  draft: BulkBillingDraft;
  sppPayload: Record<string, unknown> | null;
  preview: UangPangkalPreview | null;
  error: string | null;
}
export type BulkActionResult = { status: "saved" | "skipped" | "failed"; message: string };
export interface BulkRowResult { id: string; spp?: BulkActionResult; pangkal?: BulkActionResult }

export function bulkSppTypes(siswa: SpmbBillingCandidate, jenis: BulkPaymentType[]) {
  return jenis.filter(j => j.aktif !== false && j.departemen_id === siswa.target_departemen_id
    && j.tipe === "bulanan" && isSppPaymentName(j.nama));
}

export function createBulkDraft(siswa: SpmbBillingCandidate, jenis: BulkPaymentType[]): BulkBillingDraft {
  const options = bulkSppTypes(siswa, jenis);
  const matching = options.filter(j => siswa.status_asrama === "asrama"
    ? /asrama/i.test(j.nama) && !/non[\s_-]*asrama/i.test(j.nama)
    : siswa.status_asrama === "non_asrama" ? /non[\s_-]*asrama/i.test(j.nama) : false);
  const selected = matching.length === 1 ? matching[0] : options.length === 1 ? options[0] : null;
  return {
    siswa, sppMode: "awal", jenisId: selected?.id || "", nominal: selected?.nominal ? String(selected.nominal) : "",
    mulai: siswa.tahun_ajaran_mulai?.slice(0, 7) ? `${siswa.tahun_ajaran_mulai.slice(0, 7)}-01` : "",
    pangkal: false, fase: "", alumni: siswa.target_departemen_kode === "SMA" ? "" : "none", bruto: "", catatan: "",
  };
}

export function needsBulkAlumni(draft: BulkBillingDraft) {
  return draft.siswa.target_departemen_kode === "SMA" || (draft.siswa.target_departemen_kode === "MTA" && draft.fase === "sma");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function bulkError(error: unknown) {
  const message = record(error).message;
  return typeof message === "string" ? message : "Terjadi kesalahan. Periksa kembali sebelum mencoba ulang.";
}
function positive(value: string) { return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0; }

export async function prepareBulkRow(
  draft: BulkBillingDraft, jenis: BulkPaymentType[], tahunBuku: PeriodeTanggal[], rpc: BulkRpc,
): Promise<PreparedBulkRow> {
  const row: PreparedBulkRow = { draft, sppPayload: null, preview: null, error: null };
  try {
    const siswa = draft.siswa;
    if (!siswa.ready_for_billing) throw new Error(siswa.ready_reason || "Siswa belum siap ditagih.");
    if (!siswa.tahun_ajaran_id || !siswa.tahun_ajaran_mulai || !siswa.tahun_ajaran_selesai || !siswa.target_departemen_id)
      throw new Error("Lembaga dan tahun ajaran tujuan belum lengkap.");
    if (draft.sppMode === "none" && !draft.pangkal) throw new Error("Pilih SPP atau uang pangkal untuk siswa ini.");
    const academic = { id: siswa.tahun_ajaran_id, tanggal_mulai: siswa.tahun_ajaran_mulai, tanggal_selesai: siswa.tahun_ajaran_selesai };
    const calendar = bulanKalenderTahunAjaran(academic);
    if (draft.sppMode !== "none") {
      if (!bulkSppTypes(siswa, jenis).some(j => j.id === draft.jenisId)) throw new Error("Pilih jenis SPP aktif pada jenjang tujuan.");
      if (!positive(draft.nominal)) throw new Error("Nominal SPP harus lebih dari 0.");
      if (!calendar.some(month => month.tanggal === draft.mulai)) throw new Error("Bulan SPP harus berada dalam tahun ajaran tujuan.");
      if (draft.sppMode === "rencana") {
        if (!siswa.ready_for_spp || !siswa.kelas_id) throw new Error("Rencana SPP memerlukan aktivasi dan kelas tujuan; pilih SPP awal satu bulan.");
        if (!["TK", "SD", "SMP", "SMA", "MTA"].includes(siswa.target_departemen_kode || ""))
          throw new Error("Jenjang ini memakai batas bulan khusus. Gunakan Atur Tagihan per siswa.");
        if (siswa.target_departemen_kode === "MTA" && /\b4\b/.test(siswa.kelas_nama || "") && !siswa.rencana_spp)
          throw new Error("Transisi MTA 4 memerlukan daftar ulang khusus. Gunakan Atur Tagihan per siswa.");
        const periods = kelompokkanBulanKeTahunBuku({ tahunAjaran: academic, tahunBukuList: tahunBuku,
          bulanList: calendar.filter(month => month.tanggal >= draft.mulai).map(month => month.bulan) });
        if (periods.missing.length || !periods.groups.length) throw new Error("Tahun Buku untuk periode rencana SPP belum lengkap.");
        row.sppPayload = {
          p_tarif_rows: periods.groups.map(g => ({ jenis_id: draft.jenisId, siswa_id: siswa.id, kelas_id: null,
            angkatan_id: null, tahun_ajaran_id: g.tahunBukuId, nominal: Number(draft.nominal), keterangan: "Tarif SPP siswa baru dari input massal SPMB" })),
          p_tahun_akademik_id: siswa.tahun_ajaran_id, p_jenis_id: draft.jenisId,
          p_generate_groups: periods.groups.map(g => ({ tahun_buku_id: g.tahunBukuId, bulan_list: g.bulanList })),
          p_departemen_id: siswa.target_departemen_id, p_siswa_ids: null, p_siswa_id: siswa.id,
          p_kelas_id: siswa.kelas_id, p_angkatan_id: null, p_mode_akhir: "akhir_jenjang",
          p_rencana_mulai: draft.mulai, p_rencana_selesai: null,
        };
      } else {
        row.sppPayload = { p_siswa_id: siswa.id, p_tahun_akademik_id: siswa.tahun_ajaran_id,
          p_jenis_id: draft.jenisId, p_bulan_mulai: draft.mulai, p_nominal: Number(draft.nominal) };
      }
    }
    if (draft.pangkal) {
      if (siswa.target_departemen_kode === "MTA" && !draft.fase) throw new Error("Pilih fase masuk MTA.");
      if (needsBulkAlumni(draft) && !draft.alumni) throw new Error("Periksa dan pilih status alumni sebelumnya.");
      const response = await rpc("preview_uang_pangkal_spmb", {
        p_siswa_id: siswa.id, p_tahun_akademik_id: siswa.tahun_ajaran_id,
        p_alumni_asrama: draft.alumni || "none", p_fase_mta: siswa.target_departemen_kode === "MTA" ? draft.fase : null,
      });
      if (response.error) throw response.error;
      const preview = response.data as UangPangkalPreview | null;
      if (!preview?.preview_hash || !Number.isFinite(Number(preview.bruto_acuan))) throw new Error("Pratinjau uang pangkal tidak lengkap.");
      row.preview = preview;
      if (!preview.verifikasi) {
        const bruto = draft.bruto === "" ? Number(preview.bruto_acuan) : Number(draft.bruto);
        const discount = Number(preview.keringanan_alumni);
        if (!Number.isFinite(bruto) || bruto <= 0 || bruto < discount) throw new Error("Bruto uang pangkal harus valid dan mencukupi keringanan alumni.");
        if (discount > 0 && bruto !== Number(preview.bruto_acuan)) throw new Error("Keringanan alumni menggunakan bruto penuh sesuai SK.");
        if (bruto !== Number(preview.bruto_acuan) && draft.catatan.trim().length < 10)
          throw new Error("Bruto khusus memerlukan catatan minimal 10 karakter.");
      }
    }
  } catch (error) { row.error = bulkError(error); }
  return row;
}

function sameTarget(before: SpmbBillingCandidate, now: SpmbBillingCandidate, plan: boolean) {
  return now.ready_for_billing && before.target_departemen_id === now.target_departemen_id
    && before.tahun_ajaran_id === now.tahun_ajaran_id && before.status_asrama === now.status_asrama
    && before.tahun_ajaran_mulai === now.tahun_ajaran_mulai && before.tahun_ajaran_selesai === now.tahun_ajaran_selesai
    && before.spmb_internal === now.spmb_internal
    && (!plan || (now.ready_for_spp && before.kelas_id === now.kelas_id));
}

/** Each RPC is atomic. A batch may partially succeed; never hide saved work or retry it blindly. */
export async function runBulkBilling(
  rows: PreparedBulkRow[], freshCandidates: SpmbBillingCandidate[], rpc: BulkRpc,
  onProgress: (result: BulkRowResult) => void,
) {
  if (!rows.length || rows.length > MAX_BULK_STUDENTS || rows.some(row => row.error)
    || new Set(rows.map(row => row.draft.siswa.id)).size !== rows.length) throw new Error("Periksa seluruh baris sebelum menyimpan.");
  const results: BulkRowResult[] = [];
  for (const row of rows) {
    const { draft, preview } = row;
    const result: BulkRowResult = { id: draft.siswa.id };
    const fresh = freshCandidates.find(siswa => siswa.id === draft.siswa.id);
    if (!fresh || !sameTarget(draft.siswa, fresh, draft.sppMode === "rencana")) {
      const failed: BulkActionResult = { status: "failed", message: "Data/kesiapan siswa berubah. Tutup dan buka kembali Input Massal." };
      if (draft.sppMode !== "none") result.spp = failed;
      if (draft.pangkal) result.pangkal = failed;
    } else {
      if (draft.sppMode !== "none") {
        try {
          const existing = fresh.spp_awal?.tagihan.some(bill => bill.periode === draft.mulai);
          if (draft.sppMode === "rencana" && fresh.rencana_spp) {
            result.spp = { status: "skipped", message: "Rencana SPP sudah ada; gunakan Edit Rencana untuk mengubahnya." };
          } else if (draft.sppMode === "awal" && existing) {
            result.spp = { status: "skipped", message: "SPP bulan ini sudah ada; nominal dan pembayaran tetap dipertahankan." };
          } else {
            const response = await rpc(draft.sppMode === "awal" ? "terbitkan_spp_awal_spmb" : "simpan_tarif_generate_dan_rencana_fleksibel_atomik", row.sppPayload!);
            if (response.error) throw response.error;
            const data = record(response.data);
            const errors = data.errors;
            if (Array.isArray(errors) && errors.length) throw new Error(errors.join("; "));
            if (draft.sppMode === "rencana" && !record(data.rencana).rencana_id) throw new Error("Hasil rencana belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.");
            if (draft.sppMode === "awal" && !data.generated && !data.skipped) throw new Error("Hasil SPP belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.");
            result.spp = { status: data.skipped && !data.generated && draft.sppMode === "awal" ? "skipped" : "saved",
              message: data.skipped && !data.generated && draft.sppMode === "awal" ? "SPP sudah ada; tidak diterbitkan ulang."
                : draft.sppMode === "awal" ? "SPP satu bulan tersimpan." : "Rencana SPP sampai Juni akhir jenjang tersimpan." };
          }
        } catch (error) { result.spp = { status: "failed", message: bulkError(error) }; }
        onProgress({ ...result });
      }
      if (draft.pangkal) {
        try {
          if (!preview) throw new Error("Periksa ulang pratinjau uang pangkal.");
          if (preview.verifikasi) {
            result.pangkal = { status: "skipped", message: "Uang pangkal sudah diverifikasi; gunakan koreksi untuk perubahan." };
          } else {
            const response = await rpc("verifikasi_uang_pangkal_spmb", {
              p_siswa_id: fresh.id, p_tahun_akademik_id: fresh.tahun_ajaran_id,
              p_alumni_asrama: draft.alumni || "none", p_fase_mta: fresh.target_departemen_kode === "MTA" ? draft.fase : null,
              p_nominal_bruto: draft.bruto === "" ? Number(preview.bruto_acuan) : Number(draft.bruto),
              p_catatan: draft.catatan.trim() || null, p_preview_hash: preview.preview_hash, p_confirmed: true,
            });
            if (response.error) throw response.error;
            const data = record(response.data);
            if (!data.success) throw new Error("Hasil uang pangkal belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.");
            result.pangkal = { status: data.skipped ? "skipped" : "saved", message: data.skipped
              ? "Uang pangkal sudah ada; tidak diterbitkan ulang."
              : data.siswa_diskon_id ? "Uang pangkal tersimpan; keringanan alumni menunggu persetujuan." : "Uang pangkal tersimpan." };
          }
        } catch (error) { result.pangkal = { status: "failed", message: bulkError(error) }; }
      }
    }
    results.push(result);
    onProgress({ ...result });
  }
  return results;
}
