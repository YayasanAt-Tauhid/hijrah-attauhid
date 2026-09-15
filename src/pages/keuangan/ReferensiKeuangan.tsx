import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useAllJenisPembayaran, useCreateJenisPembayaran, useUpdateJenisPembayaran, useDeleteJenisPembayaran,
  useAllJenisPengeluaran, useCreateJenisPengeluaran, useUpdateJenisPengeluaran, useDeleteJenisPengeluaran,
  useTahunAjaran, useCreateTahunAjaran, useUpdateTahunAjaran, useDeleteTahunAjaran, useAktifkanTahunAjaran,
  useTahunBuku, useCreateTahunBuku, useUpdateTahunBuku, useDeleteTahunBuku, useAktifkanTahunBuku,
  useLembaga, formatRupiah,
} from "@/hooks/useKeuangan";
import { useAllAkunRekening, useCreateAkunRekening, useUpdateAkunRekening, useDeleteAkunRekening, useAkunByJenis, usePengaturanAkun, useUpdatePengaturanAkun, useCreatePengaturanAkun, useDeletePengaturanAkun } from "@/hooks/useJurnal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, AlertTriangle, Save, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import TabTarifTagihan from "./TabTarifTagihan";
import TabSkemaDiskon from "./TabSkemaDiskon";

export default function ReferensiKeuangan() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Referensi Keuangan</h1>
        <p className="text-sm text-muted-foreground">Kelola jenis penerimaan dan pengeluaran</p>
      </div>
      <Tabs defaultValue="penerimaan">
        <TabsList className="flex-wrap">
          <TabsTrigger value="penerimaan">Jenis Penerimaan</TabsTrigger>
          <TabsTrigger value="pengeluaran">Jenis Pengeluaran</TabsTrigger>
          <TabsTrigger value="akun">Akun Rekening</TabsTrigger>
          <TabsTrigger value="pengaturan-akun">Pengaturan Akun</TabsTrigger>
          <TabsTrigger value="tahun-buku">Tahun Buku</TabsTrigger>
          <TabsTrigger value="program-dana">Program Dana</TabsTrigger>
          <TabsTrigger value="tarif">Tarif Tagihan</TabsTrigger>
          <TabsTrigger value="skema-diskon">Skema Diskon</TabsTrigger>
          <TabsTrigger value="template">Template Nomor</TabsTrigger>
        </TabsList>
        <TabsContent value="penerimaan"><TabJenisPembayaran /></TabsContent>
        <TabsContent value="pengeluaran"><TabJenisPengeluaran /></TabsContent>
        <TabsContent value="akun"><TabAkunRekening /></TabsContent>
        <TabsContent value="pengaturan-akun"><TabPengaturanAkun /></TabsContent>
        <TabsContent value="tahun-buku"><TabTahunBuku /></TabsContent>
        <TabsContent value="program-dana"><TabProgramDana /></TabsContent>
        <TabsContent value="tarif"><TabTarifTagihan /></TabsContent>
        <TabsContent value="skema-diskon"><TabSkemaDiskon /></TabsContent>
        <TabsContent value="template"><TabTemplateNomor /></TabsContent>
      </Tabs>
    </div>
  );
}

function TabJenisPembayaran() {
  const { data, isLoading } = useAllJenisPembayaran();
  const { data: lembagaList } = useLembaga();
  const [filterLembaga, setFilterLembaga] = useState("");
  const dataFiltered = useMemo(() => {
    if (!data) return data;
    if (!filterLembaga) return data;
    if (filterLembaga === "__umum__") return data.filter((j: any) => !j.departemen_id);
    return data.filter((j: any) => j.departemen_id === filterLembaga);
  }, [data, filterLembaga]);
  const { data: akunPendapatanList } = useAkunByJenis("pendapatan");
  const { data: akunLiabilitasList } = useAkunByJenis("liabilitas");
  const createMut = useCreateJenisPembayaran();
  const updateMut = useUpdateJenisPembayaran();
  const deleteMut = useDeleteJenisPembayaran();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [nominal, setNominal] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [aktif, setAktif] = useState(true);
  const [formDepartemenId, setFormDepartemenId] = useState("");
  const [akunPendapatanId, setAkunPendapatanId] = useState("");
  const [akunDimukaId, setAkunDimukaId] = useState("");
  const [perluDimuka, setPerluDimuka] = useState(true);
  const [tipe, setTipe] = useState("bulanan");
  const [tahunMasukDari, setTahunMasukDari] = useState("");
  const [tahunMasukSampai, setTahunMasukSampai] = useState("");

  const openAdd = () => { setEditItem(null); setNama(""); setNominal(""); setKeterangan(""); setAktif(true); setFormDepartemenId(""); setAkunPendapatanId(""); setAkunDimukaId(""); setPerluDimuka(true); setTipe("bulanan"); setTahunMasukDari(""); setTahunMasukSampai(""); setDialogOpen(true); };
  const openEdit = (item: any) => {
    setEditItem(item); setNama(item.nama); setNominal(String(item.nominal || "")); setKeterangan(item.keterangan || ""); setAktif(item.aktif !== false); setFormDepartemenId(item.departemen_id || ""); setAkunPendapatanId(item.akun_pendapatan_id || ""); setAkunDimukaId(item.akun_dimuka_id || ""); setPerluDimuka(item.perlu_dimuka !== false); setTipe(item.tipe || "bulanan");
    setTahunMasukDari(item.tahun_masuk_dari != null ? String(item.tahun_masuk_dari) : "");
    setTahunMasukSampai(item.tahun_masuk_sampai != null ? String(item.tahun_masuk_sampai) : "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const values = {
      nama, nominal: nominal ? Number(nominal) : undefined, keterangan: keterangan || undefined, aktif,
      departemen_id: formDepartemenId || undefined, akun_pendapatan_id: akunPendapatanId || null, perlu_dimuka: perluDimuka, akun_dimuka_id: perluDimuka ? (akunDimukaId || null) : null, tipe,
      tahun_masuk_dari: tahunMasukDari ? Number(tahunMasukDari) : null,
      tahun_masuk_sampai: tahunMasukSampai ? Number(tahunMasukSampai) : null,
    };
    if (editItem) await updateMut.mutateAsync({ id: editItem.id, ...values });
    else await createMut.mutateAsync(values);
    setDialogOpen(false);
  };

  const columns: DataTableColumn<any>[] = [
    { key: "nama", label: "Nama", sortable: true },
    { key: "nominal", label: "Nominal", render: (v) => v ? formatRupiah(Number(v)) : "-" },
    { key: "tipe", label: "Tipe", render: (v) => v === "sekali" ? <Badge variant="secondary">Sekali Bayar</Badge> : <Badge variant="outline">Bulanan</Badge> },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "Semua" },
    {
      key: "tahun_masuk", label: "Tahun Masuk",
      render: (_, r) => {
        const dari = (r as any).tahun_masuk_dari;
        const sampai = (r as any).tahun_masuk_sampai;
        if (!dari && !sampai) return <span className="text-xs text-muted-foreground">Semua</span>;
        if (dari && sampai) return <span className="text-sm">{dari}–{sampai}</span>;
        if (dari) return <span className="text-sm">≥ {dari}</span>;
        return <span className="text-sm">≤ {sampai}</span>;
      },
    },
    {
      key: "akun_pendapatan", label: "Akun Pendapatan",
      render: (_, r) => {
        const akun = (r as any).akun_pendapatan;
        if (akun) return <span className="text-sm">{akun.kode} - {akun.nama}</span>;
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Belum diset</Badge>;
      },
    },
    {
      key: "akun_dimuka", label: "Akun Dimuka",
      render: (_, r) => {
        if ((r as any).perlu_dimuka === false) return <span className="text-xs text-muted-foreground">Tidak digunakan</span>;
        const akun = (r as any).akun_dimuka;
        if (akun) return <span className="text-sm">{akun.kode} - {akun.nama}</span>;
        return <span className="text-xs text-muted-foreground">Global</span>;
      },
    },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    { key: "aktif", label: "Status", render: (v) => <span className={v ? "text-success" : "text-muted-foreground"}>{v ? "Aktif" : "Nonaktif"}</span> },
    {
      key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId((r as any).id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <div className="w-56">
              <Label className="text-xs">Filter Lembaga</Label>
              <Select value={filterLembaga || "__all__"} onValueChange={(v) => setFilterLembaga(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Lembaga</SelectItem>
                  <SelectItem value="__umum__">— Umum (semua lembaga) —</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterLembaga && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setFilterLembaga("")}>
                Reset Filter
              </Button>
            )}
          </div>
          <DataTable
            columns={columns}
            data={dataFiltered || []}
            loading={isLoading}
            pageSize={20}
            actions={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah</Button>}
          />
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Jenis Penerimaan</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nama</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} /></div>
            <div><Label>Nominal (Rp)</Label><Input type="number" value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="0" /></div>
            <div>
              <Label>Tipe Pembayaran</Label>
              <Select value={tipe} onValueChange={setTipe}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bulanan">Bulanan (12x/tahun)</SelectItem>
                  <SelectItem value="sekali">Sekali Bayar</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Bulanan = SPP dll. Sekali Bayar = uang pangkal, pendaftaran dll.</p>
            </div>
            <div>
              <Label>Lembaga (kosongkan jika berlaku untuk semua)</Label>
              <Select value={formDepartemenId || "__all__"} onValueChange={(v) => setFormDepartemenId(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Lembaga</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tahun Masuk (kosongkan jika berlaku untuk semua tahun masuk)</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Input type="number" value={tahunMasukDari} onChange={(e) => setTahunMasukDari(e.target.value)} placeholder="Dari (mis. 2024)" />
                <Input type="number" value={tahunMasukSampai} onChange={(e) => setTahunMasukSampai(e.target.value)} placeholder="Sampai (mis. 2025)" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Tahun ajaran siswa PERTAMA KALI masuk ke jenjang/lembaga yang ditempatinya sekarang (dihitung otomatis dari riwayat kelas, bukan angkatan) —
                mis. "Uang Gedung Baru" cuma berlaku untuk siswa yang masuk tahun 2024–2025. Siswa naik jenjang (mis. SD ke SMP) otomatis mengikuti tahun dia masuk jenjang barunya.
              </p>
            </div>
            <div>
              <Label>Akun Pendapatan (untuk jurnal otomatis)</Label>
              <Select value={akunPendapatanId || "__none__"} onValueChange={(v) => setAkunPendapatanId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Pilih akun pendapatan..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Tidak diset —</SelectItem>
                  {akunPendapatanList?.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.kode} - {a.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Akun yang di-kredit saat menerima pembayaran jenis ini</p>
            </div>
            <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Switch
        checked={perluDimuka}
        onCheckedChange={(checked) => {
          setPerluDimuka(checked);
          if (!checked) setAkunDimukaId("");
        }}
      />
      <Label>Gunakan Pendapatan Dimuka</Label>
    </div>
    <p className="text-xs text-muted-foreground">
      Aktifkan hanya jika pembayaran sebelum jatuh tempo belum boleh diakui sebagai pendapatan dan harus dicatat sebagai liabilitas.
    </p>
  </div>
  {perluDimuka ? (
    <div>
      <Label>Akun Pendapatan Dimuka (untuk pembayaran di muka)</Label>
      <Select value={akunDimukaId || "__none__"} onValueChange={(v) => setAkunDimukaId(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder="Pilih akun dimuka..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Pakai setting global —</SelectItem>
          {akunLiabilitasList?.map((a: any) => (
            <SelectItem key={a.id} value={a.id}>{a.kode} - {a.nama}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground mt-1">Akun liabilitas yang di-kredit saat pembayaran memang harus ditangguhkan. Kosongkan untuk pakai setting AKUN_PENDAPATAN_DIMUKA.</p>
    </div>
  ) : (
    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      Akun Pendapatan Dimuka tidak digunakan untuk jenis penerimaan ini. Pembayaran yang belum membentuk piutang akan langsung dikredit ke akun pendapatan di atas.
    </div>
  )}
            <div><Label>Keterangan</Label><Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!nama}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus / Nonaktifkan Jenis Penerimaan" description="Jika belum pernah digunakan, jenis penerimaan akan dihapus. Jika sudah terkait transaksi atau tagihan, data akan dinonaktifkan agar histori keuangan tetap utuh." confirmLabel="Hapus / Nonaktifkan" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </>
  );
}

function TabJenisPengeluaran() {
  const { data, isLoading } = useAllJenisPengeluaran();
  const { data: lembagaList } = useLembaga();
  const { data: akunBebanList } = useAkunByJenis("beban");
  const createMut = useCreateJenisPengeluaran();
  const updateMut = useUpdateJenisPengeluaran();
  const deleteMut = useDeleteJenisPengeluaran();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [aktif, setAktif] = useState(true);
  const [formDepartemenId, setFormDepartemenId] = useState("");
  const [akunBebanId, setAkunBebanId] = useState("");

  const openAdd = () => { setEditItem(null); setNama(""); setKeterangan(""); setAktif(true); setFormDepartemenId(""); setAkunBebanId(""); setDialogOpen(true); };
  const openEdit = (item: any) => { setEditItem(item); setNama(item.nama); setKeterangan(item.keterangan || ""); setAktif(item.aktif !== false); setFormDepartemenId(item.departemen_id || ""); setAkunBebanId(item.akun_beban_id || ""); setDialogOpen(true); };

  const handleSave = async () => {
    const values = { nama, keterangan: keterangan || undefined, aktif, departemen_id: formDepartemenId || undefined, akun_beban_id: akunBebanId || null };
    if (editItem) await updateMut.mutateAsync({ id: editItem.id, ...values });
    else await createMut.mutateAsync(values);
    setDialogOpen(false);
  };

  const columns: DataTableColumn<any>[] = [
    { key: "nama", label: "Nama", sortable: true },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "Semua" },
    {
      key: "akun_beban", label: "Akun Beban",
      render: (_, r) => {
        const akun = (r as any).akun_beban;
        if (akun) return <span className="text-sm">{akun.kode} - {akun.nama}</span>;
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Belum diset</Badge>;
      },
    },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    { key: "aktif", label: "Status", render: (v) => <span className={v ? "text-success" : "text-muted-foreground"}>{v ? "Aktif" : "Nonaktif"}</span> },
    {
      key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId((r as any).id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data || []}
            loading={isLoading}
            pageSize={20}
            actions={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah</Button>}
          />
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Jenis Pengeluaran</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nama</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} /></div>
            <div>
              <Label>Lembaga (kosongkan jika berlaku untuk semua)</Label>
              <Select value={formDepartemenId || "__all__"} onValueChange={(v) => setFormDepartemenId(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Semua lembaga" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Lembaga</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Akun Beban (untuk jurnal otomatis)</Label>
              <Select value={akunBebanId || "__none__"} onValueChange={(v) => setAkunBebanId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Pilih akun beban..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Tidak diset —</SelectItem>
                  {akunBebanList?.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.kode} - {a.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Akun yang di-debit saat ada pengeluaran jenis ini</p>
            </div>
            <div><Label>Keterangan</Label><Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!nama}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Jenis Pengeluaran" description="Yakin ingin menghapus?" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </>
  );
}

// ─── Konfigurasi filter per setting bawaan ───
const BUILTIN_SETTINGS = ["kas_tunai", "bank_midtrans", "kas_pengeluaran", "piutang_siswa", "tabungan_siswa", "tabungan_pegawai", "AKUN_PENDAPATAN_DIMUKA"];

const SETTING_FILTER: Record<string, { filterFn: (a: any) => boolean; hint: string }> = {
  kas_tunai: { filterFn: (a) => a.jenis === "aset" && a.kode?.startsWith("1-100"), hint: "Akun tempat uang masuk saat siswa bayar di kasir" },
  bank_midtrans: { filterFn: (a) => a.jenis === "aset" && a.kode?.startsWith("1-100"), hint: "Akun bank yang menerima dana pembayaran online" },
  kas_pengeluaran: { filterFn: (a) => a.jenis === "aset" && a.kode?.startsWith("1-100"), hint: "Akun kas yang berkurang saat ada pengeluaran" },
  piutang_siswa: { filterFn: (a) => a.jenis === "aset", hint: "Akun piutang saat tagihan siswa dibuat tapi belum dibayar" },
  tabungan_siswa: { filterFn: (a) => a.jenis === "liabilitas", hint: "Akun dana titipan/tabungan siswa (kewajiban sekolah)" },
  tabungan_pegawai: { filterFn: (a) => a.jenis === "liabilitas", hint: "Akun dana titipan/tabungan pegawai (kewajiban sekolah)" },
  AKUN_PENDAPATAN_DIMUKA: { filterFn: (a) => a.jenis === "liabilitas", hint: "Akun liabilitas untuk pembayaran SPP tahun ajaran mendatang (Unearned Revenue)" },
};

// ─── Tab Pengaturan Akun Sistem ───
function TabPengaturanAkun() {
  const { data: settings, isLoading } = usePengaturanAkun();
  const { data: allAkun } = useAllAkunRekening();
  const updateMut = useUpdatePengaturanAkun();
  const createMut = useCreatePengaturanAkun();
  const deleteMut = useDeletePengaturanAkun();
  const [values, setValues] = useState<Record<string, string>>({});
  // Bug K3 fix: flag agar useEffect tidak overwrite nilai yang sudah diedit user
  const [userEdited, setUserEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newKode, setNewKode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newKeterangan, setNewKeterangan] = useState("");

  useEffect(() => {
    // Bug K3 fix: hanya sync dari server jika user belum mengedit
    if (settings && !userEdited) {
      const map: Record<string, string> = {};
      settings.forEach((s: any) => { map[s.kode_setting] = s.akun_id || ""; });
      setValues(map);
    }
  }, [settings, userEdited]);

  // Bug K1 fix: reset userEdited saat tab unmount → saat user kembali, data segar dari server di-sync
  useEffect(() => {
    return () => { setUserEdited(false); };
  }, []);

  const activeAkun = allAkun?.filter((a: any) => a.aktif) || [];

  const getFilteredAkun = (kodeSetting: string) => {
    const cfg = SETTING_FILTER[kodeSetting];
    if (cfg) return activeAkun.filter(cfg.filterFn);
    return activeAkun; // custom settings show all
  };

  const getHint = (setting: any) => {
    const cfg = SETTING_FILTER[setting.kode_setting];
    return cfg?.hint || setting.keterangan || "";
  };

  const hasUnset = settings?.some((s: any) => !s.akun_id);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const s of (settings || [])) {
        const newVal = values[s.kode_setting] || null;
        if (s.akun_id !== newVal) {
          await updateMut.mutateAsync({ kode_setting: s.kode_setting, akun_id: newVal });
        }
      }
      toast.success("Pengaturan akun berhasil disimpan");
      setUserEdited(false); // Bug K3 fix: reset flag setelah save sukses → next refetch boleh sync
    } catch {
      // handled by mutation
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustom = async () => {
    if (!newKode || !newLabel) return;
    await createMut.mutateAsync({ kode_setting: newKode, label: newLabel, keterangan: newKeterangan || undefined });
    setAddOpen(false);
    setNewKode("");
    setNewLabel("");
    setNewKeterangan("");
  };

  if (isLoading) {
    return <Card className="mt-4"><CardContent className="pt-6"><div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded" />)}</div></CardContent></Card>;
  }

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6 space-y-6">
          {hasUnset && (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                ⚠️ Beberapa akun sistem belum dikonfigurasi. Jurnal otomatis tidak akan berjalan sampai semua akun diset.
              </AlertDescription>
            </Alert>
          )}

          {settings?.map((setting: any) => {
            const filteredAkun = getFilteredAkun(setting.kode_setting);
            const isBuiltin = BUILTIN_SETTINGS.includes(setting.kode_setting);
            return (
              <div key={setting.id} className="space-y-2 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">{setting.label}</Label>
                    <Badge variant="outline" className="ml-2 text-xs">{setting.kode_setting}</Badge>
                  </div>
                  {!isBuiltin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(setting.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{getHint(setting)}</p>
                <Select
                  value={values[setting.kode_setting] || "__none__"}
                  onValueChange={(v) => {
                    setUserEdited(true); // Bug K3 fix
                    setValues(prev => ({ ...prev, [setting.kode_setting]: v === "__none__" ? "" : v }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Belum diset —</SelectItem>
                    {filteredAkun.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.kode} - {a.nama} ({a.jenis})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setting.akun && (
                  <p className="text-xs text-muted-foreground">Saat ini: <span className="font-medium">{setting.akun.kode} - {setting.akun.nama}</span></p>
                )}
              </div>
            );
          })}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Setting Custom
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tambah Setting Akun Custom</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Kode Setting</Label>
              <Input value={newKode} onChange={(e) => setNewKode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="contoh: kas_cadangan" />
              <p className="text-xs text-muted-foreground mt-1">Huruf kecil, angka, dan underscore saja</p>
            </div>
            <div>
              <Label>Label / Nama</Label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="contoh: Akun Kas Cadangan" />
            </div>
            <div>
              <Label>Keterangan (opsional)</Label>
              <Textarea value={newKeterangan} onChange={(e) => setNewKeterangan(e.target.value)} placeholder="Deskripsi fungsi setting ini..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Batal</Button>
            <Button onClick={handleAddCustom} disabled={!newKode || !newLabel || createMut.isPending}>
              {createMut.isPending ? "Menyimpan..." : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Hapus Setting Akun"
        description="Yakin ingin menghapus setting akun custom ini?"
        onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }}
      />
    </>
  );
}

const JENIS_OPTIONS = [
  { value: "aset", label: "Aset" },
  { value: "liabilitas", label: "Liabilitas" },
  { value: "ekuitas", label: "Ekuitas" },
  { value: "pendapatan", label: "Pendapatan" },
  { value: "beban", label: "Beban" },
];

const SALDO_NORMAL_MAP: Record<string, string> = {
  aset: "D", liabilitas: "K", ekuitas: "K", pendapatan: "K", beban: "D",
};

const normalizeSaldoNormal = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "k" || normalized === "kredit" || normalized === "credit" ? "K" : "D";
};

function TabAkunRekening() {
  const { data, isLoading } = useAllAkunRekening();
  const { data: lembagaList } = useLembaga();
  const createMut = useCreateAkunRekening();
  const updateMut = useUpdateAkunRekening();
  const deleteMut = useDeleteAkunRekening();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [jenis, setJenis] = useState("aset");
  const [saldoNormal, setSaldoNormal] = useState("D");
  const [saldoAwal, setSaldoAwal] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [aktif, setAktif] = useState(true);
  const [formDepartemenId, setFormDepartemenId] = useState("");

  const openAdd = () => {
    setEditItem(null); setKode(""); setNama(""); setJenis("aset"); setSaldoNormal("D"); setSaldoAwal(""); setKeterangan(""); setAktif(true); setFormDepartemenId(""); setDialogOpen(true);
  };
  const openEdit = (item: any) => {
    setEditItem(item); setKode(item.kode); setNama(item.nama); setJenis(item.jenis); setSaldoNormal(normalizeSaldoNormal(item.saldo_normal)); setSaldoAwal(String(item.saldo_awal || "")); setKeterangan(item.keterangan || ""); setAktif(item.aktif !== false); setFormDepartemenId(item.departemen_id || ""); setDialogOpen(true);
  };

  const handleJenisChange = (v: string) => {
    setJenis(v);
    setSaldoNormal(SALDO_NORMAL_MAP[v] || "D");
  };

  const handleSave = async () => {
    // Bug K4 fix: wrap try/catch agar unhandled rejection tidak terjadi di React 18
    try {
      const values = { kode, nama, jenis, saldo_normal: normalizeSaldoNormal(saldoNormal), saldo_awal: saldoAwal ? Number(saldoAwal) : 0, keterangan: keterangan || undefined, aktif, departemen_id: formDepartemenId || undefined };
      if (editItem) await updateMut.mutateAsync({ id: editItem.id, ...values });
      else await createMut.mutateAsync(values);
      setDialogOpen(false);
    } catch {
      // Error sudah ditangani oleh onError di masing-masing mutation (toast ditampilkan)
    }
  };

  const jenisLabel: Record<string, string> = { aset: "Aset", liabilitas: "Liabilitas", ekuitas: "Ekuitas", pendapatan: "Pendapatan", beban: "Beban" };

  const columns: DataTableColumn<any>[] = [
    { key: "kode", label: "Kode", sortable: true },
    { key: "nama", label: "Nama", sortable: true },
    { key: "jenis", label: "Jenis", render: (v) => jenisLabel[v as string] || String(v) },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "Shared" },
    { key: "saldo_normal", label: "Saldo Normal", render: (v) => <span className="capitalize">{v as string}</span> },
    { key: "saldo_awal", label: "Saldo Awal", render: (v) => formatRupiah(Number(v) || 0) },
    { key: "aktif", label: "Status", render: (v) => <span className={v ? "text-success" : "text-muted-foreground"}>{v ? "Aktif" : "Nonaktif"}</span> },
    {
      key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId((r as any).id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <DataTable columns={columns} data={data || []} loading={isLoading} pageSize={20} actions={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah</Button>} />
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Akun Rekening</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Kode *</Label><Input value={kode} onChange={(e) => setKode(e.target.value)} placeholder="1-1001" /></div>
            <div><Label>Nama *</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Kas Tunai" /></div>
            <div>
              <Label>Jenis</Label>
              <Select value={jenis} onValueChange={handleJenisChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JENIS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lembaga (kosongkan jika shared antar lembaga)</Label>
              <Select value={formDepartemenId || "__all__"} onValueChange={(v) => setFormDepartemenId(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Shared (semua lembaga)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Shared (Semua Lembaga)</SelectItem>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Saldo Normal</Label>
              <Select value={saldoNormal} onValueChange={setSaldoNormal}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="D">Debit</SelectItem>
                  <SelectItem value="K">Kredit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Saldo Awal (Rp)</Label><Input type="number" value={saldoAwal} onChange={(e) => setSaldoAwal(e.target.value)} placeholder="0" /></div>
            <div><Label>Keterangan</Label><Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!kode || !nama}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Akun Rekening" description="Yakin ingin menghapus akun ini? Akun yang sudah digunakan dalam jurnal tidak bisa dihapus." onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </>
  );
}

function TabTahunBuku() {
  const { data, isLoading } = useTahunBuku();
  const createMut = useCreateTahunBuku();
  const updateMut = useUpdateTahunBuku();
  const deleteMut = useDeleteTahunBuku();
  const aktifkanMut = useAktifkanTahunBuku();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [tanggalMulai, setTanggalMulai] = useState("");
  const [tanggalSelesai, setTanggalSelesai] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [aktif, setAktif] = useState(false);

  const openAdd = () => {
    setEditItem(null); setNama(""); setTanggalMulai(""); setTanggalSelesai(""); setKeterangan(""); setAktif(false); setDialogOpen(true);
  };
  const openEdit = (item: any) => {
    setEditItem(item); setNama(item.nama); setTanggalMulai(item.tanggal_mulai || ""); setTanggalSelesai(item.tanggal_selesai || ""); setKeterangan(item.keterangan || ""); setAktif(item.aktif === true); setDialogOpen(true);
  };

  const handleSave = async () => {
    const values = { nama, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai, keterangan: keterangan || undefined, aktif };
    if (editItem) await updateMut.mutateAsync({ id: editItem.id, ...values });
    else await createMut.mutateAsync(values);
    setDialogOpen(false);
  };

  const columns: DataTableColumn<any>[] = [
    { key: "nama", label: "Nama", sortable: true },
    { key: "tanggal_mulai", label: "Mulai", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "tanggal_selesai", label: "Selesai", render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    {
      key: "aktif", label: "Status",
      render: (v, r: any) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!!v}
            onCheckedChange={(checked) => {
              if (checked) {
                aktifkanMut.mutate({ id: r.id, nama: r.nama });
              }
            }}
            disabled={!!v}
          />
          <span className={v ? "text-success font-medium" : "text-muted-foreground"}>
            {v ? "Aktif" : "Nonaktif"}
          </span>
        </div>
      ),
    },
    {
      key: "aksi", label: "Aksi",
      render: (_, r: any) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data || []}
            loading={isLoading}
            pageSize={20}
            actions={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah</Button>}
          />
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Tahun Ajaran</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nama Tahun Ajaran *</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="2025/2026" /></div>
            <div><Label>Tanggal Mulai *</Label><Input type="date" value={tanggalMulai} onChange={(e) => setTanggalMulai(e.target.value)} /></div>
            <div><Label>Tanggal Selesai *</Label><Input type="date" value={tanggalSelesai} onChange={(e) => setTanggalSelesai(e.target.value)} /></div>
            <div><Label>Keterangan</Label><Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Jadikan Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!nama || !tanggalMulai || !tanggalSelesai}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Hapus Tahun Ajaran"
        description="Yakin ingin menghapus tahun ajaran ini?"
        onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }}
      />
    </>
  );
}

// ─── Tab Template Nomor Kuitansi / Jurnal ───
function TabTemplateNomor() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  // Bug K3 fix: jangan overwrite editan user saat React Query refetch di background
  const [userEdited, setUserEdited] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["pengaturan_template"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pengaturan_template")
        .select("*")
        .order("kode_template");
      if (error) throw error;
      return data as any[];
    },
  });

  useEffect(() => {
    // Bug K3 fix: hanya sync dari server jika user belum mengedit
    if (templates && !userEdited) {
      const map: Record<string, string> = {};
      templates.forEach((t: any) => { map[t.kode_template] = t.template; });
      setValues(map);
    }
  }, [templates, userEdited]);

  // Bug K1 fix: reset flag saat unmount → saat user kembali, data segar dari server di-sync
  useEffect(() => {
    return () => { setUserEdited(false); };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const t of templates || []) {
        const newVal = values[t.kode_template];
        if (newVal !== undefined && newVal !== t.template) {
          const { error } = await supabase
            .from("pengaturan_template")
            .update({ template: newVal })
            .eq("id", t.id);
          if (error) throw error;
        }
      }
      qc.invalidateQueries({ queryKey: ["pengaturan_template"] });
      toast.success("Template berhasil disimpan");
      setUserEdited(false); // Bug K3 fix: reset flag → next refetch boleh sync
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <Card className="mt-4"><CardContent className="pt-6"><div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded" />)}</div></CardContent></Card>;
  }

  return (
    <Card className="mt-4">
      <CardContent className="pt-6 space-y-6">
        <Alert>
          <FileText className="h-4 w-4" />
          <AlertDescription>
            Variabel yang tersedia: <code className="text-primary font-mono text-xs">{"{TAHUN}"}</code> <code className="text-primary font-mono text-xs">{"{BULAN}"}</code> <code className="text-primary font-mono text-xs">{"{NOMOR}"}</code> <code className="text-primary font-mono text-xs">{"{LEMBAGA}"}</code>
            <br />
            Contoh: <code className="font-mono text-xs">KWT-{"{TAHUN}"}-{"{BULAN}"}-{"{NOMOR}"}</code> → <span className="font-medium">KWT-2026-03-001</span>
          </AlertDescription>
        </Alert>

        {(templates || []).map((t: any) => (
          <div key={t.kode_template} className="space-y-2 p-4 border rounded-lg">
            <Label className="text-base font-semibold">{t.label}</Label>
            {t.keterangan && <p className="text-sm text-muted-foreground">{t.keterangan}</p>}
            <Input
              value={values[t.kode_template] || ""}
              onChange={(e) => {
                setUserEdited(true); // Bug K3 fix
                setValues(prev => ({ ...prev, [t.kode_template]: e.target.value }));
              }}
              placeholder={t.template}
              className="font-mono"
            />
          </div>
        ))}

        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Menyimpan..." : "Simpan Template"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Tab Program Dana ───
const JENIS_DANA_OPTIONS = [
  { value: "terikat_temporer", label: "Terikat Sementara", description: "Dana donasi dengan tujuan/batas waktu tertentu (contoh: PALESTINA, AYO BERSEDEKAH)" },
  { value: "terikat_permanen", label: "Terikat Permanen", description: "Dana wakaf/endowment yang tidak boleh habis pokoknya" },
  { value: "lintas_unit", label: "Lintas Unit", description: "Program yang mencakup lebih dari satu unit (contoh: SUBSIDI SILANG)" },
];

const JENIS_DANA_BADGE: Record<string, { label: string; className: string }> = {
  terikat_temporer: { label: "Terikat Sementara", className: "bg-info/15 text-info border-info/30" },
  terikat_permanen: { label: "Terikat Permanen", className: "bg-destructive/15 text-destructive border-destructive/30" },
  lintas_unit: { label: "Lintas Unit", className: "bg-warning/15 text-warning border-warning/30" },
};

function TabProgramDana() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["program_dana"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("program_dana") as any).select("*").order("kode");
      if (error) throw error;
      return data as any[];
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [jenisDana, setJenisDana] = useState("terikat_temporer");
  const [keterangan, setKeterangan] = useState("");
  const [aktif, setAktif] = useState(true);

  const openAdd = () => { setEditItem(null); setKode(""); setNama(""); setJenisDana("terikat_temporer"); setKeterangan(""); setAktif(true); setDialogOpen(true); };
  const openEdit = (item: any) => { setEditItem(item); setKode(item.kode); setNama(item.nama); setJenisDana(item.jenis_dana); setKeterangan(item.keterangan || ""); setAktif(item.aktif !== false); setDialogOpen(true); };

  const handleSave = async () => {
    if (!kode.trim() || !nama.trim()) { toast.error("Kode dan Nama wajib diisi"); return; }
    const payload = { kode: kode.trim(), nama: nama.trim(), jenis_dana: jenisDana, keterangan: keterangan || null, aktif };
    let error;
    if (editItem) {
      ({ error } = await (supabase.from("program_dana") as any).update(payload).eq("id", editItem.id));
    } else {
      ({ error } = await (supabase.from("program_dana") as any).insert(payload));
    }
    if (error) { toast.error("Gagal menyimpan: " + error.message); return; }
    toast.success(editItem ? "Program dana diperbarui" : "Program dana ditambahkan");
    queryClient.invalidateQueries({ queryKey: ["program_dana"] });
    setDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await (supabase.from("program_dana") as any).delete().eq("id", deleteId);
    if (error) toast.error("Gagal menghapus: " + error.message);
    else toast.success("Program dana dihapus");
    queryClient.invalidateQueries({ queryKey: ["program_dana"] });
    setDeleteId(null);
  };

  const columns: DataTableColumn<any>[] = [
    { key: "kode", label: "Kode", sortable: true },
    { key: "nama", label: "Nama", sortable: true },
    {
      key: "jenis_dana", label: "Jenis Dana",
      render: (v) => {
        const cfg = JENIS_DANA_BADGE[v as string];
        return cfg ? <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge> : String(v);
      },
    },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    { key: "aktif", label: "Status", render: (v) => <span className={v ? "text-success" : "text-muted-foreground"}>{v ? "Aktif" : "Nonaktif"}</span> },
    {
      key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId((r as any).id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data || []}
            loading={isLoading}
            pageSize={20}
            actions={<Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah</Button>}
          />
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Program Dana</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Kode *</Label><Input value={kode} onChange={(e) => setKode(e.target.value)} placeholder="PALESTINA" /></div>
            <div><Label>Nama *</Label><Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Dana Bantuan Palestina" /></div>
            <div>
              <Label>Jenis Dana</Label>
              <Select value={jenisDana} onValueChange={setJenisDana}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JENIS_DANA_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {JENIS_DANA_OPTIONS.find(o => o.value === jenisDana)?.description}
              </p>
            </div>
            <div><Label>Keterangan</Label><Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
            <div className="flex items-center gap-2"><Switch checked={aktif} onCheckedChange={setAktif} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!kode || !nama}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Program Dana" description="Yakin ingin menghapus program dana ini?" onConfirm={handleDelete} />
    </>
  );
}
