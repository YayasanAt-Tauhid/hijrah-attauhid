import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260929054332_spmb_billing_level_phases.sql"),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "src/pages/keuangan/RencanaTagihanSiswaBaru.tsx"),
  "utf8",
);
const server = readFileSync(
  resolve(process.cwd(), "src/server/spmbBilling.ts"),
  "utf8",
);

describe("SPMB recurring billing phases contract", () => {
  it("splits MTA into phases 1-3 and 4-6", () => {
    expect(migration).toContain("v_level BETWEEN 1 AND 3");
    expect(migration).toContain("v_level_akhir := 3");
    expect(migration).toContain("v_level BETWEEN 4 AND 6");
    expect(migration).toContain("v_level_akhir := 6");
    expect(page).toContain("MTA 1–3 · fase setingkat SMP");
    expect(page).toContain("MTA 4–6 · fase setingkat SMA");
  });

  it("supports TK A through TK B as one level plan", () => {
    expect(migration).toContain("v_label LIKE '%TK A%'");
    expect(migration).toContain("v_label LIKE '%TK B%'");
    expect(page).toContain('if (code === "TK") return "TK A–B"');
  });

  it("offers fixed end month for PAUD/KB and special plans", () => {
    expect(migration).toContain("aktifkan_rencana_tagihan_sampai_tanggal");
    expect(migration).toContain("simpan_tarif_generate_dan_rencana_fleksibel_atomik");
    expect(page).toContain('<SelectItem value="date">Sampai bulan tertentu</SelectItem>');
    expect(page).toContain('type="month"');
  });

  it("uses special Daftar Ulang, not a new Uang Pangkal, on MTA 4", () => {
    expect(page).toContain("Masuk MTA 4 memulai fase MTA 4–6");
    expect(page).toContain("Daftar Ulang MTA 4 perlu dipilih");
    expect(page).toContain("/daftar ulang/i");
    expect(page).toContain("bukan Uang Pangkal baru");
  });

  it("does not reuse an expired prior-phase plan for a new SPMB period", () => {
    expect(server).toContain('String(rawPlan.selesai || "") < String(tahun.tanggal_mulai)');
    expect(migration).toContain("r.selesai >= v_ta_mulai");
    expect(migration).toContain("p_action = 'tinggal'");
  });
});