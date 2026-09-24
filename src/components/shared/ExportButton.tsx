import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx";

export interface ExportColumn {
  key: string;
  label: string;
}

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename?: string;
  columns?: ExportColumn[];
  sheetName?: string;
}

function safeSpreadsheetValue(value: unknown): string | number | boolean {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();

  let text: string;
  if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }

  // Hindari formula injection saat file dibuka di Excel/LibreOffice.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function buildRows(data: Record<string, unknown>[], columns: ExportColumn[]) {
  return data.map((row) => columns.map((column) => safeSpreadsheetValue(row[column.key])));
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCSV(data: Record<string, unknown>[], columns: ExportColumn[], filename: string) {
  const rows = buildRows(data, columns);
  const csv = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");

  // BOM membantu Excel mengenali UTF-8 (nama Indonesia/Arab) dengan benar.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}.csv`);
}

function exportExcel(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  filename: string,
  sheetName: string,
) {
  const rows = buildRows(data, columns);
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.label),
    ...rows,
  ]);

  worksheet["!cols"] = columns.map((column, columnIndex) => {
    const longest = Math.max(
      column.label.length,
      ...rows.map((row) => String(row[columnIndex] ?? "").length),
    );
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || "Data");
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({
  data,
  filename = "export",
  columns,
  sheetName = "Data",
}: ExportButtonProps) {
  const cols = columns || (data.length > 0
    ? Object.keys(data[0]).map((key) => ({ key, label: key }))
    : []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!data.length || !cols.length}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportCSV(data, cols, filename)}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportExcel(data, cols, filename, sheetName)}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.print()}>
          Print / PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
