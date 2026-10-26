import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261026060256_spmb_lulus_auto_accept_nis.sql"),
  "utf8",
);
const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");
const pmbServer = readFileSync(resolve(process.cwd(), "src/server/pmb.ts"), "utf8");

describe("SPMB lulus otomatis diterima dan mendapat NIS tujuan", () => {
  it("menyatukan kelulusan, readiness, NIS, dan penerimaan dalam satu RPC atomik", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.spmb_mark_lulus_and_accept");
    expect(migration).toContain("spmb_status_kelulusan='lulus'");
    expect(migration).toContain("readiness:=public.spmb_readiness(p_siswa_id)");
    expect(migration).toContain("target_nis:=public.akademik_generate_nis_spmb");
    expect(migration).toContain("SET spmb_status_pendaftaran='diterima'");
    expect(migration).toContain("SET status='diterima'");
    expect(migration).toContain("'diterima',true");
  });

  it("mempertahankan siswa internal di lembaga asal sambil membuat NIS tujuan", () => {
    expect(migration).toContain("IF internal_student THEN");
    expect(migration).toContain("Siswa internal tetap aktif pada lembaga asal sampai aktivasi jenjang");
    expect(migration).not.toContain("SET departemen_id=target_dept");
  });

  it("membatasi RPC privileged ke service role dan mengotorisasi lewat server function", () => {
    expect(migration).toContain("FROM PUBLIC,anon,authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("TO authenticated,service_role");
    expect(pmbServer).toContain("export const spmbMarkLulusAndAccept");
    expect(pmbServer).toContain('requireAcademicDepartment(admin, actor.userId, departemenId, ["admin", "admin_tu"])');
    expect(pmbServer).toContain('rpc("spmb_mark_lulus_and_accept"');
  });

  it("halaman SPMB meminta konfirmasi lalu memakai server function atomik ketika tindakan Lulus dipilih", () => {
    expect(spmbPage).toContain('if (action === "lulus")');
    expect(spmbPage).toContain("setLulusConfirmRow(row)");
    expect(spmbPage).toContain("Nyatakan calon murid lulus?");
    expect(spmbPage).toContain("Lulus &amp; Terima Murid");
    expect(spmbPage).toContain("spmbMarkLulusAndAccept({");
    expect(spmbPage).toContain("otomatis diterima · NIS tujuan");
  });
});
