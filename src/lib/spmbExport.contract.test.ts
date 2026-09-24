import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const spmbPage = readFileSync(resolve(process.cwd(), "src/pages/akademik/SPMB.tsx"), "utf8");
const dataTable = readFileSync(resolve(process.cwd(), "src/components/shared/DataTable.tsx"), "utf8");
const exportButton = readFileSync(resolve(process.cwd(), "src/components/shared/ExportButton.tsx"), "utf8");

describe("SPMB filtered export", () => {
  it("enables CSV/Excel export on the filtered SPMB table", () => {
    expect(spmbPage).toContain("exportable");
    expect(spmbPage).toContain("exportColumns={SPMB_EXPORT_COLUMNS}");
    expect(spmbPage).toContain('exportSheetName="Data SPMB"');
    expect(spmbPage).toContain("_exportNik");
    expect(spmbPage).toContain("_exportKesiapan");
    expect(spmbPage).toContain("_exportStatusPendaftaran");
  });

  it("exports the DataTable search result instead of the unfiltered source rows", () => {
    expect(dataTable).toContain("data={filtered as Record<string, unknown>[]}");
    expect(dataTable).toContain("columns={exportColumns ||");
  });

  it("supports both CSV and Excel xlsx output", () => {
    expect(exportButton).toContain("Export CSV");
    expect(exportButton).toContain("Export Excel (.xlsx)");
    expect(exportButton).toContain("XLSX.utils.aoa_to_sheet");
    expect(exportButton).toContain("XLSX.writeFile");
    expect(exportButton).toContain("text/csv;charset=utf-8");
  });
});
