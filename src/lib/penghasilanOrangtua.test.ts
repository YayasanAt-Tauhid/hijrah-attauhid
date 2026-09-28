import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PENGHASILAN_OPTIONS } from "./penghasilanOrangtua";

describe("rentang penghasilan orang tua", () => {
  it("menggunakan opsi yang sama dengan SPMB", () => {
    expect(PENGHASILAN_OPTIONS).toEqual([
      ["1000000", "< Rp 1.000.000"],
      ["2000000", "Rp 1.000.000 s.d Rp 2.000.000"],
      ["5000000", "Rp 2.000.000 s.d Rp 5.000.000"],
      ["20000000", "Rp 5.000.000 s.d Rp 20.000.000"],
      ["30000000", "> Rp 20.000.000"],
    ]);
  });

  it("FormSiswa mempertahankan nilai legacy sebagai fallback sampai dipilih ulang", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/akademik/FormSiswa.tsx"),
      "utf8",
    );
    expect(source).toContain("isLegacyValue");
    expect(source).toContain("legacyValueLabel={legacyPenghasilanLabel}");
    expect(source).toContain("Data lama:");
  });

  it("FormSiswa memakai dropdown rentang penghasilan untuk ayah dan ibu", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/akademik/FormSiswa.tsx"),
      "utf8",
    );
    expect(source).toContain('name="penghasilan_ayah" label="Rentang Penghasilan *" options={penghasilanOptions}');
    expect(source).toContain('name="penghasilan_ibu" label="Rentang Penghasilan *" options={penghasilanOptions}');
    expect(source).not.toContain('name="penghasilan_ayah" label="Penghasilan (Rp) *" type="number"');
    expect(source).not.toContain('name="penghasilan_ibu" label="Penghasilan (Rp) *" type="number"');
  });
});
