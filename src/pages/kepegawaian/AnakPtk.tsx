import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getAnakPtkData } from "@/server/anakPtk";
import type { AnakPtkSelection } from "@/server/anakPtkData";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

const warningLabels: Record<string, string> = {
  kelas_belum_ada: "Belum ada kelas pada Tahun Ajaran pilihan",
  kelas_ganda: "Lebih dari satu kelas aktif",
  pegawai_nonaktif: "Ada orang tua pegawai nonaktif",
  nik_orangtua_sama: "Identitas ayah dan ibu sama",
  pegawai_ganda: "Kecocokan pegawai ambigu",
};
const statusLabels = { belum_diisi: "Belum diisi", sudah_diisi: "Sudah diisi", perlu_tinjauan: "Perlu tinjauan" };
const rupiah = (nominal: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(nominal);

export default function AnakPtk() {
  const { role, user } = useAuth();
  const [selection, setSelection] = useState<AnakPtkSelection>({});
  const [department, setDepartment] = useState("jenis");
  const [tarifFilter, setTarifFilter] = useState("all");
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["anak_ptk_report", user?.id, role, selection],
    enabled: role === "admin",
    queryFn: () => getAnakPtkData({ data: selection }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (role !== "admin") return <p role="alert">Halaman ini hanya tersedia untuk admin.</p>;

  const jenis = data?.options.jenis.find(row => row.id === data.selection.jenisId);
  const departmentId = department === "jenis" ? jenis?.departemen_id : department === "all" ? null : department;
  const relevant = (error ? [] : data?.items || []).filter(row => !departmentId || row.departemenId === departmentId);
  const filtered = relevant.filter(row => tarifFilter === "all"
    || (tarifFilter === "peringatan" ? row.peringatan.length > 0 : row.tarifStatus === tarifFilter));
  const rows = filtered.map(row => ({
    ...row,
    orangTuaDisplay: row.orangTua.map(parent => parent.nama + " (" + parent.hubungan + ", " + parent.status + ")").join("; "),
    tarifDisplay: statusLabels[row.tarifStatus],
    nominalDisplay: row.nominalTarif === null ? "—" : rupiah(row.nominalTarif),
    catatanDisplay: [
      "Perlu verifikasi",
      ...row.peringatan.map(warning => warningLabels[warning] || warning),
      row.tarifUmumTersedia && row.tarifStatus === "belum_diisi" ? "Tarif umum tersedia; tarif per siswa untuk Tahun Buku ini belum diisi" : "",
    ].filter(Boolean).join("; "),
  }));
  type Row = typeof rows[number];
  const columns: DataTableColumn<Row>[] = [
    { key: "nama", label: "Siswa", sortable: true },
    { key: "nis", label: "NIS", sortable: true },
    { key: "kelas", label: "Kelas pada TA pilihan", sortable: true },
    { key: "orangTuaDisplay", label: "Orang tua pegawai" },
    { key: "tarifDisplay", label: "Tarif per siswa", render: (_v, row) => <Badge variant={row.tarifStatus === "sudah_diisi" ? "secondary" : "outline"}>{row.tarifDisplay}</Badge> },
    { key: "nominalDisplay", label: "Nominal" },
    { key: "catatanDisplay", label: "Pemeriksaan" },
  ];
  const change = (key: keyof AnakPtkSelection, value: string) => {
    // Carry the currently resolved defaults forward when changing one filter.
    setSelection({ ...(data?.selection || selection), [key]: value });
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Kandidat Anak PTK</h1>
        <p className="text-sm text-muted-foreground">Pemeriksaan hubungan orang tua pegawai dan kesiapan tarif per Tahun Buku.</p>
      </div>
      <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}><RefreshCw className="mr-2 h-4 w-4" />Muat ulang</Button>
    </div>
    <div className="rounded-md border p-4 text-sm space-y-1">
      <p>Kecocokan identitas merupakan kandidat, belum merupakan persetujuan keringanan. Semua hasil perlu diverifikasi.</p>
      <p>Tahun Ajaran menentukan kelas; Tahun Buku menentukan tarif. Tarif umum atau tarif siswa tanpa tahun tidak dianggap tarif per siswa untuk Tahun Buku pilihan.</p>
      <p>Daftar dibaca dari data terbaru. Tidak ada tarif, diskon, atau tagihan yang dibuat dari halaman ini. Pencatatan hasil verifikasi permanen belum tersedia.</p>
    </div>
    {error && <div role="alert" className="rounded-md border border-destructive p-4 text-sm text-destructive">
      Gagal memuat laporan. {error instanceof Error ? error.message : "Periksa sesi admin dan coba lagi."}
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1"><Label>Tahun Ajaran (kelas)</Label><SearchableSelect placeholder="Pilih Tahun Ajaran" value={data?.selection.tahunAjaranId} disabled={isFetching}
        options={(data?.options.tahunAjaran || []).map(row => ({ value: row.id, label: row.nama + (row.ditutup ? " — ditutup" : "") }))}
        onValueChange={value => change("tahunAjaranId", value)} /></div>
      <div className="space-y-1"><Label>Tahun Buku (tarif)</Label><SearchableSelect placeholder="Pilih Tahun Buku" value={data?.selection.tahunBukuId} disabled={isFetching}
        options={(data?.options.tahunBuku || []).map(row => ({ value: row.id, label: row.nama + (row.ditutup ? " — ditutup" : "") }))}
        onValueChange={value => change("tahunBukuId", value)} /></div>
      <div className="space-y-1"><Label>Jenis tagihan</Label><SearchableSelect placeholder="Pilih jenis tagihan" value={data?.selection.jenisId} disabled={isFetching}
        options={(data?.options.jenis || []).map(row => ({ value: row.id, label: row.nama }))}
        onValueChange={value => change("jenisId", value)} /></div>
      <div className="space-y-1"><Label>Lembaga siswa</Label><SearchableSelect placeholder="Pilih lembaga" value={department}
        options={[{ value: "jenis", label: "Ikuti lembaga jenis tagihan" }, { value: "all", label: "Semua lembaga" }, ...(data?.options.departemen || []).map(row => ({ value: row.id, label: row.kode + " — " + row.nama }))]}
        onValueChange={setDepartment} /></div>
      <div className="space-y-1"><Label>Kesiapan tarif</Label><SearchableSelect placeholder="Pilih kesiapan tarif" value={tarifFilter}
        options={[{ value: "all", label: "Semua kandidat" }, { value: "belum_diisi", label: "Tarif per siswa belum diisi" }, { value: "perlu_tinjauan", label: "Tarif perlu tinjauan" }, { value: "sudah_diisi", label: "Tarif sudah diisi" }, { value: "peringatan", label: "Data perlu diperiksa" }]}
        onValueChange={setTarifFilter} /></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {[["Kandidat sesuai lembaga pilihan", relevant.length], ["Tarif per siswa belum diisi", relevant.filter(row => row.tarifStatus === "belum_diisi").length], ["Data atau tarif perlu tinjauan", relevant.filter(row => row.peringatan.length || row.tarifStatus === "perlu_tinjauan").length]].map(([label, value]) =>
        <Card key={String(label)}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{error ? "—" : isPending ? "…" : value}</p></CardContent></Card>)}
    </div>
    {data && !error && <p className="text-sm text-muted-foreground">
      Cakupan seluruh sekolah: {data.coverage.siswaAktif} siswa aktif; {data.coverage.siswaTanpaNikOrangtuaValid} belum memiliki identitas orang tua valid untuk pencocokan;
      {" "}{data.coverage.pegawaiAktifTanpaNik} dari {data.coverage.pegawaiAktif} pegawai aktif belum memiliki NIK.
      {" "}Siswa yang belum cocok tidak otomatis berarti bukan anak PTK.
    </p>}
    <Card><CardContent className="pt-6"><DataTable columns={columns} data={rows} loading={isPending}
      searchPlaceholder="Cari nama siswa, NIS, kelas, atau pegawai..." pageSize={20}
      exportable={!error && Boolean(data)} exportFilename="kandidat-anak-ptk"
      emptyMessage={error ? "Laporan belum tersedia." : "Tidak ada kandidat sesuai filter. Periksa cakupan dan kelengkapan data."} /></CardContent></Card>
    {data && !error && <p className="text-xs text-muted-foreground">Data dibaca: {new Date(data.dibacaPada).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Muat ulang setelah perubahan data pegawai, orang tua, kelas, atau tarif.</p>}
  </div>;
}
