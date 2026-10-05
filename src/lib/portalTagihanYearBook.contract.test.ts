import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const migration = readRepoFile(
  "supabase/migrations/20261005014258_fix_portal_tagihan_year_book.sql",
);
const portal = readRepoFile("src/pages/portal/PortalTagihan.tsx");

describe("portal tagihan year-book compatibility", () => {
  it("joins tagihan year id to tahun_buku and preserves that id for checkout", () => {
    expect(migration).toContain(
      "JOIN public.tahun_buku tb ON tb.id = t.tahun_ajaran_id",
    );
    expect(migration).toContain(
      "t.tahun_ajaran_id AS tahun_ajaran_id",
    );
    expect(migration).not.toContain(
      "JOIN public.tahun_ajaran ta ON ta.id = t.tahun_ajaran_id",
    );
  });

  it("derives academic metadata independently from the financial book", () => {
    expect(migration).toContain("t.tahun_akademik_id");
    expect(migration).toContain(
      "t.jatuh_tempo BETWEEN ta0.tanggal_mulai AND ta0.tanggal_selesai",
    );
    expect(migration).toContain(
      "COALESCE(ta.tanggal_mulai, akademik.fallback_mulai) AS tahun_ajaran_mulai",
    );
  });

  it("falls back to the active class without rewriting the bill", () => {
    expect(migration).toContain("FROM public.kelas_siswa ks");
    expect(migration).toContain("ks.aktif = true");
    expect(migration).toContain(
      "k.id = COALESCE(t.kelas_id, kelas_aktif.kelas_id)",
    );
  });

  it("groups quick SPP selection by academic-year start, not financial-book id", () => {
    expect(portal).toContain("const groupKey = item.tahun_ajaran_mulai;");
    expect(portal).toContain(
      "t.tahun_ajaran_mulai === tahunAjaranMulai",
    );
  });
});
