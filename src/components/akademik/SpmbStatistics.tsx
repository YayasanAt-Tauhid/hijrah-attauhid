import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable } from "@/components/shared/DataTable";
import { summarizeSpmbAdmissions } from "@/lib/spmbAdmission";
import { Users, UserCheck, Clock, CheckCircle2, ArrowLeft, AlertTriangle } from "lucide-react";

type Registration = Record<string, unknown>;
type Option = { id: string; nama: string; kode?: string };
export type StatisticsScope = { departemen: string; tahun: string; gelombang: string };

export function SpmbStatistics({ rows, departments, years, waves, scope, onScopeChange, onOpenList, loading, error }: {
  rows: Registration[];
  departments: Option[];
  years: Option[];
  waves: Option[];
  scope: StatisticsScope;
  onScopeChange: (key: keyof StatisticsScope, value: string) => void;
  onOpenList: (filters?: Record<string, string>) => void;
  loading: boolean;
  error?: unknown;
}) {
  const summary = summarizeSpmbAdmissions(rows);
  const count = (key: string, value: unknown) => rows.filter((row) => row[key] === value).length;
  const perDepartment = departments.map((dept) => {
    const list = rows.filter((row) => row.departemen_id === dept.id);
    return { id: dept.id, lembaga: dept.kode || dept.nama, ...summarizeSpmbAdmissions(list) };
  }).filter((dept) => scope.departemen === "all" || dept.id === scope.departemen);
  const ready = (row: Registration) => (row._readiness as { siap?: boolean } | undefined)?.siap;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Statistik SPMB</h1><p className="text-sm text-muted-foreground">Penerimaan dan aktivasi murid pada periode pendaftaran yang dipilih.</p></div>
        <Button variant="outline" onClick={() => onOpenList()}><ArrowLeft className="mr-2 h-4 w-4" />Daftar Pendaftar</Button>
      </div>
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        {([
          ["departemen", "Lembaga", departments], ["tahun", "Tahun ajaran tujuan", years], ["gelombang", "Gelombang", waves],
        ] as const).map(([key, label, options]) => (
          <div key={key} className="space-y-1"><Label>{label}</Label><Select value={scope[key]} onValueChange={(value) => onScopeChange(key, value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.kode || option.nama}</SelectItem>)}</SelectContent></Select></div>
        ))}
      </div>
      {error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-destructive">Statistik tidak dapat dimuat. Silakan muat ulang halaman.</div> : loading ? <p role="status" className="py-8 text-muted-foreground">Memuat statistik SPMB…</p> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard title="Total Pendaftar" value={summary.total} icon={Users} onClick={() => onOpenList()} />
          <StatsCard title="Diterima" value={summary.accepted} icon={UserCheck} color="success" onClick={() => onOpenList({ status: "diterima" })} />
          <StatsCard title="Belum diaktifkan" value={summary.awaitingActivation} icon={Clock} color="warning" onClick={() => onOpenList({ status: "belum_aktif" })} />
          <StatsCard title="Sudah diaktifkan" value={summary.activated} icon={CheckCircle2} color="info" onClick={() => onOpenList({ status: "selesai" })} />
        </div>
        <p className="text-sm text-muted-foreground">Diterima mencakup murid yang belum maupun sudah diaktifkan. Klik kartu untuk membuka daftar yang sesuai.</p>
        <DataTable searchable={false} data={perDepartment} pageSize={10} emptyMessage="Tidak ada lembaga dalam cakupan ini" onRowClick={(row) => onOpenList({ departemen: String(row.id) })} columns={[
          { key: "lembaga", label: "Lembaga" }, { key: "total", label: "Pendaftar" },
          { key: "accepted", label: "Diterima" }, { key: "awaitingActivation", label: "Belum diaktifkan" }, { key: "activated", label: "Sudah diaktifkan" },
        ]} />
        {summary.total === 0 && <p className="text-sm text-muted-foreground">Belum ada pendaftar pada periode dan lembaga yang dipilih.</p>}
        <div><h2 className="mb-3 font-semibold">Tahapan seleksi dan kelengkapan</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard title="Belum tes" value={count("_spmbTesStatus", "belum")} icon={Clock} color="warning" onClick={() => onOpenList({ tes: "belum" })} />
          <StatsCard title="Lulus tes" value={count("_spmbStatusKelulusan", "lulus")} icon={UserCheck} color="success" onClick={() => onOpenList({ kelulusan: "lulus" })} />
          <StatsCard title="Tidak lulus tes" value={count("_spmbStatusKelulusan", "tidak_lulus")} icon={AlertTriangle} color="destructive" onClick={() => onOpenList({ kelulusan: "tidak_lulus" })} />
          <StatsCard title="Sudah daftar ulang" value={rows.filter((row) => row._spmbTanggalDaftarUlang).length} icon={CheckCircle2} color="info" onClick={() => onOpenList({ daftarUlang: "sudah" })} />
          <StatsCard title="Belum diverifikasi" value={rows.filter((row) => !row.terverifikasi).length} icon={AlertTriangle} color="warning" onClick={() => onOpenList({ verifikasi: "belum" })} />
          <StatsCard title="Calon belum lengkap" value={rows.filter((row) => row.status === "calon" && !ready(row)).length} icon={AlertTriangle} color="warning" onClick={() => onOpenList({ status: "calon", kesiapan: "belum" })} />
        </div></div>
        <div><h2 className="mb-3 font-semibold">Asrama dan jenis kelamin</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard title="Asrama" value={count("_spmbAsrama", "Asrama")} icon={Users} onClick={() => onOpenList({ asrama: "Asrama" })} />
          <StatsCard title="Non Asrama" value={count("_spmbAsrama", "Non Asrama")} icon={Users} color="warning" onClick={() => onOpenList({ asrama: "Non Asrama" })} />
          <StatsCard title="Laki-laki" value={count("jenis_kelamin", "L")} icon={Users} onClick={() => onOpenList({ jenisKelamin: "L" })} />
          <StatsCard title="Perempuan" value={count("jenis_kelamin", "P")} icon={Users} color="success" onClick={() => onOpenList({ jenisKelamin: "P" })} />
        </div></div>
        <div><h2 className="mb-3 font-semibold">Metode pendaftaran</h2><div className="grid gap-3 sm:grid-cols-3">
          <StatsCard title="Pendaftaran Online" value={count("_spmbSource", "online")} icon={Users} color="info" onClick={() => onOpenList({ sumber: "online" })} />
          <StatsCard title="Pendaftaran Offline" value={count("_spmbSource", "offline")} icon={Users} color="warning" onClick={() => onOpenList({ sumber: "offline" })} />
          <StatsCard title="Metode belum diketahui" value={count("_spmbSource", "unknown")} icon={AlertTriangle} color="warning" onClick={() => onOpenList({ sumber: "unknown" })} />
        </div></div>
      </>}
    </div>
  );
}
