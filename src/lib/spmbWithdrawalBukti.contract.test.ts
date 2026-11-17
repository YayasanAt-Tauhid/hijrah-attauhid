import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261117080000_spmb_bukti_pengunduran_diri.sql"),
  "utf8",
);

describe("migrasi bukti pengunduran diri dari orang tua", () => {
  it("menambah kolom path bukti di siswa_detail tanpa menyentuh kolom lain", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS spmb_mundur_bukti_path text");
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("membuat overload RPC dengan p_bukti_path yang memanggil RPC lama dalam transaksi yang sama", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.spmb_withdraw_registration(");
    expect(migration).toContain("p_bukti_path text");
    expect(migration).toContain("public.spmb_withdraw_registration(p_siswa_id, p_alasan, p_tanggal_efektif, p_actor_id)");
    expect(migration).toContain("UPDATE public.siswa_detail");
    expect(migration).toContain("spmb_mundur_bukti_path = v_bukti");
  });

  it("mewajibkan bukti berpola mundur/<uuid>.(pdf|jpg|jpeg|png) SEBELUM mengubah data", () => {
    expect(migration).toContain("Bukti pengunduran diri dari orang tua wajib diunggah");
    expect(migration).toContain("^mundur/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png)$");
    expect(migration.indexOf("Bukti pengunduran diri dari orang tua wajib diunggah"))
      .toBeLessThan(migration.indexOf("v_result := public.spmb_withdraw_registration("));
  });

  it("dibatasi ke service role seperti RPC lama", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.spmb_withdraw_registration(uuid,text,date,uuid,text)");
    expect(migration).toContain("FROM PUBLIC,anon,authenticated");
    expect(migration).toContain("TO service_role");
  });

  it("menyimpan bukti pada pendaftaran yang sama dengan yang diproses RPC lama", () => {
    expect(migration).toContain("spmb_gelombang_id IS NOT NULL");
    expect(migration).toContain("ORDER BY spmb_registered_at DESC NULLS LAST");
  });
});
