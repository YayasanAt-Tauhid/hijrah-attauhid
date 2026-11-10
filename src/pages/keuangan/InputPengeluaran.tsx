import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useJenisPengeluaran, usePengeluaranList, useLembaga,
  useCreatePengeluaran, useUpdatePengeluaran, useDeletePengeluaran,
  formatRupiah, terbilang,
} from "@/hooks/useKeuangan";
import { usePengaturanAkun } from "@/hooks/useJurnal";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TrendingDown, Calendar, Printer, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useNavigate } from "@/lib/router-compat";
import { getErrorMessage } from "@/lib/errorMessage";

const now = new Date();

export default function InputPengeluaran() {
  const navigate = useNavigate();
  const [filterBulan, setFilterBulan] = useState(now.getMonth() + 1);
  const [filterTahun, setFilterTahun] = useState(now.getFullYear());
  const [departemenId, setDepartemenId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cetakItem, setCetakItem] = useState<any>(null);

  // form
  const [jenisId, setJenisId] = useState("");
  const [jumlah, setJumlah] = useState("");
  const [tanggal, setTanggal] = useState(format(now, "yyyy-MM-dd"));
  const [keterangan, setKeterangan] = useState("");
  const [formDepartemenId, setFormDepartemenId] = useState("");

  const { data: lembagaList } = useLembaga();
  const { data: jenisList } = useJenisPengeluaran(formDepartemenId || undefined);
  const { data: pengeluaranList, isLoading } = usePengeluaranList(filterBulan, filterTahun, departemenId || undefined);
  const { data: pengaturanAkun } = usePengaturanAkun();
  const createMut = useCreatePengeluaran();
  const updateMut = useUpdatePengeluaran();
  const deleteMut = useDeletePengeluaran();

  // Sekolah info for print header
  const { data: sekolah } = useQuery({
    queryKey: ["sekolah"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const totalBulanIni = pengeluaranList?.reduce((s, r) => s + Number(r.jumlah || 0), 0) || 0;
  const selectedJenis = jenisList?.find((j: any) => j.id === jenisId);

  const openAdd = () => {
    setEditItem(null);
    setJenisId("");
    setJumlah("");
    setTanggal(format(now, "yyyy-MM-dd"));
    setKeterangan("");
    setFormDepartemenId(departemenId || "");
    setDialogOpen(true);
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setJenisId(item.jenis_id || "");
    setJumlah(String(item.jumlah));
    setTanggal(item.tanggal);
    setKeterangan(item.keterangan || "");
    setFormDepartemenId(item.departemen_id || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const nominalBaru = Number(jumlah);
    const values = {
      jenis_id: jenisId,
      jumlah: nominalBaru,
      tanggal,
      keterangan: keterangan || undefined,
      departemen_id: formDepartemenId || undefined,
    };

    // ── EDIT: update baris + patch jurnal yang sudah ada ──────────────────
    if (editItem) {
      await updateMut.mutateAsync({ id: editItem.id, ...values });

      // Kalau ada jurnal tertaut, update nominal & detail-nya
      if (editItem.jurnal?.id) {
        const jurnalId = editItem.jurnal.id;
        try {
          const kasAkunId  = pengaturanAkun?.find((p: any) => p.kode_setting === "kas_pengeluaran")?.akun?.id;
          // Ambil akun_beban_id: coba dari jenisList lokal, fallback query DB
          let bebanAkunId = selectedJenis?.akun_beban_id
            ?? jenisList?.find((j: any) => j.id === jenisId)?.akun_beban_id;
          if (!bebanAkunId && jenisId) {
            const { data: jenisDb } = await supabase
              .from("jenis_pengeluaran")
              .select("akun_beban_id")
              .eq("id", jenisId)
              .maybeSingle();
            bebanAkunId = (jenisDb as any)?.akun_beban_id;
          }

          // Update header jurnal
          await supabase.from("jurnal").update({
            jumlah: nominalBaru,
            total_debit: nominalBaru,
            total_kredit: nominalBaru,
            tanggal,
            keterangan: `Pengeluaran ${selectedJenis?.nama || ""}${keterangan ? " - " + keterangan : ""}`,
          }).eq("id", jurnalId);

          // Re-patch detail jika akun tersedia
          if (kasAkunId && bebanAkunId) {
            await supabase.from("jurnal_detail").delete().eq("jurnal_id", jurnalId);
            await supabase.from("jurnal_detail").insert([
              { jurnal_id: jurnalId, akun_id: bebanAkunId, keterangan: `Beban ${selectedJenis?.nama || ""}`, debit: nominalBaru, kredit: 0, urutan: 1 },
              { jurnal_id: jurnalId, akun_id: kasAkunId, keterangan: `Kas pengeluaran ${selectedJenis?.nama || ""}`, debit: 0, kredit: nominalBaru, urutan: 2 },
            ]);
          }
        } catch (e: unknown) {
          toast.warning("Pengeluaran diperbarui, tapi jurnal gagal disinkronkan: " + getErrorMessage(e));
        }
      }

      setDialogOpen(false);
      return;
    }

    // ── CREATE: simpan pengeluaran + auto-jurnal ───────────────────────────
    const kasAkunId   = pengaturanAkun?.find((p: any) => p.kode_setting === "kas_pengeluaran")?.akun?.id;
    const bebanAkunId = selectedJenis?.akun_beban_id;
    const bisaAutoJurnal = kasAkunId && bebanAkunId;

    if (!bisaAutoJurnal) {
      toast.warning("Akun jurnal belum dikonfigurasi. Pengeluaran tersimpan tanpa jurnal otomatis.");
    }

    const result = await createMut.mutateAsync(values);

    if (bisaAutoJurnal && result?.id) {
      try {
        const tahunPengeluaran = new Date(tanggal).getFullYear();
        const { data: nomorJurnal, error: rpcError } = await supabase.rpc("generate_nomor_jurnal", {
          p_prefix: "JK",
          p_tahun: tahunPengeluaran,
        });
        if (rpcError) throw rpcError;
        if (!nomorJurnal) throw new Error("Gagal mendapatkan nomor jurnal");

        const jenisNama = selectedJenis?.nama || "";
        const { data: jurnal, error: jErr } = await supabase
          .from("jurnal")
          .insert({
            nomor: nomorJurnal,
            tanggal,
            keterangan: `Pengeluaran ${jenisNama}${keterangan ? " - " + keterangan : ""}`,
            referensi: result.id,
            departemen_id: formDepartemenId || null,
            total_debit: nominalBaru,
            total_kredit: nominalBaru,
            status: "posted",
          })
          .select()
          .single();

        if (!jErr && jurnal) {
          await supabase.from("jurnal_detail").insert([
            { jurnal_id: jurnal.id, akun_id: bebanAkunId, keterangan: `Beban ${jenisNama}`, debit: nominalBaru, kredit: 0, urutan: 1 },
            { jurnal_id: jurnal.id, akun_id: kasAkunId, keterangan: `Kas pengeluaran ${jenisNama}`, debit: 0, kredit: nominalBaru, urutan: 2 },
          ]);
          await supabase.from("pengeluaran").update({ jurnal_id: jurnal.id }).eq("id", result.id);
        }
      } catch (jurnalError: unknown) {
        console.error("Auto-jurnal gagal:", jurnalError);
        toast.warning("Pengeluaran berhasil, tapi jurnal otomatis gagal dibuat.");
      }
    }

    setDialogOpen(false);
  };

  const columns: DataTableColumn<any>[] = [
    { key: "tanggal", label: "Tanggal", sortable: true, render: (v) => v ? format(new Date(v as string), "dd MMM yyyy", { locale: idLocale }) : "-" },
    { key: "jenis", label: "Jenis", render: (_, r) => (r as any).jenis_pengeluaran?.nama || "-" },
    { key: "departemen", label: "Lembaga", render: (_, r) => (r as any).departemen?.kode || "-" },
    { key: "jumlah", label: "Jumlah", render: (v) => formatRupiah(Number(v)) },
    { key: "keterangan", label: "Keterangan", render: (v) => (v as string) || "-" },
    {
      key: "jurnal", label: "Jurnal",
      render: (_, r) => {
        const j = (r as any).jurnal;
        if (j?.nomor) {
          return (
            <Badge
              className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); navigate("/keuangan/jurnal"); }}
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              {j.nomor}
            </Badge>
          );
        }
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Belum dijurnal</Badge>;
      },
    },
    {
      key: "aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId((r as any).id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCetakItem(r)}>
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pengeluaran</h1>
          <p className="text-sm text-muted-foreground">Kelola pengeluaran sekolah</p>
        </div>
        <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah Pengeluaran</Button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <Label>Lembaga</Label>
          <Select value={departemenId || "__all__"} onValueChange={(v) => setDepartemenId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Semua lembaga" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Lembaga</SelectItem>
              {lembagaList?.map((l: any) => (
                <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Bulan</Label>
          <Select value={String(filterBulan)} onValueChange={(v) => setFilterBulan(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[7,8,9,10,11,12,1,2,3,4,5,6].map((m) => (
                <SelectItem key={m} value={String(m)}>{["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][m-1]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tahun</Label>
          <Input type="number" className="w-24" value={filterTahun} onChange={(e) => setFilterTahun(Number(e.target.value))} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatsCard title="Total Pengeluaran Bulan Ini" value={formatRupiah(totalBulanIni)} icon={TrendingDown} color="destructive" />
        <StatsCard title="Jumlah Transaksi" value={pengeluaranList?.length || 0} icon={Calendar} color="info" />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={pengeluaranList || []}
            loading={isLoading}
            exportable
            exportFilename="pengeluaran"
            pageSize={20}
          />
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Pengeluaran" : "Tambah Pengeluaran"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Lembaga *</Label>
              <Select value={formDepartemenId} onValueChange={setFormDepartemenId}>
                <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                <SelectContent>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Jenis Pengeluaran</Label>
              <Select value={jenisId} onValueChange={setJenisId}>
                <SelectTrigger><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                <SelectContent>
                  {jenisList?.map((j: any) => <SelectItem key={j.id} value={j.id}>{j.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Jumlah (Rp)</Label>
              <Input type="number" value={jumlah} onChange={(e) => setJumlah(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Tanggal</Label>
              <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            <div>
              <Label>Keterangan</Label>
              <Textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Opsional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!jenisId || !jumlah || createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Hapus Pengeluaran"
        description="Data pengeluaran yang dihapus tidak dapat dikembalikan."
        onConfirm={() => {
          if (deleteId) deleteMut.mutate(deleteId);
          setDeleteId(null);
        }}
        loading={deleteMut.isPending}
      />

      {/* Cetak Bukti Pengeluaran Dialog */}
      <Dialog open={!!cetakItem} onOpenChange={() => setCetakItem(null)}>
        <DialogContent className="max-w-md print:max-w-full print:shadow-none print:border-none">
          <DialogHeader>
            <DialogTitle>Bukti Pengeluaran</DialogTitle>
          </DialogHeader>
          {cetakItem && (
            <div className="space-y-4" id="bukti-pengeluaran">
              <div className="text-center border-b-2 border-foreground pb-3">
                <h2 className="text-lg font-bold uppercase">{sekolah?.nama || "Nama Sekolah"}</h2>
                <p className="text-sm text-muted-foreground">{sekolah?.alamat || "Alamat Sekolah"}</p>
              </div>
              <h3 className="text-center font-bold underline">BUKTI PENGELUARAN</h3>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Lembaga</span>
                  <span>: {cetakItem.departemen?.nama || "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Tanggal</span>
                  <span>: {cetakItem.tanggal ? format(new Date(cetakItem.tanggal), "dd MMMM yyyy", { locale: idLocale }) : "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Jenis</span>
                  <span>: {cetakItem.jenis_pengeluaran?.nama || "-"}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Jumlah</span>
                  <span className="font-bold">: {formatRupiah(Number(cetakItem.jumlah))}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Terbilang</span>
                  <span className="italic">: {terbilang(Number(cetakItem.jumlah))}</span>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-1">
                  <span className="text-muted-foreground">Keterangan</span>
                  <span>: {cetakItem.keterangan || "-"}</span>
                </div>
              </div>
              <div className="pt-6 flex justify-end">
                <div className="text-center text-sm">
                  <p className="mb-16">Dibuat oleh,</p>
                  <p className="font-bold">________________________</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCetakItem(null)}>Tutup</Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Cetak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
