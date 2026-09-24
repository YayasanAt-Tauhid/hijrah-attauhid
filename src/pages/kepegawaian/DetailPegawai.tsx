import { useState } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { StatsCard } from "@/components/shared/StatsCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, UserCheck, Calendar, Printer } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

const JENJANG = ["SD", "SMP", "SMA", "D3", "S1", "S2", "S3"];

export default function DetailPegawai() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canEdit = role === "admin";

  const { data: pegawai, isLoading } = useQuery({
    queryKey: ["pegawai_detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("pegawai").select("*, departemen:departemen_id(nama, kode)").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  if (!pegawai) return <p className="text-center py-8 text-muted-foreground">Pegawai tidak ditemukan</p>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => navigate("/kepegawaian/pegawai")}><ArrowLeft className="h-4 w-4 mr-2" />Kembali</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/kepegawaian/pegawai/${id}/biodata`)}><Printer className="h-4 w-4 mr-2" />Cetak Biodata</Button>
      </div>

      {/* Identity Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-5">
            <Avatar className="h-20 w-20">
              {pegawai.foto_url && <AvatarImage src={pegawai.foto_url} />}
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">{pegawai.nama?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold">{pegawai.nama}</h1>
                <Badge variant={pegawai.status === "aktif" ? "default" : "secondary"}>{pegawai.status}</Badge>
                {pegawai.departemen && <Badge variant="outline">{(pegawai.departemen as any).kode || (pegawai.departemen as any).nama}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">NIP: {pegawai.nip || "-"} • Jabatan: {pegawai.jabatan || "-"}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                <div><span className="text-muted-foreground">JK:</span> {pegawai.jenis_kelamin === "L" ? "Laki-laki" : pegawai.jenis_kelamin === "P" ? "Perempuan" : "-"}</div>
                <div><span className="text-muted-foreground">TTL:</span> {pegawai.tempat_lahir || "-"}, {pegawai.tanggal_lahir ? format(new Date(pegawai.tanggal_lahir), "dd MMM yyyy", { locale: idLocale }) : "-"}</div>
                <div><span className="text-muted-foreground">Agama:</span> {pegawai.agama || "-"}</div>
                <div><span className="text-muted-foreground">Telepon:</span> {pegawai.telepon || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Email:</span> {pegawai.email || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Alamat:</span> {pegawai.alamat || "-"}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="jabatan">
        <TabsList className="flex-wrap">
          <TabsTrigger value="jabatan">Riwayat Jabatan</TabsTrigger>
          <TabsTrigger value="golongan">Golongan/Pangkat</TabsTrigger>
          <TabsTrigger value="pendidikan">Riwayat Pendidikan</TabsTrigger>
          <TabsTrigger value="gaji">Riwayat Gaji</TabsTrigger>
          <TabsTrigger value="sertifikasi">Sertifikasi</TabsTrigger>
          <TabsTrigger value="keluarga">Data Keluarga</TabsTrigger>
          <TabsTrigger value="diklat">Diklat & Pelatihan</TabsTrigger>
          <TabsTrigger value="presensi">Presensi</TabsTrigger>
        </TabsList>
        <TabsContent value="jabatan"><TabRiwayatJabatan pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="golongan"><TabGolongan pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="pendidikan"><TabRiwayatPendidikan pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="gaji"><TabGaji pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="sertifikasi"><TabSertifikasi pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="keluarga"><TabKeluarga pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="diklat"><TabDiklat pegawaiId={id!} canEdit={canEdit} /></TabsContent>
        <TabsContent value="presensi"><TabPresensi pegawaiId={id!} /></TabsContent>
      </Tabs>
    </div>
  );
}

function TabRiwayatJabatan({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ jabatan: "", unit_kerja: "", tmt: "", sampai: "", sk_nomor: "", sk_tanggal: "", keterangan: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["riwayat_jabatan", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("riwayat_jabatan").select("*").eq("pegawai_id", pegawaiId).order("tmt", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("riwayat_jabatan").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["riwayat_jabatan"] }); toast.success("Riwayat jabatan ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const columns: DataTableColumn<any>[] = [
    { key: "jabatan", label: "Jabatan" },
    { key: "unit_kerja", label: "Unit Kerja", render: v => (v as string) || "-" },
    { key: "tmt", label: "TMT", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "sampai", label: "Sampai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "Sekarang" },
    { key: "sk_nomor", label: "No SK", render: v => (v as string) || "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ jabatan: "", unit_kerja: "", tmt: "", sampai: "", sk_nomor: "", sk_tanggal: "", keterangan: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Riwayat Jabatan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Jabatan *</Label><Input value={form.jabatan} onChange={e => setForm({ ...form, jabatan: e.target.value })} /></div>
            <div><Label>Unit Kerja</Label><Input value={form.unit_kerja} onChange={e => setForm({ ...form, unit_kerja: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>TMT</Label><Input type="date" value={form.tmt} onChange={e => setForm({ ...form, tmt: e.target.value })} /></div>
              <div><Label>Sampai</Label><Input type="date" value={form.sampai} onChange={e => setForm({ ...form, sampai: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>No SK</Label><Input value={form.sk_nomor} onChange={e => setForm({ ...form, sk_nomor: e.target.value })} /></div>
              <div><Label>Tgl SK</Label><Input type="date" value={form.sk_tanggal} onChange={e => setForm({ ...form, sk_tanggal: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tmt: form.tmt || null, sampai: form.sampai || null, sk_tanggal: form.sk_tanggal || null })} disabled={!form.jabatan || saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabRiwayatPendidikan({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ jenjang: "S1", nama_institusi: "", jurusan: "", tahun_masuk: "", tahun_lulus: "", ijazah_nomor: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["riwayat_pendidikan", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("riwayat_pendidikan").select("*").eq("pegawai_id", pegawaiId).order("tahun_lulus", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("riwayat_pendidikan").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["riwayat_pendidikan"] }); toast.success("Riwayat pendidikan ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const columns: DataTableColumn<any>[] = [
    { key: "jenjang", label: "Jenjang" },
    { key: "nama_institusi", label: "Institusi" },
    { key: "jurusan", label: "Jurusan", render: v => (v as string) || "-" },
    { key: "tahun_masuk", label: "Tahun Masuk", render: v => v ? String(v) : "-" },
    { key: "tahun_lulus", label: "Tahun Lulus", render: v => v ? String(v) : "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ jenjang: "S1", nama_institusi: "", jurusan: "", tahun_masuk: "", tahun_lulus: "", ijazah_nomor: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Riwayat Pendidikan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Jenjang *</Label><Select value={form.jenjang} onValueChange={v => setForm({ ...form, jenjang: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{JENJANG.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Nama Institusi *</Label><Input value={form.nama_institusi} onChange={e => setForm({ ...form, nama_institusi: e.target.value })} /></div>
            <div><Label>Jurusan</Label><Input value={form.jurusan} onChange={e => setForm({ ...form, jurusan: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tahun Masuk</Label><Input type="number" value={form.tahun_masuk} onChange={e => setForm({ ...form, tahun_masuk: e.target.value })} /></div>
              <div><Label>Tahun Lulus</Label><Input type="number" value={form.tahun_lulus} onChange={e => setForm({ ...form, tahun_lulus: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tahun_masuk: form.tahun_masuk ? Number(form.tahun_masuk) : null, tahun_lulus: form.tahun_lulus ? Number(form.tahun_lulus) : null })} disabled={!form.nama_institusi || saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabDiklat({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ nama_diklat: "", penyelenggara: "", tanggal_mulai: "", tanggal_selesai: "", jam_pelatihan: "", sertifikat_nomor: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["riwayat_diklat", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("riwayat_diklat").select("*").eq("pegawai_id", pegawaiId).order("tanggal_mulai", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("riwayat_diklat").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["riwayat_diklat"] }); toast.success("Diklat ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const columns: DataTableColumn<any>[] = [
    { key: "nama_diklat", label: "Nama Diklat" },
    { key: "penyelenggara", label: "Penyelenggara", render: v => (v as string) || "-" },
    { key: "tanggal_mulai", label: "Tgl Mulai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "tanggal_selesai", label: "Tgl Selesai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "jam_pelatihan", label: "Jam", render: v => v ? `${v} jam` : "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ nama_diklat: "", penyelenggara: "", tanggal_mulai: "", tanggal_selesai: "", jam_pelatihan: "", sertifikat_nomor: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Diklat</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nama Diklat *</Label><Input value={form.nama_diklat} onChange={e => setForm({ ...form, nama_diklat: e.target.value })} /></div>
            <div><Label>Penyelenggara</Label><Input value={form.penyelenggara} onChange={e => setForm({ ...form, penyelenggara: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tgl Mulai</Label><Input type="date" value={form.tanggal_mulai} onChange={e => setForm({ ...form, tanggal_mulai: e.target.value })} /></div>
              <div><Label>Tgl Selesai</Label><Input type="date" value={form.tanggal_selesai} onChange={e => setForm({ ...form, tanggal_selesai: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Jam Pelatihan</Label><Input type="number" value={form.jam_pelatihan} onChange={e => setForm({ ...form, jam_pelatihan: e.target.value })} /></div>
              <div><Label>No Sertifikat</Label><Input value={form.sertifikat_nomor} onChange={e => setForm({ ...form, sertifikat_nomor: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tanggal_mulai: form.tanggal_mulai || null, tanggal_selesai: form.tanggal_selesai || null, jam_pelatihan: form.jam_pelatihan ? Number(form.jam_pelatihan) : null })} disabled={!form.nama_diklat || saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabPresensi({ pegawaiId }: { pegawaiId: string }) {
  const now = new Date();
  const [bulan, setBulan] = useState(now.getMonth() + 1);
  const [tahun, setTahun] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ["presensi_pegawai_detail", pegawaiId, bulan, tahun],
    queryFn: async () => {
      const start = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
      const endM = bulan === 12 ? 1 : bulan + 1;
      const endY = bulan === 12 ? tahun + 1 : tahun;
      const end = `${endY}-${String(endM).padStart(2, "0")}-01`;
      const { data } = await supabase.from("presensi_pegawai").select("*").eq("pegawai_id", pegawaiId).gte("tanggal", start).lt("tanggal", end).order("tanggal");
      return data || [];
    },
  });

  const summary = {
    H: data?.filter(d => d.status === "H").length || 0,
    I: data?.filter(d => d.status === "I").length || 0,
    S: data?.filter(d => d.status === "S").length || 0,
    A: data?.filter(d => d.status === "A").length || 0,
  };
  const total = data?.length || 0;
  const persen = total ? Math.round((summary.H / total) * 100) : 0;

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "jam_masuk", label: "Jam Masuk", render: v => (v as string) || "-" },
    { key: "jam_pulang", label: "Jam Pulang", render: v => (v as string) || "-" },
    { key: "status", label: "Status", render: v => {
      const colors: Record<string, string> = { H: "text-emerald-600", I: "text-yellow-600", S: "text-blue-600", A: "text-red-600" };
      return <span className={`font-bold ${colors[v as string] || ""}`}>{v as string}</span>;
    }},
    { key: "keterangan", label: "Keterangan", render: v => (v as string) || "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end">
        <div><Label>Bulan</Label><Select value={String(bulan)} onValueChange={v => setBulan(Number(v))}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i+1} value={String(i+1)}>{["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][i]}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Tahun</Label><Input type="number" className="w-24" value={tahun} onChange={e => setTahun(Number(e.target.value))} /></div>
      </div>
      <div className="flex gap-4 text-sm">
        <span>H: <strong className="text-emerald-600">{summary.H}</strong></span>
        <span>I: <strong className="text-yellow-600">{summary.I}</strong></span>
        <span>S: <strong className="text-blue-600">{summary.S}</strong></span>
        <span>A: <strong className="text-red-600">{summary.A}</strong></span>
        <span>%Kehadiran: <strong>{persen}%</strong></span>
      </div>
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={31} />
    </div>
  );
}

// ─── Golongan/Pangkat ───
function TabGolongan({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ golongan: "", pangkat: "", tmt: "", sampai: "", sk_nomor: "", sk_tanggal: "", keterangan: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["riwayat_golongan", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("riwayat_golongan").select("*").eq("pegawai_id", pegawaiId).order("tmt", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("riwayat_golongan").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["riwayat_golongan"] }); toast.success("Riwayat golongan ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const columns: DataTableColumn<any>[] = [
    { key: "golongan", label: "Golongan" },
    { key: "pangkat", label: "Pangkat", render: v => (v as string) || "-" },
    { key: "tmt", label: "TMT", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "sampai", label: "Sampai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "Sekarang" },
    { key: "sk_nomor", label: "No SK", render: v => (v as string) || "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ golongan: "", pangkat: "", tmt: "", sampai: "", sk_nomor: "", sk_tanggal: "", keterangan: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Riwayat Golongan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Golongan *</Label><Input value={form.golongan} onChange={e => setForm({ ...form, golongan: e.target.value })} placeholder="III/a" /></div>
              <div><Label>Pangkat</Label><Input value={form.pangkat} onChange={e => setForm({ ...form, pangkat: e.target.value })} placeholder="Penata Muda" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>TMT</Label><Input type="date" value={form.tmt} onChange={e => setForm({ ...form, tmt: e.target.value })} /></div>
              <div><Label>Sampai</Label><Input type="date" value={form.sampai} onChange={e => setForm({ ...form, sampai: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>No SK</Label><Input value={form.sk_nomor} onChange={e => setForm({ ...form, sk_nomor: e.target.value })} /></div>
              <div><Label>Tgl SK</Label><Input type="date" value={form.sk_tanggal} onChange={e => setForm({ ...form, sk_tanggal: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tmt: form.tmt || null, sampai: form.sampai || null, sk_tanggal: form.sk_tanggal || null })} disabled={!form.golongan || saveMut.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Riwayat Gaji ───
function TabGaji({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ gaji_pokok: "", tunjangan: "", potongan: "", berlaku_mulai: "", berlaku_sampai: "", sk_nomor: "", keterangan: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["riwayat_gaji", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("riwayat_gaji").select("*").eq("pegawai_id", pegawaiId).order("berlaku_mulai", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("riwayat_gaji").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["riwayat_gaji"] }); toast.success("Riwayat gaji ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const fmtRp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

  const columns: DataTableColumn<any>[] = [
    { key: "gaji_pokok", label: "Gaji Pokok", render: v => fmtRp(Number(v) || 0) },
    { key: "tunjangan", label: "Tunjangan", render: v => fmtRp(Number(v) || 0) },
    { key: "potongan", label: "Potongan", render: v => fmtRp(Number(v) || 0) },
    { key: "total", label: "Total", render: v => <span className="font-semibold">{fmtRp(Number(v) || 0)}</span> },
    { key: "berlaku_mulai", label: "Mulai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "berlaku_sampai", label: "Sampai", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "Sekarang" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ gaji_pokok: "", tunjangan: "", potongan: "", berlaku_mulai: "", berlaku_sampai: "", sk_nomor: "", keterangan: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Riwayat Gaji</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Gaji Pokok *</Label><Input type="number" value={form.gaji_pokok} onChange={e => setForm({ ...form, gaji_pokok: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tunjangan</Label><Input type="number" value={form.tunjangan} onChange={e => setForm({ ...form, tunjangan: e.target.value })} /></div>
              <div><Label>Potongan</Label><Input type="number" value={form.potongan} onChange={e => setForm({ ...form, potongan: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Berlaku Mulai</Label><Input type="date" value={form.berlaku_mulai} onChange={e => setForm({ ...form, berlaku_mulai: e.target.value })} /></div>
              <div><Label>Berlaku Sampai</Label><Input type="date" value={form.berlaku_sampai} onChange={e => setForm({ ...form, berlaku_sampai: e.target.value })} /></div>
            </div>
            <div><Label>No SK</Label><Input value={form.sk_nomor} onChange={e => setForm({ ...form, sk_nomor: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ gaji_pokok: Number(form.gaji_pokok) || 0, tunjangan: Number(form.tunjangan) || 0, potongan: Number(form.potongan) || 0, berlaku_mulai: form.berlaku_mulai || null, berlaku_sampai: form.berlaku_sampai || null, sk_nomor: form.sk_nomor || null, keterangan: form.keterangan || null })} disabled={!form.gaji_pokok || saveMut.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sertifikasi ───
function TabSertifikasi({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ jenis: "", nomor_sertifikat: "", tanggal_terbit: "", tanggal_berlaku: "", penerbit: "", keterangan: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["sertifikasi_guru", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("sertifikasi_guru").select("*").eq("pegawai_id", pegawaiId).order("tanggal_terbit", { ascending: false }); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("sertifikasi_guru").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sertifikasi_guru"] }); toast.success("Sertifikasi ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const columns: DataTableColumn<any>[] = [
    { key: "jenis", label: "Jenis Sertifikasi" },
    { key: "nomor_sertifikat", label: "Nomor", render: v => (v as string) || "-" },
    { key: "penerbit", label: "Penerbit", render: v => (v as string) || "-" },
    { key: "tanggal_terbit", label: "Terbit", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "tanggal_berlaku", label: "Berlaku s/d", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "Selamanya" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ jenis: "", nomor_sertifikat: "", tanggal_terbit: "", tanggal_berlaku: "", penerbit: "", keterangan: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Sertifikasi</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Jenis Sertifikasi *</Label><Input value={form.jenis} onChange={e => setForm({ ...form, jenis: e.target.value })} placeholder="Sertifikasi Pendidik" /></div>
            <div><Label>Nomor Sertifikat</Label><Input value={form.nomor_sertifikat} onChange={e => setForm({ ...form, nomor_sertifikat: e.target.value })} /></div>
            <div><Label>Penerbit</Label><Input value={form.penerbit} onChange={e => setForm({ ...form, penerbit: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tanggal Terbit</Label><Input type="date" value={form.tanggal_terbit} onChange={e => setForm({ ...form, tanggal_terbit: e.target.value })} /></div>
              <div><Label>Berlaku Sampai</Label><Input type="date" value={form.tanggal_berlaku} onChange={e => setForm({ ...form, tanggal_berlaku: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tanggal_terbit: form.tanggal_terbit || null, tanggal_berlaku: form.tanggal_berlaku || null })} disabled={!form.jenis || saveMut.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Keluarga Pegawai ───
function TabKeluarga({ pegawaiId, canEdit }: { pegawaiId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ nama: "", hubungan: "", jenis_kelamin: "", tanggal_lahir: "", pekerjaan: "", keterangan: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["keluarga_pegawai", pegawaiId],
    queryFn: async () => { const { data } = await supabase.from("keluarga_pegawai").select("*").eq("pegawai_id", pegawaiId).order("hubungan"); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => { const { error } = await supabase.from("keluarga_pegawai").insert({ ...vals, pegawai_id: pegawaiId }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["keluarga_pegawai"] }); toast.success("Data keluarga ditambahkan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const HUBUNGAN = ["Suami", "Istri", "Anak", "Orang Tua", "Lainnya"];

  const columns: DataTableColumn<any>[] = [
    { key: "nama", label: "Nama" },
    { key: "hubungan", label: "Hubungan" },
    { key: "jenis_kelamin", label: "JK", render: v => v === "L" ? "Laki-laki" : v === "P" ? "Perempuan" : "-" },
    { key: "tanggal_lahir", label: "Tgl Lahir", render: v => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "pekerjaan", label: "Pekerjaan", render: v => (v as string) || "-" },
  ];

  return (
    <div className="space-y-4 pt-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => { setForm({ nama: "", hubungan: "", jenis_kelamin: "", tanggal_lahir: "", pekerjaan: "", keterangan: "" }); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Tambah</Button></div>}
      <DataTable columns={columns} data={data || []} loading={isLoading} searchable={false} pageSize={10} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Data Keluarga</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nama *</Label><Input value={form.nama} onChange={e => setForm({ ...form, nama: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hubungan *</Label>
                <Select value={form.hubungan} onValueChange={v => setForm({ ...form, hubungan: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>{HUBUNGAN.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Jenis Kelamin</Label>
                <Select value={form.jenis_kelamin} onValueChange={v => setForm({ ...form, jenis_kelamin: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Laki-laki</SelectItem>
                    <SelectItem value="P">Perempuan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir} onChange={e => setForm({ ...form, tanggal_lahir: e.target.value })} /></div>
              <div><Label>Pekerjaan</Label><Input value={form.pekerjaan} onChange={e => setForm({ ...form, pekerjaan: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, tanggal_lahir: form.tanggal_lahir || null, jenis_kelamin: form.jenis_kelamin || null })} disabled={!form.nama || !form.hubungan || saveMut.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
