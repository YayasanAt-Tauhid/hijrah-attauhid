import type { SpmbInputTagihan } from "./spmbBillingStatus";

export type ReissueKind = "spp" | "uang_pangkal";
export type CancelledBill = SpmbInputTagihan;

export const REISSUE_MIN_TEXT = 10;
export const REISSUE_MAX_NOMINAL_SPP = 100_000_000;
/** Alasan baku untuk pratinjau (dry-run): RPC mewajibkan alasan, tetapi pratinjau tidak menulis apa pun. */
export const REISSUE_PREVIEW_REASON = "Pratinjau penerbitan ulang tagihan";

/** Hanya tagihan dibatalkan; tagihan dihapusbuku punya akuntansi sendiri dan diproses terpisah. */
export function canReissueBill(bill: Pick<CancelledBill, "status">): boolean {
  return bill.status === "dibatalkan";
}

export type ReissueInput = {
  kind: ReissueKind;
  nominal: number | null;
  reason: string;
  differsFromSk?: boolean;
  note?: string;
  needsAlumni?: boolean;
  alumni?: string;
};

/** Mengembalikan pesan kesalahan (bahasa Indonesia) atau null bila input valid. */
export function validateReissueInput(input: ReissueInput): string | null {
  if (input.reason.trim().length < REISSUE_MIN_TEXT) return "Alasan minimal 10 karakter wajib diisi";
  if (input.kind === "spp") {
    const n = input.nominal;
    if (n === null || !Number.isFinite(n) || n <= 0 || n > REISSUE_MAX_NOMINAL_SPP) {
      return "Nominal SPP harus lebih dari 0 dan maksimal Rp100.000.000";
    }
    return null;
  }
  if (input.nominal !== null && (!Number.isFinite(input.nominal) || input.nominal <= 0)) {
    return "Nominal bruto uang pangkal harus valid";
  }
  if (input.differsFromSk && (input.note ?? "").trim().length < REISSUE_MIN_TEXT) {
    return "Catatan minimal 10 karakter wajib diisi bila nominal berbeda dari SK";
  }
  if (input.needsAlumni && !input.alumni) return "Pilih status alumni";
  return null;
}

export type ReissueParamsInput = {
  tagihanId: string;
  kind: ReissueKind;
  nominal: number | null;
  apply: boolean;
  previewHash?: string | null;
  reason?: string;
  alumni?: string;
  fase?: string | null;
  note?: string;
};

export function buildReissueParams(input: ReissueParamsInput) {
  if (input.apply && !input.previewHash) throw new Error("Muat pratinjau terlebih dahulu sebelum menerapkan");
  const pangkal = input.kind === "uang_pangkal";
  return {
    p_tagihan_id: input.tagihanId,
    p_nominal_bruto: input.nominal,
    p_alasan: input.apply ? (input.reason ?? "").trim() : REISSUE_PREVIEW_REASON,
    p_apply: input.apply,
    p_preview_hash: input.apply ? input.previewHash! : null,
    p_alumni_asrama: pangkal ? input.alumni || "none" : "none",
    p_fase_mta: pangkal ? input.fase || null : null,
    p_catatan: input.note?.trim() || null,
  };
}

export type ReissuePreview = {
  jenis: ReissueKind;
  tagihan_id: string;
  siswa_id: string;
  nominal_bruto_lama: number;
  nominal_bruto_baru: number;
  preview_hash: string;
  applied: boolean;
  periode?: string;
  kategori_lama?: string | null;
  kategori_baru?: string;
  nominal_diskon_baru?: number;
  nominal_netto_baru?: number;
  program_baru?: string;
  keringanan_alumni?: number | string | null;
  bruto_acuan?: number | string | null;
  dibatalkan_alasan?: string | null;
  verifikasi_lama_id?: string | null;
  tarif_lama?: { id: string; nominal: number } | null;
  riwayat_id?: string;
};

export type ReissueRow = { label: string; lama: string; baru: string };

export function describeReissue(p: ReissuePreview, fmt: (n: number) => string): ReissueRow[] {
  const rows: ReissueRow[] = [];
  const tarifLama = p.tarif_lama ? fmt(Number(p.tarif_lama.nominal)) : "-";
  if (p.jenis === "spp") {
    rows.push({ label: "Kategori SPP", lama: p.kategori_lama ?? "-", baru: p.kategori_baru ?? "-" });
    rows.push({ label: "Nominal bruto", lama: fmt(Number(p.nominal_bruto_lama)), baru: fmt(Number(p.nominal_bruto_baru)) });
    if (Number(p.nominal_diskon_baru ?? 0) > 0) rows.push({ label: "Potongan otomatis", lama: "-", baru: fmt(Number(p.nominal_diskon_baru)) });
  } else {
    rows.push({ label: "Program uang pangkal", lama: "-", baru: p.program_baru ?? "-" });
    rows.push({ label: "Nominal bruto", lama: fmt(Number(p.nominal_bruto_lama)), baru: fmt(Number(p.nominal_bruto_baru)) });
    if (Number(p.keringanan_alumni ?? 0) > 0) rows.push({ label: "Keringanan alumni (diajukan)", lama: "-", baru: fmt(Number(p.keringanan_alumni)) });
    if (p.verifikasi_lama_id) rows.push({ label: "Verifikasi uang pangkal", lama: "Ada (diarsipkan)", baru: "Dibuat ulang" });
  }
  rows.push({ label: "Tarif per siswa", lama: tarifLama, baru: fmt(Number(p.nominal_bruto_baru)) });
  return rows;
}
