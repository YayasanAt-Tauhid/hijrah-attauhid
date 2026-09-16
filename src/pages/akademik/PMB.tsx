import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { NISPreview } from "@/components/shared/NISPreview";
import { useAngkatan, useDepartemen, useKelas, useTahunAjaran } from "@/hooks/useAkademikData";
import { generateNISViaEdgeFunction } from "@/utils/nisGenerator";
import { UserPlus, Users, UserCheck, Clock, AlertTriangle, RefreshCw, Pencil, CheckCircle2, Eye } from "lucide-react";
import { fetchAllPages } from "@/lib/fetchAll";
import { toast } from "sonner";

function diagnosaNIS(row: Record<string, unknown>): { alasan?: "no_dept_angkatan" | "no_kelas" } {
  const departemenId = row.departemen_id as string | null;
  const angkatanId = row.angkatan_id as string | null;
  if (!departemenId || !angkatanId) return { alasan: "no_dept_angkatan" };
  return {};
}

function departemenPerluAsrama(dept: any): boolean {
  const kode = (dept?.kode || "").trim().toUpperCase();
  const nama = (dept?.nama || "").trim().toUpperCase();
  return ["SMP", "SMA", "MTA"].includes(kode) || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(nama);
}

function formatTanggal(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

type KesiapanPenerimaan = { siap: boolean; kekurangan: string[] };

function getKesiapanPenerimaan(row: Record<string, unknown>): KesiapanPenerimaan {
  if (row._readiness) return row._readiness as KesiapanPenerimaan;
  const kekurangan: string[] = [];
  const departemen = row.departemen as { npsn?: string | null; kode?: string | null; nama?: string | null } | null;
  const detail = row._spmbDetail as Record<string, any> | null;

  if (!row.terverifikasi) kekurangan.push("verifikasi data");
  if (!row._pmbConfigured && !row._pmbGratis) kekurangan.push("konfigurasi pembayaran SPMB");
  else if (!row._pmbLunas && !row._pmbGratis) kekurangan.push("pembayaran SPMB");
  if (!row.departemen_id) kekurangan.push("lembaga");
  if (!row.angkatan_id) kekurangan.push("angkatan");
  if (!row._punyaKelas) kekurangan.push("kelas");
  if (!departemen?.npsn) kekurangan.push("NPSN lembaga");
  if (!detail?.dokumen_kk_path) kekurangan.push("Kartu Keluarga");
  if (!detail?.dokumen_akta_path) kekurangan.push("Akta Kelahiran");
  if (departemenPerluAsrama(departemen) && !detail?.status_asrama) kekurangan.push("pilihan asrama");

  return { siap: kekurangan.length === 0, kekurangan };
}

function labelAsrama(value: string | null | undefined) {
  if (value === "asrama") return "Asrama";
  if (value === "non_asrama") return "Non Asrama";
  return "-";
}

export default function PMB() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: angkatanList = [] } = useAngkatan();
  const { data: departemenList = [] } = useDepartemen();
  const { data: kelasList = [] } = useKelas();
  const { data: tahunList = [] } = useTahunAjaran();
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nisLoadingId, setNisLoadingId] = useState<string | null>(null);
  const [milestoneLoadingId, setMilestoneLoadingId] = useState<string | null>(null);
  const [modePendaftaran, setModePendaftaran] = useState<"lengkap" | "cepat">("lengkap");
  const [formData, setFormData] = useState({
    nama: "", jenis_kelamin: "L", telepon: "", alamat: "",
    angkatan_id: "", departemen_id: "", kelas_id: "", tahun_ajaran_id: "",
  });

  const resetForm = () => setFormData({ nama: "", jenis_kelamin: "L", telepon: "", alamat: "", angkatan_id: "", departemen_id: "", kelas_id: "", tahun_ajaran_id: "" });

  const filteredKelas = kelasList.filter((k: any) => !formData.departemen_id || k.departemen_id === formData.departemen_id);
  const filteredAngkatan = angkatanList.filter((a: any) => !formData.departemen_id || a.departemen_id === formData.departemen_id);
  const selectedDept = departemenList.find((d: any) => d.id === formData.departemen_id);
  const selectedKelas = kelasList.find((k: any) => k.id === formData.kelas_id);
  const selectedAngkatan = angkatanList.find((a: any) => a.id === formData.angkatan_id);
  const canPreviewNIS = modePendaftaran === "lengkap" && selectedDept?.npsn && selectedKelas && selectedAngkatan;

  const { data: calonList = [], isLoading } = useQuery({
    queryKey: ["siswa", "calon"],
    queryFn: async () => {
      const siswaRows = await fetchAllPages<any>((from, to) => supabase
        .from("siswa").select("*, angkatan:angkatan_id(nama), departemen:departemen_id(nama,kode,npsn)")
        .in("status", ["calon", "diterima"]).order("created_at", { ascending: false }).order("id").range(from, to));
      if (!siswaRows.length) return [];

      const siswaIds = siswaRows.map((s) => s.id);
      const { data: readinessRows, error } = await (supabase as any).rpc("spmb_readiness_list", { p_ids: siswaIds });
      if (error) throw error;
      const byId = new Map<string, any>((readinessRows || []).map((r: any) => [r.siswa_id, r.readiness]));
      const { data: details, error: detailError } = await (supabase as any).from("siswa_detail")
        .select("siswa_id, status_asrama, dokumen_kk_path, dokumen_akta_path, spmb_tanggal_tes, spmb_tanggal_lulus, spmb_tanggal_daftar_ulang")
        .in("siswa_id", siswaIds);
      if (detailError) throw detailError;
      const detailById = new Map<string, any>((details || []).map((d: any) => [d.siswa_id, d]));
      return siswaRows.map((s) => {
        const r = byId.get(s.id);
        return {
          ...s,
          _readiness: r,
          _pmbConfigured: r?.configured,
          _pmbLunas: r?.lunas,
          _pmbGratis: r?.gratis_pendaftaran,
          _pmbTanggalBayar: r?.tanggal_pembayaran,
          _punyaKelas: r?.punya_kelas,
          _spmbDetail: detailById.get(s.id),
        };
      });
    },
  });

  const calonCount = calonList.filter((s: any) => s.status === "calon").length;
  const diterimaCount = calonList.filter((s: any) => s.status === "diterima").length;
  const nisKosongCount = calonList.filter((s: any) => s.status === "diterima" && !s.nis).length;
  const belumSiapCount = calonList.filter((s: any) => s.status === "calon" && !getKesiapanPenerimaan(s as Record<string, unknown>).siap).length;

  const handleDaftar = async () => {
    if (!formData.nama) { toast.error("Nama wajib diisi"); return; }
    if (!formData.departemen_id) { toast.error("Lembaga wajib dipilih"); return; }
    if (modePendaftaran === "lengkap") {
      if (!formData.angkatan_id) { toast.error("Angkatan wajib diisi (mode lengkap)"); return; }
      if (!formData.kelas_id) { toast.error("Kelas wajib diisi (mode lengkap)"); return; }
    }

    if (formData.kelas_id && !formData.tahun_ajaran_id) { toast.error("Pilih tahun ajaran untuk kelas"); return; }
    setIsSaving(true);
    try {
      const { error } = await (supabase as any).rpc("akademik_save_siswa", {
        p_siswa: { nama: formData.nama, jenis_kelamin: formData.jenis_kelamin, telepon: formData.telepon || null,
          alamat: formData.alamat || null, angkatan_id: formData.angkatan_id || null,
          departemen_id: formData.departemen_id, agama: "Islam", status: "calon" },
        p_detail: { tahun_ajaran_id: formData.tahun_ajaran_id || null },
        p_kelas: formData.kelas_id ? { kelas_id: formData.kelas_id, tahun_ajaran_id: formData.tahun_ajaran_id } : null,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["siswa"] });
      toast.success("Calon murid berhasil didaftarkan", { description: "Lengkapi biodata dan dokumen pada Edit Data sebelum penerimaan." });
      setDialogOpen(false);
      resetForm();
    } catch (e: any) { toast.error(e.message || "Gagal mendaftarkan"); }
    finally { setIsSaving(false); }
  };

  const generateNIS = async (siswaId: string, departemenId: string, angkatanId: string, namaSiswa: string): Promise<boolean> => {
    const { data: kelasSiswa } = await supabase.from("kelas_siswa").select("kelas_id").eq("siswa_id", siswaId).eq("aktif", true).maybeSingle();
    if (!kelasSiswa?.kelas_id) {
      toast.warning(`NIS belum dibuat untuk ${namaSiswa}`, { description: "Siswa belum dimasukkan ke kelas. Atur kelas melalui Data Siswa lalu buat NIS.", duration: 8000 });
      return false;
    }
    try {
      const { nis } = await generateNISViaEdgeFunction({ siswa_id: siswaId, departemen_id: departemenId, angkatan_id: angkatanId, kelas_id: kelasSiswa.kelas_id });
      toast.success(`NIS berhasil dibuat: ${nis}`, { description: namaSiswa });
      return true;
    } catch (e: any) {
      const pesan: string = e.message || "Terjadi kesalahan teknis";
      toast.error(`NIS gagal dibuat untuk ${namaSiswa}`, { description: pesan.toLowerCase().includes("npsn") ? "NPSN belum diisi pada data lembaga. Hubungi admin." : pesan, duration: 10000 });
      return false;
    }
  };

  const handleTerima = async (row: Record<string, unknown>) => {
    const kesiapan = getKesiapanPenerimaan(row);
    if (!kesiapan.siap) {
      toast.error("Calon murid belum siap diterima", { description: `Lengkapi terlebih dahulu: ${kesiapan.kekurangan.join(", ")}.` });
      return;
    }
    const id = row.id as string;
    const departemenId = row.departemen_id as string;
    const angkatanId = row.angkatan_id as string;
    const namaSiswa = row.nama as string;
    setNisLoadingId(id);
    try {
      if (!row.nis) {
        const nisBerhasil = await generateNIS(id, departemenId, angkatanId, namaSiswa);
        if (!nisBerhasil) return;
      }
      const { error: updErr } = await supabase.from("siswa").update({ status: "diterima" } as any).eq("id", id);
      if (updErr) throw updErr;
      await qc.invalidateQueries({ queryKey: ["siswa"] });
      toast.success(`${namaSiswa} berhasil diterima`, { description: "Verifikasi, dokumen, biaya pendaftaran, angkatan, kelas, dan NIS sudah lengkap." });
    } catch (e: any) {
      toast.error("Gagal menerima murid", { description: e?.message || "Terjadi kesalahan teknis" });
    } finally {
      setNisLoadingId(null);
    }
  };

  const handleBuatNIS = async (row: Record<string, unknown>) => {
    const id = row.id as string;
    const departemenId = row.departemen_id as string | null;
    const angkatanId = row.angkatan_id as string | null;
    if (!departemenId || !angkatanId) {
      toast.error("Tidak bisa membuat NIS", { description: "Lembaga dan angkatan murid belum diisi. Edit data terlebih dahulu." });
      return;
    }
    setNisLoadingId(id);
    try {
      const berhasil = await generateNIS(id, departemenId, angkatanId, row.nama as string);
      if (berhasil) qc.invalidateQueries({ queryKey: ["siswa"] });
    } finally {
      setNisLoadingId(null);
    }
  };

  const handleAktifkan = async (row: Record<string, unknown>) => {
    if (!row.nis) {
      toast.error("Murid belum siap diaktifkan", { description: "Buat NIS terlebih dahulu sebelum mengaktifkan murid." });
      return;
    }
    const { error } = await supabase.from("siswa").update({ status: "aktif" } as any).eq("id", row.id as string);
    if (error) { toast.error("Gagal mengaktifkan murid: " + error.message); return; }
    qc.invalidateQueries({ queryKey: ["siswa"] });
    toast.success("Murid diaktifkan");
  };

  const handleMilestone = async (row: Record<string, unknown>, action: "tes" | "lulus" | "daftar_ulang", label: string) => {
    const loadingKey = `${row.id}:${action}`;
    setMilestoneLoadingId(loadingKey);
    try {
      const { error } = await (supabase as any).rpc("spmb_mark_milestone", {
        p_siswa_id: row.id,
        p_action: action,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["siswa", "calon"] });
      toast.success(`${label} berhasil dicatat`, { description: row.nama as string });
    } catch (error: any) {
      toast.error(`Gagal mencatat ${label.toLowerCase()}`, { description: error?.message || "Terjadi kesalahan teknis" });
    } finally {
      setMilestoneLoadingId(null);
    }
  };

  const columns: DataTableColumn<Record<string, unknown>>[] = [
    { key: "nama", label: "Nama", sortable: true },
    {
      key: "nis", label: "NIS",
      render: (v, row) => {
        if (v) return <span className="font-mono text-xs">{v as string}</span>;
        if (row.status === "diterima") {
          const { alasan } = diagnosaNIS(row);
          return <span className="inline-flex items-center gap-1 text-xs text-warning cursor-help" title={alasan === "no_dept_angkatan" ? "Lembaga/angkatan belum diisi" : "Kelas belum diatur"}><AlertTriangle className="h-3 w-3" />Belum ada</span>;
        }
        return <span className="text-muted-foreground text-xs">-</span>;
      },
    },
    { key: "jenis_kelamin", label: "JK", render: (v) => v === "L" ? "L" : "P" },
    { key: "departemen", label: "Lembaga", render: (v: any) => v?.nama || "-" },
    { key: "_spmbDetail", label: "Asrama", render: (v: any) => labelAsrama(v?.status_asrama) },
    { key: "angkatan", label: "Angkatan", render: (v: any) => v?.nama || "-" },
    { key: "created_at", label: "Tgl Pendaftaran", render: (v) => formatTanggal(v) },
    { key: "_pmbTanggalBayar", label: "Tgl Bayar Pendaftaran", render: (v) => formatTanggal(v) },
    { key: "_spmbDetail", label: "Tgl Tes", render: (v: any) => formatTanggal(v?.spmb_tanggal_tes) },
    { key: "_spmbDetail", label: "Tgl Kelulusan", render: (v: any) => formatTanggal(v?.spmb_tanggal_lulus) },
    { key: "_spmbDetail", label: "Tgl Daftar Ulang", render: (v: any) => formatTanggal(v?.spmb_tanggal_daftar_ulang) },
    {
      key: "_pmbLunas", label: "Biaya Pendaftaran",
      render: (_, row) => {
        if (row._pmbGratis) return <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Gratis</span>;
        if (!row._pmbConfigured) return <span className="text-xs text-warning">Belum diatur</span>;
        if (row._pmbLunas) return <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Lunas</span>;
        return <span className="text-xs text-destructive">Belum bayar</span>;
      },
    },
    {
      key: "_punyaKelas", label: "Kesiapan",
      render: (_, row) => {
        const kesiapan = getKesiapanPenerimaan(row);
        return kesiapan.siap
          ? <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Siap diterima</span>
          : <span className="inline-flex items-center gap-1 text-xs text-warning cursor-help" title={`Belum lengkap: ${kesiapan.kekurangan.join(", ")}`}><AlertTriangle className="h-3.5 w-3.5" /> {kesiapan.kekurangan.length} belum lengkap</span>;
      },
    },
    {
      key: "status", label: "Status",
      render: (v, row) => {
        const s = v as string;
        const colors: Record<string, string> = { calon: "bg-warning/15 text-warning border-warning/30", diterima: "bg-info/15 text-info border-info/30" };
        return <div className="flex items-center gap-1.5"><span className={`px-2 py-0.5 rounded-full text-xs border ${colors[s] || ""}`}>{s}</span>{row.terverifikasi && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border bg-success/15 text-success border-success/30" title="Sudah diverifikasi pada Data SPMB"><CheckCircle2 className="h-3 w-3" />Verified</span>}</div>;
      },
    },
    {
      key: "id", label: "Aksi", className: "w-80",
      render: (_, row) => {
        const status = row.status as string;
        const loading = nisLoadingId === (row.id as string);
        const kesiapan = getKesiapanPenerimaan(row);
        const detail = row._spmbDetail as Record<string, any> | undefined;
        const tesLoading = milestoneLoadingId === `${row.id}:tes`;
        const lulusLoading = milestoneLoadingId === `${row.id}:lulus`;
        const daftarUlangLoading = milestoneLoadingId === `${row.id}:daftar_ulang`;
        return (
          <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => navigate(`/akademik/siswa/${row.id}`)} title="Lihat biodata, checklist verifikasi & dokumen SPMB"><Eye className="h-3 w-3" /></Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/akademik/siswa/${row.id}/edit`)} title="Edit data lengkap"><Pencil className="h-3 w-3" /></Button>
            {!detail?.spmb_tanggal_tes && <Button size="sm" variant="outline" disabled={tesLoading} onClick={() => handleMilestone(row, "tes", "Sudah Tes")}>{tesLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Sudah Tes"}</Button>}
            {detail?.spmb_tanggal_tes && !detail?.spmb_tanggal_lulus && <Button size="sm" variant="outline" disabled={lulusLoading} onClick={() => handleMilestone(row, "lulus", "Kelulusan")}>{lulusLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Lulus"}</Button>}
            {detail?.spmb_tanggal_lulus && !detail?.spmb_tanggal_daftar_ulang && <Button size="sm" variant="outline" disabled={daftarUlangLoading} onClick={() => handleMilestone(row, "daftar_ulang", "Daftar Ulang")}>{daftarUlangLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Daftar Ulang"}</Button>}
            {status === "calon" && <span title={kesiapan.kekurangan.length ? `Lengkapi: ${kesiapan.kekurangan.join(", ")}` : "Terima calon murid"}><Button size="sm" variant="outline" disabled={loading || !kesiapan.siap} onClick={() => handleTerima(row)}>{loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Terima"}</Button></span>}
            {status === "diterima" && !row.nis && <Button size="sm" variant="outline" className="border-warning/50 text-warning hover:bg-warning/10" disabled={loading} onClick={() => handleBuatNIS(row)}>{loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <><RefreshCw className="h-3 w-3 mr-1" />Buat NIS</>}</Button>}
            {status === "diterima" && <span title={!row.nis ? "Buat NIS terlebih dahulu" : "Aktifkan murid"}><Button size="sm" disabled={loading || !row.nis} onClick={() => handleAktifkan(row)}>Aktifkan</Button></span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sistem Penerimaan Murid Baru (SPMB)</h1>
          <p className="text-sm text-muted-foreground">Pantau pendaftaran, seleksi, kelulusan, daftar ulang, dan penerimaan murid baru</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild><Button><UserPlus className="h-4 w-4 mr-2" />Daftarkan Calon Murid</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Formulir Pendaftaran SPMB</DialogTitle></DialogHeader>
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-none">{modePendaftaran === "lengkap" ? "Mode lengkap" : "Mode cepat"}</p>
                <p className="text-xs text-muted-foreground">{modePendaftaran === "lengkap" ? "Kelas & angkatan wajib — NIS dibuat saat diterima" : "Kelas & angkatan opsional — lengkapi data sebelum penerimaan"}</p>
              </div>
              <Switch checked={modePendaftaran === "lengkap"} onCheckedChange={(v) => { setModePendaftaran(v ? "lengkap" : "cepat"); setFormData((f) => ({ ...f, kelas_id: "", angkatan_id: "" })); }} />
            </div>

            <div className="space-y-4">
              <div><Label>Nama Lengkap *</Label><Input value={formData.nama} onChange={(e) => setFormData({ ...formData, nama: e.target.value })} /></div>
              <div><Label>Jenis Kelamin</Label><Select value={formData.jenis_kelamin} onValueChange={(v) => setFormData({ ...formData, jenis_kelamin: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent></Select></div>
              <div>
                <Label>Lembaga/Sekolah *</Label>
                <Select value={formData.departemen_id} onValueChange={(v) => setFormData({ ...formData, departemen_id: v, kelas_id: "", angkatan_id: "" })}>
                  <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                  <SelectContent>{departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent>
                </Select>
                {selectedDept && !selectedDept.npsn && <p className="text-xs text-warning flex items-center gap-1.5 mt-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Lembaga ini belum memiliki NPSN — NIS tidak bisa dibuat otomatis.</p>}
              </div>
              <div><Label>Kelas {modePendaftaran === "lengkap" ? "*" : "(opsional)"}</Label><Select value={formData.kelas_id} onValueChange={(v) => setFormData({ ...formData, kelas_id: v })} disabled={!formData.departemen_id}><SelectTrigger><SelectValue placeholder="Pilih kelas" /></SelectTrigger><SelectContent>{filteredKelas.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Angkatan {modePendaftaran === "lengkap" ? "*" : "(opsional)"}</Label><Select value={formData.angkatan_id} onValueChange={(v) => setFormData({ ...formData, angkatan_id: v })} disabled={!formData.departemen_id}><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger><SelectContent>{filteredAngkatan.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select></div>
              {canPreviewNIS && <NISPreview npsn={selectedDept!.npsn} namaKelas={selectedKelas!.nama} namaAngkatan={selectedAngkatan!.nama} estimasiUrut={1} />}
              <div><Label>Telepon</Label><Input value={formData.telepon} onChange={(e) => setFormData({ ...formData, telepon: e.target.value })} /></div>
              <div><Label>Alamat</Label><Textarea value={formData.alamat} onChange={(e) => setFormData({ ...formData, alamat: e.target.value })} /></div>
              <div><Label>Tahun Ajaran {formData.kelas_id ? "*" : "(opsional)"}</Label><Select value={formData.tahun_ajaran_id} onValueChange={(v) => setFormData({ ...formData, tahun_ajaran_id: v })}><SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger><SelectContent>{tahunList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
              <Button className="w-full" disabled={isSaving} onClick={handleDaftar}>{isSaving ? "Menyimpan..." : "Daftarkan"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className={`grid gap-4 ${nisKosongCount > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <StatsCard title="Total Pendaftar" value={calonList.length} icon={Users} color="primary" />
        <StatsCard title="Menunggu" value={calonCount} icon={Clock} color="warning" />
        <StatsCard title="Diterima" value={diterimaCount} icon={UserCheck} color="success" />
        {nisKosongCount > 0 && <StatsCard title="NIS Belum Dibuat" value={nisKosongCount} icon={AlertTriangle} color="destructive" />}
      </div>

      {belumSiapCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div><p className="font-medium">{belumSiapCount} calon belum siap diterima</p><p className="text-muted-foreground">Verifikasi data dilakukan dari tab Data SPMB pada detail siswa. Tombol Terima aktif setelah verifikasi, dokumen wajib tersedia, biaya pendaftaran lunas atau gratis, angkatan dan kelas terisi, serta NPSN lembaga tersedia.</p></div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={calonList as Record<string, unknown>[]}
        searchPlaceholder="Cari nama calon murid..."
        loading={isLoading}
        pageSize={20}
        onRowClick={(row) => navigate(`/akademik/siswa/${row.id}`)}
      />
    </div>
  );
}
