import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

import { ExportButton } from "@/components/shared/ExportButton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { transposeUniformSizeTable, type UniformSizeCountRow } from "@/lib/uniformStatistics";

const firstColumn = "sticky left-0 z-10 min-w-32 bg-card text-foreground";
const numberCell = "min-w-24 text-center tabular-nums";
function headerGroups(columns: UniformSizeCountRow[], gender = false) {
  const groups: { id: string; label: string; span: number }[] = [];
  for (const column of columns) {
    const id = JSON.stringify((JSON.parse(column.id) as string[]).slice(0, gender ? 3 : 2));
    const last = groups[groups.length - 1];
    if (last?.id === id) last.span++;
    else groups.push({ id, label: gender ? column.jenisKelamin : column.lembaga, span: 1 });
  }
  return groups;
}
export function UniformSizeMatrix({ columns, sizes, grouped = false, label, exportFilename }: {
  columns: UniformSizeCountRow[];
  sizes: string[];
  grouped?: boolean;
  label: string;
  exportFilename: string;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [scroll, setScroll] = useState({ position: 0, maximum: 0 });
  useEffect(() => {
    const table = tableRef.current;
    const viewport = table?.parentElement;
    if (!table || !viewport) return;
    const update = () => setScroll({ position: viewport.scrollLeft, maximum: Math.max(0, viewport.scrollWidth - viewport.clientWidth) });
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    observer?.observe(table);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); viewport.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [columns, sizes]);
  const move = (position: number) => {
    const viewport = tableRef.current?.parentElement;
    if (viewport) viewport.scrollLeft = Math.max(0, Math.min(scroll.maximum, position));
  };
  const table = transposeUniformSizeTable(columns, sizes);
  const exportColumns = [
    { key: "ukuran", label: "Ukuran" },
    ...columns.map((column, index) => ({
      key: "column_" + index,
      label: grouped ? [column.lembaga, column.jenisKelamin, column.jenis].join(" / ") : column.jenis,
    })),
    { key: "jumlah", label: "Total per ukuran" },
  ];
  return <div className="min-w-0 space-y-3">
    <div className="flex justify-end"><ExportButton data={columns.length ? [...table.rows, table.total] : []} columns={exportColumns} filename={exportFilename} sheetName="Seragam per Ukuran" /></div>
    {scroll.maximum > 0 && <div className="flex items-center gap-2 rounded-lg border p-2">
      <Button type="button" variant="outline" size="icon" aria-label={"Geser " + label + " ke kiri"} disabled={scroll.position <= 0} onClick={() => move(scroll.position - 300)}><ChevronLeft className="h-4 w-4" /></Button>
      <input aria-label={"Posisi kolom " + label} type="range" min={0} max={scroll.maximum} value={scroll.position} onChange={(event) => move(Number(event.target.value))} className="min-w-0 flex-1 accent-primary" />
      <Button type="button" variant="outline" size="icon" aria-label={"Geser " + label + " ke kanan"} disabled={scroll.position >= scroll.maximum - 1} onClick={() => move(scroll.position + 300)}><ChevronRight className="h-4 w-4" /></Button>
    </div>}
    <div className="max-w-full rounded-lg border">
      <Table ref={tableRef} aria-label={label}>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead scope="col" rowSpan={grouped ? 3 : 1} className={firstColumn}>Ukuran</TableHead>
            {grouped ? headerGroups(columns).map((group) => <TableHead key={group.id} scope="colgroup" colSpan={group.span} className="border-x text-left font-semibold">{group.label}</TableHead>)
              : columns.map((column) => <TableHead key={column.id} scope="col" className="min-w-36 text-center">{column.jenis}</TableHead>)}
            <TableHead scope="col" rowSpan={grouped ? 3 : 1} className="min-w-36 border-l text-center font-semibold">Total per ukuran</TableHead>
          </TableRow>
          {grouped && <>
            <TableRow className="bg-muted/50">{headerGroups(columns, true).map((group) => <TableHead key={group.id} scope="colgroup" colSpan={group.span} className="border-x text-center">{group.label}</TableHead>)}</TableRow>
            <TableRow className="bg-muted/50">{columns.map((column) => <TableHead key={column.id} scope="col" className="min-w-36 border-x text-center">{column.jenis}</TableHead>)}</TableRow>
          </>}
        </TableHeader>
        <TableBody>
          {columns.length ? table.rows.map((row) => <TableRow key={row.id}>
            <TableHead scope="row" className={firstColumn}>{row.ukuran}</TableHead>
            {columns.map((column, index) => <TableCell key={column.id} className={numberCell}>{row["column_" + index]}</TableCell>)}
            <TableCell className={numberCell + " border-l font-semibold"}>{row.jumlah}</TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={columns.length + 2} className="py-6 text-center text-muted-foreground">Belum ada rekap seragam pada filter ini</TableCell></TableRow>}
        </TableBody>
        <TableFooter><TableRow>
          <TableHead scope="row" className={firstColumn + " font-semibold"}>Total per jenis</TableHead>
          {columns.map((column, index) => <TableCell key={column.id} className={numberCell + " font-semibold"}>{table.total["column_" + index]}</TableCell>)}
          <TableCell className={numberCell + " border-l font-semibold"}>{table.total.jumlah}</TableCell>
        </TableRow></TableFooter>
      </Table>
    </div>
  </div>;
}
