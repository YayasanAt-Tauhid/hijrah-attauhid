
import { UniformSizeMatrix } from "./UniformSizeMatrix";
import { summarizeUniformSizeTotals, type UniformSizeCountRow } from "@/lib/uniformStatistics";

export function UniformTotals({ rows, sizes }: { rows: UniformSizeCountRow[]; sizes: string[] }) {
  const totals = summarizeUniformSizeTotals(rows, sizes);
  return <section aria-label="Total per ukuran dan jenis seragam" className="min-w-0 space-y-3">
    <h3 className="font-semibold">Total per ukuran dan jenis seragam</h3>
    <p className="text-sm text-muted-foreground">Rekap gabungan seluruh lembaga dan jenis kelamin pada filter yang dipilih. Total per jenis hanya menghitung stel yang sudah memiliki ukuran; yang belum diisi dicatat terpisah.</p>
    <UniformSizeMatrix columns={totals.rows} sizes={sizes} label="Rekap total seragam" exportFilename="total-seragam-spmb" />
  </section>;
}
