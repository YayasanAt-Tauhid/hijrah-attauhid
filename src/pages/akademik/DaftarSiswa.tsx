import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { useSiswaList, useDeleteSiswa, SiswaWithRelations } from "@/hooks/useSiswa";
import { useDepartemen, useTingkat, useKelas, useTahunAjaran, useAngkatan } from "@/hooks/useAkademikData";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ImportSiswaDialog } from "@/pages/akademik/ImportSiswaDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Eye, Pencil, Trash2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

function siswaDetail(siswa: SiswaWithRelations): any {
  const detail = siswa.siswa_detail;
  if (Array.isArray(detail)) return detail[0] || null;
  return detail || null;
}

function labelAsrama(value: string | null | undefined) {
  if (value === "asrama") return "Asrama";
  if (value === "non_asrama") return "Non Asrama";
  return "-";
}

export default function DaftarSiswa() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: siswaList = [], isLoading } = useSiswaList();
  const { data: departemenList = [] } = useDepartemen();
  const { data: tingkatList = [] } = useTingkat();
  const { data: kelasList = [] } = useKelas();
  const { data: tahunAjaranList = [] } = useTahunAjaran();
  const { data: angkatanList = [] } = useAngkatan();
  const deleteSiswa = useDeleteSiswa();

  const [filterDept, setFilterDept] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterAsrama, setFilterAsrama] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<SiswaWithRelations | null>(null);
  const [showImport, setShowImport] = useState(false);

  const getActiveKelas = (siswa: SiswaWithRelations) => {
    const active = siswa.kelas_siswa?.find((ks) => ks.aktif);
    return active?.kelas;
  };

  const filtered = useMemo(() => {
    let result = siswaList;
    if (filterDept !== "all") {
      result = result.filter((s) => {
        const kelas = getActiveKelas(s);
        return kelas?.departemen?.id === filterDept || s.departemen_id === filterDept;
      });
    }
    if (filterStatus !== "all") result = result.filter((s) => s.status === filterStatus);
    if (filterAsrama !== "all") {
      result = result.filter((s) => siswaDetail(s)?.status_asrama === filterAsrama);
    }
    return result;
  }, [siswaList, filterDept, filterStatus, filterAsrama]);

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: "nis", label: "NIS", sortable: true },
    {
      key: "foto_url", label: "Foto", className: "w-12",
      render: (val, row) => (
        <Avatar className="h-8 w-8">
          <AvatarImage src={val as string} />
          <AvatarFallback className="text-xs">{(row.nama as string)?.charAt(0)}</AvatarFallback>
        </Avatar>
      ),
    },
    { key: "nama", label: "Nama", sortable: true },
    { key: "_kelas", label: "Kelas", sortable: true, render: (_, row) => (row as any)._kelas || "-" },
    { key: "_tingkat", label: "Tingkat", sortable: true, render: (_, row) => (row as any)._tingkat || "-" },
    { key: "_departemen", label: "Departemen", sortable: true, render: (_, row) => (row as any)._departemen || "-" },
    { key: "_asrama", label: "Asrama", render: (_, row) => (row as any)._asrama || "-" },
    {
      key: "status", label: "Status",
      render: (val) => <StatusBadge status={val as string || "aktif"} type="siswa" />,
    },
    {
      key: "id", label: "Aksi", className: "w-28",
      render: (_, row) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/akademik/siswa/${row.id}`)} title="Lihat data lengkap">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/akademik/siswa/${row.id}/edit`)} title="Edit data lengkap">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(row as any)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const tableData = filtered.map((s) => {
    const kelas = getActiveKelas(s);
    const detail = siswaDetail(s);
    return {
      ...s,
      _kelas: kelas?.nama || "-",
      _tingkat: kelas?.tingkat?.nama || "-",
      _departemen: kelas?.departemen?.nama || departemenList.find((d: any) => d.id === s.departemen_id)?.nama || "-",
      _asrama: labelAsrama(detail?.status_asrama),
    } as Record<string, unknown>;
  });

  const handleExportExcel = () => {
    const exportData = filtered.map((s) => {
      const kelas = getActiveKelas(s);
      const detail = siswaDetail(s);
      return {
        NIS: s.nis || "",
        Nama: s.nama,
        "Jenis Kelamin": s.jenis_kelamin === "L" ? "Laki-laki" : s.jenis_kelamin === "P" ? "Perempuan" : "",
        Kelas: kelas?.nama || "",
        Tingkat: kelas?.tingkat?.nama || "",
        Departemen: kelas?.departemen?.nama || departemenList.find((d: any) => d.id === s.departemen_id)?.nama || "",
        Angkatan: s.angkatan?.nama || "",
        Kategori: detail?.kategori || "",
        Asrama: detail?.status_asrama ? labelAsrama(detail.status_asrama) : "",
        Status: s.status || "",
        Telepon: s.telepon || "",
        Email: s.email || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Siswa");
    XLSX.writeFile(wb, "data-siswa.xlsx");
    toast.success("File Excel berhasil diunduh");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Siswa</h1>
          <p className="text-sm text-muted-foreground">Kelola data master, akademik, dan riwayat SPMB siswa</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}><Upload className="h-4 w-4 mr-2" /> Import Data Siswa</Button>
          <Button onClick={() => navigate("/akademik/siswa/tambah")}><Plus className="h-4 w-4 mr-2" /> Tambah Siswa</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Departemen" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Departemen</SelectItem>
            {departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="calon">Calon</SelectItem>
            <SelectItem value="diterima">Diterima</SelectItem>
            <SelectItem value="aktif">Aktif</SelectItem>
            <SelectItem value="alumni">Alumni</SelectItem>
            <SelectItem value="pindah">Pindah</SelectItem>
            <SelectItem value="keluar">Keluar</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterAsrama} onValueChange={setFilterAsrama}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Asrama" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Asrama</SelectItem>
            <SelectItem value="asrama">Asrama</SelectItem>
            <SelectItem value="non_asrama">Non Asrama</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={handleExportExcel}><Download className="h-4 w-4 mr-2" /> Export Excel</Button>
      </div>

      <DataTable
        columns={columns}
        data={tableData}
        searchPlaceholder="Cari NIS atau nama siswa..."
        pageSize={20}
        exportable
        exportFilename="data-siswa"
        loading={isLoading}
        onRowClick={(row) => navigate(`/akademik/siswa/${row.id}`)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus Siswa"
        description={`Yakin ingin menghapus data siswa "${deleteTarget?.nama}"? Tindakan ini tidak dapat dibatalkan.`}
        onConfirm={() => {
          if (deleteTarget) {
            deleteSiswa.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        confirmLabel="Hapus"
        variant="destructive"
      />

      <ImportSiswaDialog
        open={showImport}
        onOpenChange={setShowImport}
        departemenList={departemenList}
        tingkatList={tingkatList}
        kelasList={kelasList}
        tahunAjaranList={tahunAjaranList}
        angkatanList={angkatanList}
        onImported={() => queryClient.invalidateQueries({ queryKey: ["siswa"] })}
      />
    </div>
  );
}
