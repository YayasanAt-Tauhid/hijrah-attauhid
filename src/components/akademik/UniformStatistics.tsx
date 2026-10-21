import { useState } from "react";
import { CheckCircle2, Clock, Shirt, AlertTriangle } from "lucide-react";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Label } from "@/components/ui/label";
import { summarizeUniforms, type UniformCountRow } from "@/lib/uniformStatistics";

const columns: DataTableColumn<UniformCountRow>[] = [
  { key: "lembaga", label: "Lembaga", sortable: true },
  { key: "jenisKelamin", label: "Jenis kelamin", sortable: true },
  { key: "jenis", label: "Jenis seragam", sortable: true },
  { key: "ukuran", label: "Ukuran", sortable: true },
  { key: "jumlah", label: "Jumlah stel", sortable: true },
];
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export function UniformStatistics({ rows, departments }: {
  rows: Record<string, unknown>[];
  departments: { id: string; nama: string; kode?: string }[];
}) {
  const [gender, setGender] = useState("all");
  const [graduation, setGraduation] = useState("all");
  const filtered = rows.filter((row) =>
    (gender === "all" || row.jenis_kelamin === gender)
    && (graduation === "all" || (graduation === "belum" ? !row._spmbStatusKelulusan : row._spmbStatusKelulusan === graduation)));
  const summary = summarizeUniforms(filtered, departments);

  return <section aria-label="Statistik seragam" className="space-y-4 rounded-xl border bg-card p-4">
    <div><h2 className="text-lg font-semibold">Statistik seragam</h2>
      <p className="text-sm text-muted-foreground">Mengikuti filter lembaga, tahun ajaran, dan gelombang di atas. Jumlah dihitung dalam stel berdasarkan jenis dan ukuran yang tersimpan, termasuk nama jenis yang diedit.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="uniform-statistics-gender">Jenis kelamin seragam</Label>
        <select id="uniform-statistics-gender" className={selectClass} value={gender} onChange={(event) => setGender(event.target.value)}>
          <option value="all">Semua</option><option value="L">Ikhwan</option><option value="P">Akhwat</option>
        </select>
      </div>
      <div className="space-y-1"><Label htmlFor="uniform-statistics-graduation">Kelulusan untuk rekap</Label>
        <select id="uniform-statistics-graduation" className={selectClass} value={graduation} onChange={(event) => setGraduation(event.target.value)}>
          <option value="all">Semua pendaftar</option><option value="lulus">Lulus tes</option>
          <option value="tidak_lulus">Tidak lulus tes</option><option value="belum">Belum ditentukan</option>
        </select>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatsCard title="Ukuran lengkap (4 stel)" value={summary.complete} icon={CheckCircle2} color="success" />
      <StatsCard title="Ukuran belum lengkap" value={summary.incomplete} icon={Clock} color="warning" />
      <StatsCard title="Stel tercatat" value={summary.recorded} icon={Shirt} color="info" />
      <StatsCard title="Stel belum ada ukuran" value={summary.missing} icon={AlertTriangle} color="warning" />
    </div>
    <p className="text-sm text-muted-foreground">{summary.eligible} pendaftar dalam perhitungan kelengkapan empat stel. Ukuran yang belum diisi ditampilkan terpisah sebagai “Belum diisi”.</p>
    {summary.unavailable > 0 && <p className="text-sm text-muted-foreground">{summary.unavailable} pendaftar TK belum dihitung karena data seragam TK belum tersedia.</p>}
    <DataTable data={summary.rekap} columns={columns} searchPlaceholder="Cari lembaga, jenis, atau ukuran seragam..." searchKeys={["lembaga", "jenisKelamin", "jenis", "ukuran"]} horizontalNavigation exportable exportColumns={columns.map(({ key, label }) => ({ key, label }))} exportFilename="statistik-seragam-spmb" exportSheetName="Rekap Seragam" pageSize={15} emptyMessage="Belum ada rekap seragam pada filter ini" />
  </section>;
}
