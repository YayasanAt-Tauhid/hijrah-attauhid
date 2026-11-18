import { useId, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { useSeragamUangPangkal, useSiswaSeragamList, useSpmbGelombang } from "@/hooks/useSiswaSeragam";
import { useDepartemen, useTahunAjaran } from "@/hooks/useAkademikData";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ExportButton } from "@/components/shared/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SERAGAM_EXPORT_COLUMNS,
  buildSeragamSiswaRows,
  filterSeragamSiswaRows,
  rekapSeragam,
  seragamExportColumns,
  seragamExportRows,
  seragamKelengkapanLabel,
  seragamStelLabel,
  type SeragamSiswaFilters,
  type SeragamSiswaRow,
} from "@/lib/seragamSiswa";
import { formatUangPangkal, uangPangkalAmounts, uangPangkalKeterangan } from "@/lib/seragamUangPangkal";
import { MONITOR_PAYMENT_LABELS } from "@/lib/spmbPaymentMonitor";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

const KELENGKAPAN_CLASS: Record<SeragamSiswaRow["kelengkapan"], string> = {
  lengkap: "border-success/30 bg-success/10 text-success",
  belum_lengkap: "border-warning/30 bg-warning/10 text-warning",
  tidak_tersedia: "border-border bg-muted text-muted-foreground",
};

const initialFilters: SeragamSiswaFilters = {
  search: "", lembagaId: "all", kelasId: "all", jenisKelamin: "all", status: "all", kelengkapan: "all",
  tahunId: "all", gelombangId: "all", uangPangkal: "all",
};

function FilterSelect({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-[160px] space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

export default function SeragamSiswa() {
  const navigate = useNavigate();
  const { data: siswaList = [], isLoading } = useSiswaSeragamList();
  const { data: departemenList = [] } = useDepartemen();
  const { data: tahunList = [] } = useTahunAjaran();
  const { data: gelombangList = [] } = useSpmbGelombang();
  const { allowed: showUangPangkal, isLoading: uangPangkalLoading, error: uangPangkalError, byStudent } = useSeragamUangPangkal();
  const [filters, setFilters] = useState<SeragamSiswaFilters>(initialFilters);
  const set = (patch: Partial<SeragamSiswaFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const rows = useMemo(() => buildSeragamSiswaRows(siswaList, departemenList, showUangPangkal ? byStudent : undefined),
    [siswaList, departemenList, showUangPangkal, byStudent]);
  const filtered = useMemo(() => filterSeragamSiswaRows(rows, filters), [rows, filters]);
  const rekap = useMemo(() => rekapSeragam(filtered), [filtered]);

  // Pilihan filter diturunkan dari data yang boleh dilihat pengguna (admin_tu hanya lembaganya).
  const lembagaOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => row.lembagaId && map.set(row.lembagaId, row.lembaga));
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "id"));
  }, [rows]);
  const kelasOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows
      .filter((row) => filters.lembagaId === "all" || row.lembagaId === filters.lembagaId)
      .forEach((row) => row.kelasId && map.set(row.kelasId, row.kelas));
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "id", { numeric: true }));
  }, [rows, filters.lembagaId]);

  const stelColumn = (index: number): DataTableColumn<SeragamSiswaRow> => ({
    key: `stel${index + 1}`,
    label: `Stel ${index + 1}`,
    className: "min-w-[150px]",
    render: (_, row) => {
      const label = seragamStelLabel(row.stel[index]);
      return <span className={label.endsWith("Belum diisi") ? "text-muted-foreground" : undefined}>{label}</span>;
    },
  });

  const amountCell = (pick: "nominal" | "dibayar" | "sisa") => (_: unknown, row: SeragamSiswaRow) => {
    const amounts = uangPangkalAmounts(row.uangPangkal);
    return amounts ? <span className="whitespace-nowrap">{formatUangPangkal(amounts[pick])}</span> : <span className="text-muted-foreground">-</span>;
  };
  const uangPangkalColumns: DataTableColumn<SeragamSiswaRow>[] = [
    { key: "uangPangkalNominal", label: "Nominal Uang Pangkal", className: "min-w-[150px]", render: amountCell("nominal") },
    { key: "uangPangkalDibayar", label: "Jumlah Dibayar Uang Pangkal", className: "min-w-[150px]", render: amountCell("dibayar") },
    { key: "uangPangkalSisa", label: "Sisa Uang Pangkal", className: "min-w-[150px]", render: amountCell("sisa") },
    { key: "uangPangkalKeterangan", label: "Keterangan Uang Pangkal", className: "min-w-[150px]", render: (_, row) => <span className="whitespace-nowrap">{uangPangkalKeterangan(row.uangPangkal)}</span> },
  ];

  const columns: DataTableColumn<SeragamSiswaRow>[] = [
    { key: "nama", label: "Nama", sortable: true, className: "min-w-[180px] font-medium" },
    { key: "nis", label: "NIS", sortable: true, render: (value) => (value as string) || "-" },
    { key: "lembaga", label: "Lembaga", sortable: true },
    { key: "kelas", label: "Kelas", sortable: true },
    { key: "jenisKelamin", label: "Jenis Kelamin" },
    {
      key: "statusLabel", label: "Status", sortable: true,
      render: (value, row) => (
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${row.status === "aktif" ? "border-success/30 bg-success/10 text-success" : "border-info/30 bg-info/10 text-info"}`}>
          {String(value)}
        </span>
      ),
    },
    stelColumn(0), stelColumn(1), stelColumn(2), stelColumn(3), stelColumn(4),
    {
      key: "kelengkapan", label: "Kelengkapan",
      render: (_, row) => (
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${KELENGKAPAN_CLASS[row.kelengkapan]}`}>
          {seragamKelengkapanLabel(row.kelengkapan)}
        </span>
      ),
    },
    ...(showUangPangkal ? uangPangkalColumns : []),
    {
      key: "id", label: "Aksi", className: "w-16",
      render: (_, row) => (
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          title="Ubah data seragam" aria-label={`Ubah seragam ${row.nama}`}
          onClick={() => navigate(`/akademik/siswa/${row.id}/edit`)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Seragam Siswa</h1>
        <p className="text-sm text-muted-foreground">
          Daftar nama siswa aktif dan calon diterima beserta ukuran lima stel seragamnya. Ukuran diisi dan diubah lewat form data siswa (tombol pensil).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1 sm:max-w-sm">
          <Label htmlFor="seragam-cari">Cari siswa</Label>
          <Input
            id="seragam-cari" placeholder="Cari nama atau NIS..."
            value={filters.search} onChange={(event) => set({ search: event.target.value })}
          />
        </div>
        <FilterSelect label="Status" value={filters.status} onChange={(status) => set({ status })}>
          <option value="all">Aktif dan calon diterima</option>
          <option value="aktif">Aktif</option>
          <option value="diterima">Calon diterima</option>
        </FilterSelect>
        <FilterSelect label="Tahun ajaran tujuan" value={filters.tahunId} onChange={(tahunId) => set({ tahunId })}>
          <option value="all">Semua</option>
          {tahunList.map((tahun: { id: string; nama: string }) => <option key={tahun.id} value={tahun.id}>{tahun.nama}</option>)}
        </FilterSelect>
        <FilterSelect label="Gelombang" value={filters.gelombangId} onChange={(gelombangId) => set({ gelombangId })}>
          <option value="all">Semua</option>
          {gelombangList.map((gelombang: { id: string; nama: string }) => <option key={gelombang.id} value={gelombang.id}>{gelombang.nama}</option>)}
        </FilterSelect>
        {showUangPangkal && (
          <FilterSelect label="Uang pangkal" value={filters.uangPangkal} onChange={(uangPangkal) => set({ uangPangkal })}>
            <option value="all">Semua</option>
            {(Object.keys(MONITOR_PAYMENT_LABELS) as Array<keyof typeof MONITOR_PAYMENT_LABELS>).map((key) => (
              <option key={key} value={key}>{MONITOR_PAYMENT_LABELS[key]}</option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect label="Lembaga" value={filters.lembagaId} onChange={(lembagaId) => set({ lembagaId, kelasId: "all" })}>
          <option value="all">Semua lembaga</option>
          {lembagaOptions.map(([id, nama]) => <option key={id} value={id}>{nama}</option>)}
        </FilterSelect>
        <FilterSelect label="Kelas" value={filters.kelasId} onChange={(kelasId) => set({ kelasId })}>
          <option value="all">Semua kelas</option>
          {kelasOptions.map(([id, nama]) => <option key={id} value={id}>{nama}</option>)}
        </FilterSelect>
        <FilterSelect label="Jenis kelamin" value={filters.jenisKelamin} onChange={(jenisKelamin) => set({ jenisKelamin })}>
          <option value="all">Semua</option>
          <option value="L">Ikhwan</option>
          <option value="P">Akhwat</option>
        </FilterSelect>
        <FilterSelect label="Kelengkapan" value={filters.kelengkapan} onChange={(kelengkapan) => set({ kelengkapan })}>
          <option value="all">Semua</option>
          <option value="lengkap">Lengkap (5 stel)</option>
          <option value="belum_lengkap">Belum lengkap</option>
          <option value="tidak_tersedia">Data seragam TK belum tersedia</option>
        </FilterSelect>
      </div>

      {showUangPangkal && uangPangkalError && (
        <p role="alert" className="text-sm text-destructive">Data uang pangkal belum dapat dimuat. Coba muat ulang halaman.</p>
      )}
      {showUangPangkal && uangPangkalLoading && <p className="text-sm text-muted-foreground">Memuat data uang pangkal...</p>}
      <p className="text-sm text-muted-foreground">{filtered.length} siswa</p>

      <DataTable
        columns={columns}
        data={filtered}
        searchable={false}
        pageSize={25}
        loading={isLoading}
        emptyMessage="Tidak ada siswa yang cocok dengan filter ini"
        actions={<ExportButton
          data={seragamExportRows(filtered, { uangPangkal: showUangPangkal })}
          columns={showUangPangkal ? seragamExportColumns(true) : SERAGAM_EXPORT_COLUMNS}
          filename="seragam-siswa"
          sheetName="Seragam Siswa"
          extraSheets={[{ name: "Rekap Seragam", columns: rekap.columns, data: rekap.data }]}
        />}
      />
    </div>
  );
}
