import { useState } from "react";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useLembaga, formatRupiah } from "@/hooks/useKeuangan";
import { useAllAkunRekening, useCreateAkunRekening, useUpdateAkunRekening, useDeleteAkunRekening } from "@/hooks/useJurnal";
import { defaultPosIsak35, posAfterJenisChange, posIsak35Label, posIsak35Options } from "@/lib/posIsak35";

// Radix Select tidak menerima nilai kosong, jadi "kosong" diwakili penanda ini.
const POS_BELUM_DIPETAKAN = "__none__";

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

export default function TabAkunRekening() {
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
  const [pos, setPos] = useState(defaultPosIsak35("aset"));

  const openAdd = () => {
    setPos(defaultPosIsak35("aset"));
    setEditItem(null); setKode(""); setNama(""); setJenis("aset"); setSaldoNormal("D"); setSaldoAwal(""); setKeterangan(""); setAktif(true); setFormDepartemenId(""); setDialogOpen(true);
  };
  const openEdit = (item: any) => {
    setPos(item.pos_isak35 || "");
    setEditItem(item); setKode(item.kode); setNama(item.nama); setJenis(item.jenis); setSaldoNormal(normalizeSaldoNormal(item.saldo_normal)); setSaldoAwal(String(item.saldo_awal || "")); setKeterangan(item.keterangan || ""); setAktif(item.aktif !== false); setFormDepartemenId(item.departemen_id || ""); setDialogOpen(true);
  };

  const handleJenisChange = (v: string) => {
    setPos((previous) => (v === jenis ? previous : posAfterJenisChange(previous, v)));
    setJenis(v);
    setSaldoNormal(SALDO_NORMAL_MAP[v] || "D");
  };

  const handleSave = async () => {
    // Bug K4 fix: wrap try/catch agar unhandled rejection tidak terjadi di React 18
    try {
      const values = { kode, nama, jenis, pos_isak35: pos || null, saldo_normal: normalizeSaldoNormal(saldoNormal), saldo_awal: saldoAwal ? Number(saldoAwal) : 0, keterangan: keterangan || undefined, aktif, departemen_id: formDepartemenId || undefined };
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
    {
      key: "pos_isak35", label: "Pos ISAK 35",
      render: (v) => v
        ? posIsak35Label(String(v))
        : <Badge variant="outline" className="border-warning text-warning">Belum dipetakan</Badge>,
    },
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
              <Label>Pos ISAK 35</Label>
              <Select value={pos || POS_BELUM_DIPETAKAN} onValueChange={(v) => setPos(v === POS_BELUM_DIPETAKAN ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {posIsak35Options(jenis, pos).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  <SelectItem value={POS_BELUM_DIPETAKAN}>Belum dipetakan</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Menentukan bagian laporan ISAK 35 tempat akun ini tampil.</p>
              {!pos && <p role="status" className="mt-1 text-xs text-warning">Tanpa pos, akun ini tidak akan muncul di laporan ISAK 35.</p>}
            </div>
            <div>
              <Label>Lembaga (kosongkan jika shared antar lembaga)</Label>
              <SearchableSelect
                value={formDepartemenId || "__all__"}
                onValueChange={(v) => setFormDepartemenId(v === "__all__" ? "" : v)}
                placeholder="Shared (semua lembaga)"
                options={[
                  { value: "__all__", label: <>Shared (Semua Lembaga)</> },
                  ...(lembagaList?.map((l: any) => ({
                    value: l.id,
                    label: (
                      <>
                        {l.kode} — {l.nama}
                      </>
                    ),
                  })) ?? []),
                ]}
              />
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
