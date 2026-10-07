import { useState, useMemo, useRef, useEffect } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton, type ExportColumn } from "@/components/shared/ExportButton";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Search, ArrowUpDown, ArrowUp, ArrowDown, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  horizontalNavigation?: boolean;
  exportable?: boolean;
  exportFilename?: string;
  exportColumns?: ExportColumn[];
  exportSheetName?: string;
  selectable?: boolean;
  loading?: boolean;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  onSelectionChange?: (selected: T[]) => void;
  actions?: React.ReactNode;
  emptyMessage?: string;
}

type SortDir = "asc" | "desc" | null;

export function DataTable<T extends Record<string, unknown>>({
  columns, data, searchable = true, searchPlaceholder = "Cari...",
  exportable = false, exportFilename = "data", exportColumns, exportSheetName = "Data", selectable = false,
  loading = false, pageSize = 10, onRowClick, onSelectionChange,
  actions, emptyMessage = "Tidak ada data", searchKeys, horizontalNavigation = false,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollMaximum, setScrollMaximum] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    let result = data;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((row) =>
        (searchKeys || columns.map((col) => col.key)).some((key) => {
          const val = row[key];
          return val != null && String(val).toLowerCase().includes(q);
        })
      );
    }
    if (sortKey && sortDir) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        const cmp = String(av).localeCompare(String(bv), "id", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [data, search, sortKey, sortDir, columns, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => {
    const element = scrollRef.current;
    if (!horizontalNavigation || !element || loading) return;
    const update = () => {
      setScrollMaximum(Math.max(0, element.scrollWidth - element.clientWidth));
      setScrollPosition(element.scrollLeft);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    const table = element.querySelector("table");
    if (table) observer?.observe(table);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [horizontalNavigation, columns, data, loading]);
  const scrollTo = (position: number) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, Math.min(scrollMaximum, position));
    setScrollPosition(element.scrollLeft);
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc");
      if (sortDir === "desc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
    onSelectionChange?.(Array.from(next).map((i) => paged[i]));
  };

  const toggleAll = () => {
    if (selected.size === paged.length) {
      setSelected(new Set());
      onSelectionChange?.([]);
    } else {
      const all = new Set(paged.map((_, i) => i));
      setSelected(all);
      onSelectionChange?.(paged);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {searchable && (
          <div className="relative w-full sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
        )}
        <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end">
          {exportable && (
            <ExportButton
              data={filtered as Record<string, unknown>[]}
              filename={exportFilename}
              columns={exportColumns || columns.map((c) => ({ key: c.key, label: c.label }))}
              sheetName={exportSheetName}
            />
          )}
          {actions}
        </div>
      </div>

      {/* SPMB exposes navigation before the table, without requiring a trip to its bottom. */}
      {horizontalNavigation && scrollMaximum > 0 && <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Geser kolom ke kiri" disabled={scrollPosition <= 0} onClick={() => scrollTo(scrollPosition - (scrollRef.current?.clientWidth || 400) * 0.7)}><ChevronLeft className="h-4 w-4" /></Button>
        <input aria-label="Posisi kolom tabel" type="range" className="min-w-0 flex-1 accent-primary" min={0} max={scrollMaximum} value={scrollPosition} onChange={(event) => scrollTo(Number(event.target.value))} />
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="Geser kolom ke kanan" disabled={scrollPosition >= scrollMaximum - 1} onClick={() => scrollTo(scrollPosition + (scrollRef.current?.clientWidth || 400) * 0.7)}><ChevronRight className="h-4 w-4" /></Button>
      </div>}
      <div ref={scrollRef} tabIndex={horizontalNavigation ? 0 : undefined} aria-label={horizontalNavigation ? "Tabel pendaftar, dapat digeser ke samping" : undefined} onScroll={horizontalNavigation ? (event) => setScrollPosition(event.currentTarget.scrollLeft) : undefined} className="max-w-full rounded-lg border overflow-x-auto">
        <Table containerClassName={horizontalNavigation ? "overflow-visible" : undefined}>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={paged.length > 0 && selected.size === paged.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(col.sortable && "cursor-pointer select-none", col.className)}
                  onClick={() => col.sortable && toggleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      sortKey === col.key ? (
                        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                      )
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (selectable ? 1 : 0)} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-10 w-10" />
                    <p>{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row, i) => (
                <TableRow
                  key={i}
                  className={cn(onRowClick && "cursor-pointer hover:bg-muted/50", selected.has(i) && "bg-primary/5")}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(i)} onCheckedChange={() => toggleSelect(i)} />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {filtered.length > 0
            ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} dari ${filtered.length}`
            : "0 data"}
        </span>
        <div className="flex items-center gap-1 self-end sm:self-auto">
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={currentPage === 0} onClick={() => setPage(0)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 whitespace-nowrap">Hal {currentPage + 1}/{totalPages}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}