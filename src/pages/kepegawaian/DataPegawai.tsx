import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLembaga } from "@/hooks/useKeuangan";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ImportPegawaiDialog } from "@/pages/kepegawaian/ImportPegawaiDialog";
import { Plus, Pencil, Trash2, Users, UserCheck, GraduationCap, Briefcase, Eye, Upload } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";

const AGAMA_OPTIONS = ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"];

type PegawaiRow = Record<string, unknown> & {
  id: string;
  nip: string | null;
  nama: string;
  jenis_kelamin: string | null;
  tempat_lahir: string | null;
  tanggal_lahir: string | null;
  agama: string | null;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
  foto_url: string | null;
  jabatan: string | null;
  departemen_id: string | null;
  status: string | null;
  dept_kode: string | null;
  dept_nama: string | null;
};

export default function DataPegawai() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = role === "admin";
  const canDelete = role === "admin";

  const [filterLembaga, setFilterLembaga] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editItem, setEditItem] = useState<PegawaiRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    nip: "", nama: "", jenis_kelamin: "", tempat_lahir: "", tanggal_lahir: "",
    agama: "", jabatan: "", alamat: "", telepon: "", email: "",
    departemen_id: "__yayasan", status: "aktif",
  });
  const [fotoFile, setFotoFile] = useState<File | null>(null);

  const { data: lembagaList } = useLembaga();

  const { data: pegawaiList, isLoading } = useQuery({
    queryKey: ["pegawai_list", filterLembaga],
    queryFn: async () => {
      let q = supabase
        .from("pegawai")
        .select("*, departemen:departemen_id(nama, kode)")
        .order("nama");

      if (filterLembaga === "yayasan") {
        q = q.is("departemen_id", null);
      } else if (filterLembaga !== "all") {
        q = q.eq("departemen_id", filterLembaga);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        dept_kode: r.departemen?.kode || null,
        dept_nama: r.departemen?.nama || null,
      })) as PegawaiRow[];
    },
  });

  const filtered = filterStatus === "all"
    ? pegawaiList || []
    : (pegawaiList || []).filter((p) => p.status === filterStatus);

  // Stats
  const totalPegawai = filtered.length;
  const totalAktif = filtered.filter((p) => p.status === "aktif").length;
  const totalGuru = filtered.filter((p) => (p.jabatan || "").toLowerCase().includes("guru")).length;
  const totalTenaga = totalAktif - totalGuru;

  // Mutations
  const saveMut = useMutation({
    mutationFn: async (values: any) => {
      let foto_url = editItem?.foto_url || null;

      if (fotoFile) {
        const ext = fotoFile.name.split(".").pop();
        const path = `${crypto.randomUUID()}-${fotoFile.name}`;
        const { error: upErr } = await supabase.storage.from("avatars-pegawai").upload(path, fotoFile);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("avatars-pegawai").getPublicUrl(path);
        foto_url = urlData.publicUrl;
      }

      const payload = { ...values, foto_url };

      if (editItem) {
        const { error } = await supabase.from("pegawai").update(payload).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pegawai").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pegawai_list"] });
      toast.success(editItem ? "Pegawai berhasil diperbarui" : "Pegawai berhasil ditambahkan");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pegawai").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pegawai_list"] });
      toast.success("Pegawai berhasil dihapus");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openAdd = () => {
    setEditItem(null);
    setForm({
      nip: "", nama: "", jenis_kelamin: "", tempat_lahir: "", tanggal_lahir: "",
      agama: "", jabatan: "", alamat: "", telepon: "", email: "",
      departemen_id: "__yayasan", status: "aktif",
    });
    setFotoFile(null);
    setDialogOpen(true);
  };

  const openEdit = (p: PegawaiRow) => {
    setEditItem(p);
    setForm({
      nip: p.nip || "", nama: p.nama, jenis_kelamin: p.jenis_kelamin || "",
      tempat_lahir: p.tempat_lahir || "", tanggal_lahir: p.tanggal_lahir || "",
      agama: p.agama || "", jabatan: p.jabatan || "", alamat: p.alamat || "",
      telepon: p.telepon || "", email: p.email || "",
      departemen_id: p.departemen_id || "__yayasan", status: p.status || "aktif",
    });
    setFotoFile(null);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.nama.trim()) { toast.error("Nama wajib diisi"); return; }
    if (!form.jabatan.trim()) { toast.error("Jabatan wajib diisi"); return; }
    const { departemen_id, ...rest } = form;
    saveMut.mutate({
      ...rest,
      departemen_id: departemen_id === "__yayasan" ? null : departemen_id,
    });
  };

  const columns: DataTableColumn<PegawaiRow>[] = [
    {
      key: "nama", label: "Pegawai", sortable: true,
      render: (_v, row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {row.foto_url && <AvatarImage src={row.foto_url} />}
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {row.nama.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">{row.nama}</p>
            <p className="text-xs text-muted-foreground">{row.nip || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "dept_kode", label: "Lembaga", sortable: true,
      render: (_v, row) => row.dept_kode || <span className="text-muted-foreground italic">Yayasan</span>,
    },
    { key: "jabatan", label: "Jabatan", sortable: true, render: (v) => (v as string) || "—" },
    {
      key: "status", label: "Status",
      render: (_v, row) => (
        <Badge variant={row.status === "aktif" ? "default" : "secondary"}>
          {row.status === "aktif" ? "Aktif" : "Nonaktif"}
        </Badge>
      ),
    },
  ];

  columns.push({
    key: "_aksi", label: "Aksi",
    render: (_v, row) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/kepegawaian/pegawai/${row.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
        {canEdit && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(row.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    ),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Pegawai</h1>
          <p className="text-sm text-muted-foreground">Kelola data pegawai seluruh lembaga</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />Import Data Pegawai
            </Button>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah Pegawai</Button>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label>Lembaga</Label>
          <Select value={filterLembaga} onValueChange={setFilterLembaga}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Lembaga</SelectItem>
              <SelectItem value="yayasan">Pegawai Yayasan</SelectItem>
              {lembagaList?.map((l: any) => (
                <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="aktif">Aktif</SelectItem>
              <SelectItem value="nonaktif">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Total Pegawai" value={totalPegawai} icon={Users} color="primary" />
        <StatsCard title="Aktif" value={totalAktif} icon={UserCheck} color="success" />
        <StatsCard title="Guru" value={totalGuru} icon={GraduationCap} color="info" />
        <StatsCard title="Tenaga Kependidikan" value={totalTenaga} icon={Briefcase} color="warning" />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filtered}
            loading={isLoading}
            searchable
            searchPlaceholder="Cari nama atau NIP..."
            exportable
            exportFilename="data-pegawai"
            pageSize={20}
          />
        </CardContent>
      </Card>

      <ImportPegawaiDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        lembagaList={(lembagaList || []) as any[]}
        onImported={() => qc.invalidateQueries({ queryKey: ["pegawai_list"] })}
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Pegawai" : "Tambah Pegawai"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>NIP</Label>
                <Input value={form.nip} onChange={(e) => setForm({ ...form, nip: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Lembaga</Label>
              <Select value={form.departemen_id} onValueChange={(v) => setForm({ ...form, departemen_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__yayasan">Pegawai Yayasan / Lintas Lembaga</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Jenis Kelamin</Label>
                <Select value={form.jenis_kelamin} onValueChange={(v) => setForm({ ...form, jenis_kelamin: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Laki-laki</SelectItem>
                    <SelectItem value="P">Perempuan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Agama</Label>
                <Select value={form.agama} onValueChange={(v) => setForm({ ...form, agama: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    {AGAMA_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tempat Lahir</Label>
                <Input value={form.tempat_lahir} onChange={(e) => setForm({ ...form, tempat_lahir: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tanggal Lahir</Label>
                <Input type="date" value={form.tanggal_lahir} onChange={(e) => setForm({ ...form, tanggal_lahir: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Jabatan *</Label>
              <Input value={form.jabatan} onChange={(e) => setForm({ ...form, jabatan: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label>Alamat</Label>
              <Textarea value={form.alamat} onChange={(e) => setForm({ ...form, alamat: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Telepon</Label>
                <Input value={form.telepon} onChange={(e) => setForm({ ...form, telepon: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aktif">Aktif</SelectItem>
                  <SelectItem value="nonaktif">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Foto</Label>
              <Input type="file" accept="image/*" onChange={(e) => setFotoFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Hapus Pegawai"
        description="Data pegawai yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus?"
        onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
