import { describe, expect, it } from "vitest";
import { nextJakartaMonth, safeStudentSearch, sppPeriodSchema } from "./sppPeriod";
const input = {
  siswa_id: "00000000-0000-0000-0000-000000000911",
  jenis_id: "00000000-0000-0000-0000-000000000912",
  mulai: "2026-11", selesai: "2027-06", kategori: "non_asrama",
};
describe("kategori SPP per periode", () => {
  it("menolak penyimpanan tanpa bukti pratinjau dan alasan", () => {
    expect(sppPeriodSchema.safeParse({ ...input, apply: true }).success).toBe(false);
    expect(sppPeriodSchema.safeParse({ ...input, apply: true, preview_hash: "a".repeat(32), alasan: "Pindah non asrama sesuai konfirmasi wali." }).success).toBe(true);
  });
  it("menolak rentang terbalik, kategori lain, dan bulan tidak valid", () => {
    expect(sppPeriodSchema.safeParse({ ...input, selesai: "2026-10" }).success).toBe(false);
    expect(sppPeriodSchema.safeParse({ ...input, kategori: "umum" }).success).toBe(false);
    expect(sppPeriodSchema.safeParse({ ...input, mulai: "2026-13" }).success).toBe(false);
  });
  it("menggunakan pergantian bulan WIB termasuk pergantian tahun", () => {
    expect(nextJakartaMonth(new Date("2026-10-31T16:59:59Z"))).toBe("2026-11");
    expect(nextJakartaMonth(new Date("2026-10-31T17:00:00Z"))).toBe("2026-12");
    expect(nextJakartaMonth(new Date("2026-12-31T17:00:00Z"))).toBe("2027-02");
  });
  it("mencegah pencarian menyisipkan filter PostgREST dan mempertahankan nama Unicode", () => {
    expect(safeStudentSearch("Aliyah,nis.eq.x)")).toBe("Aliyah nis eq x");
    expect(safeStudentSearch("  Nūr 'Aisyah  ")).toBe("Nūr 'Aisyah");
  });
  it("identitas pelaku tidak dapat dikirim dari browser", () => {
    const parsed = sppPeriodSchema.parse({ ...input, p_user_id: "forged", userId: "forged" });
    expect(parsed).not.toHaveProperty("p_user_id");
    expect(parsed).not.toHaveProperty("userId");
  });
});
