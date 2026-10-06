import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pilih bulan yang valid");
export const sppPeriodSchema = z.object({
  siswa_id: z.string().uuid(),
  jenis_id: z.string().uuid(),
  mulai: month,
  selesai: month,
  kategori: z.enum(["asrama", "non_asrama"]),
  apply: z.boolean().default(false),
  preview_hash: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  alasan: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.selesai < value.mulai) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Bulan akhir harus setelah atau sama dengan bulan mulai" });
  if (value.apply && (!value.preview_hash || !value.alasan || value.alasan.length < 10)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Muat pratinjau dan isi alasan minimal 10 karakter" });
  }
});
export type SppPeriodInput = z.input<typeof sppPeriodSchema>;
export interface SppPeriodRow {
  periode: string;
  tagihan_id: string | null;
  status: string | null;
  nominal: number | null;
  kategori_lama: string | null;
  kategori_baru: "asrama" | "non_asrama";
  aksi: "ubah_tagihan" | "jadwalkan" | "terkunci" | "sudah_sesuai";
  alasan: string | null;
}
export interface SppPeriodPreview {
  preview_hash: string;
  rows: SppPeriodRow[];
  bulan_dapat_disesuaikan: number;
  applied: boolean;
  tagihan_diubah: number;
  audit_id: string | null;
}
export function nextJakartaMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const monthNumber = Number(parts.find((p) => p.type === "month")?.value);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 7);
}
export function categoryLabel(category: string | null): string {
  return category === "asrama" ? "Asrama" : category === "non_asrama" ? "Non Asrama" : category === "belum_terverifikasi" ? "Belum terverifikasi" : category === "umum" ? "Umum" : "Belum ditetapkan";
}
export function safeStudentSearch(term: string): string {
  return term.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

