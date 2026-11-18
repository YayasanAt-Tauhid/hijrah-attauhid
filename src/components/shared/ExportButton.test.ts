import { beforeEach, describe, expect, it, vi } from "vitest";

const xlsx = vi.hoisted(() => ({
  sheets: [] as Array<{ name: string; aoa: unknown[][] }>,
  written: [] as string[],
}));
vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: (aoa: unknown[][]) => ({ aoa }),
    book_new: () => ({}),
    book_append_sheet: (_book: unknown, sheet: { aoa: unknown[][] }, name: string) => { xlsx.sheets.push({ name, aoa: sheet.aoa }); },
  },
  writeFile: (_book: unknown, name: string) => { xlsx.written.push(name); },
}));

import { exportExcel } from "./ExportButton";

beforeEach(() => { xlsx.sheets.length = 0; xlsx.written.length = 0; });

describe("exportExcel", () => {
  it("menulis sheet utama saja bila tidak ada sheet tambahan", () => {
    exportExcel([{ a: 1 }], [{ key: "a", label: "A" }], "berkas", "Data");
    expect(xlsx.sheets.map((sheet) => sheet.name)).toEqual(["Data"]);
    expect(xlsx.written).toEqual(["berkas.xlsx"]);
  });

  it("menambahkan sheet rekap dengan kolom dan angka apa adanya", () => {
    exportExcel([{ a: 1 }], [{ key: "a", label: "A" }], "berkas", "Data", [
      { name: "Rekap Uang Pangkal", columns: [{ key: "lembaga", label: "Lembaga" }, { key: "nominal", label: "Nominal" }], data: [{ lembaga: "SD", nominal: 10_100_000 }, { lembaga: "=TOTAL", nominal: 5 }] },
    ]);
    expect(xlsx.sheets.map((sheet) => sheet.name)).toEqual(["Data", "Rekap Uang Pangkal"]);
    expect(xlsx.sheets[1].aoa).toEqual([["Lembaga", "Nominal"], ["SD", 10_100_000], ["'=TOTAL", 5]]);
    expect(xlsx.written).toEqual(["berkas.xlsx"]);
  });
});
