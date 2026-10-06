import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261006054235_flexible_student_discount_type.sql"),
  "utf8",
);
const server = readFileSync(resolve(process.cwd(), "src/server/diskon.ts"), "utf8");
const page = readFileSync(
  resolve(process.cwd(), "src/pages/keuangan/DiskonSiswa.tsx"),
  "utf8",
);

describe("flexible student discount type contract", () => {
  it("allows one scheme to use policy default, percent, or nominal per application", () => {
    expect(page).toContain("Cara Menentukan Potongan");
    expect(page).toContain('<SelectItem value="persen">Persentase (%)</SelectItem>');
    expect(page).toContain('<SelectItem value="nominal">Nominal (Rp)</SelectItem>');
    expect(server).toContain('tipe?: "persen" | "nominal" | null');
    expect(server).toContain("tipe_snapshot: data.tipe ?? null");
    expect(migration).toContain("COALESCE(NEW.tipe_snapshot, v_policy.tipe)");
    expect(migration).toContain("COALESCE(NEW.tipe_snapshot, v_skema.tipe)");
  });

  it("uses the snapshotted type and value when calculating current and future bills", () => {
    expect(migration).toContain(
      "COALESCE(sd.nilai_snapshot, sd.nilai, sk.nilai_default, 0) AS nilai",
    );
    expect(migration).toContain("COALESCE(sd.tipe_snapshot, sk.tipe) AS tipe");
    expect(migration).toContain("COALESCE(v_sd.tipe_snapshot, sk.tipe) = 'persen'");
    expect(migration).toContain(
      "COALESCE(v_sd.nilai_snapshot, v_sd.nilai, sk.nilai_default, 0)",
    );
  });

  it("records both policy reference and the actually granted type", () => {
    expect(migration).toContain("'tipe_kebijakan', v_policy.tipe");
    expect(migration).toContain("'tipe_diberikan', v_tipe");
    expect(migration).toContain("'nilai_diberikan', v_nilai");
  });

  it("protects approved snapshots from later mutation", () => {
    expect(migration).toContain("NEW.tipe_snapshot IS DISTINCT FROM OLD.tipe_snapshot");
    expect(migration).toContain("NEW.nilai_snapshot IS DISTINCT FROM OLD.nilai_snapshot");
    expect(migration).toContain("NEW.kebijakan_snapshot IS DISTINCT FROM OLD.kebijakan_snapshot");
  });

  it("keeps privileged discount RPCs service-role only", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.hitung_diskon_tagihan(uuid, uuid, uuid, integer, numeric)",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.terapkan_diskon_siswa(uuid, uuid)",
    );
    expect(migration).toContain("TO service_role;");
  });
});
