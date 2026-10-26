import { deleteWithApproval, deletionMessage } from "@/lib/dataDeletion";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartemen, useKelas, useTahunAjaran, useSemester } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useParams } from "@/lib/router-compat";
import LaporanPencapaian from "./cbe/LaporanPencapaian";
import RemedialPengayaan from "./cbe/RemedialPengayaan";

export default function CBE() {
  const { tab } = useParams();
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">CBE</h1>
        <p className="text-sm text-muted-foreground">Competency-Based Education — Penilaian berbasis Kompetensi Dasar</p>
      </div>
      <Tabs defaultValue={tab || "setup-kd"}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="setup-kd">Setup KD</TabsTrigger>
          <TabsTrigger value="setup-kkm">Setup KKM</TabsTrigger>
          <TabsTrigger value="input-nilai">Input Nilai KD</TabsTrigger>
          <TabsTrigger value="laporan">Laporan Pencapaian</TabsTrigger>
          <TabsTrigger value="remedial">Remedial & Pengayaan</TabsTrigger>
        </TabsList>
        <TabsContent value="setup-kd"><SetupKD /></TabsContent>
        <TabsContent value="setup-kkm"><SetupKKM /></TabsContent>
        <TabsContent value="input-nilai"><InputNilaiKD /></TabsContent>
        <TabsContent value="laporan"><LaporanPencapaian /></TabsContent>
        <TabsContent value="remedial"><RemedialPengayaan /></TabsContent>
      </Tabs>
    </div>
  );
}

function SetupKD() {
  const { role } = useAuth();
  const canEdit = role === "admin" || role === "kepala_sekolah" || role === "guru";
  const qc = useQueryClient();
  const [deptId, setDeptId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [semId, setSemId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ kode_kd: "", deskripsi: "", urutan: 1, aktif: true });

  const { data: depts } = useDepartemen();
  const { data: mapelList } = useQuery({
    queryKey: ["mapel_cbe", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode").eq("aktif", true).eq("departemen_id", deptId).order("nama");
      return data || [];
    },
  });
  const { data: taList } = useTahunAjaran();
  const activeTa = taList?.find((t: any) => t.aktif);
  const { data: semList } = useSemester(activeTa?.id);

  const { data: kdList, isLoading } = useQuery({
    queryKey: ["kompetensi_dasar", mapelId, semId],
    enabled: !!mapelId,
    queryFn: async () => {
      let q = supabase.from("kompetensi_dasar").select("*, semester:semester_id(nama)").eq("mapel_id", mapelId).order("urutan");
      if (semId) q = q.eq("semester_id", semId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (vals: any) => {
      if (editItem) {
        const { error } = await supabase.from("kompetensi_dasar").update(vals).eq("id", editItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kompetensi_dasar").insert({ ...vals, mapel_id: mapelId });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kompetensi_dasar"] }); toast.success("KD berhasil disimpan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => deleteWithApproval("kompetensi_dasar", id),
    onSuccess: (result) => { qc.invalidateQueries({ queryKey: ["kompetensi_dasar"] }); toast.success(deletionMessage(result, "KD dihapus")); },
    onError: (e: any) => toast.error(e.message),
  });

  const openAdd = () => { setEditItem(null); setForm({ kode_kd: "", deskripsi: "", urutan: (kdList?.length || 0) + 1, aktif: true }); setDialogOpen(true); };
  const openEdit = (item: any) => { setEditItem(item); setForm({ kode_kd: item.kode_kd, deskripsi: item.deskripsi, urutan: item.urutan || 1, aktif: item.aktif !== false }); setDialogOpen(true); };

  const columns: DataTableColumn<any>[] = [
    { key: "kode_kd", label: "Kode KD", sortable: true },
    { key: "deskripsi", label: "Deskripsi", render: (v) => <span className="text-sm">{(v as string)?.slice(0, 80)}{(v as string)?.length > 80 ? "..." : ""}</span> },
    { key: "semester", label: "Semester", render: (_, r) => r.semester?.nama || "-" },
    { key: "urutan", label: "Urutan", sortable: true },
    { key: "aktif", label: "Status", render: (v) => <span className={v ? "text-emerald-600 font-medium" : "text-muted-foreground"}>{ v ? "Aktif" : "Nonaktif"}</span> },
  ];

  if (canEdit) {
    columns.push({
      key: "_aksi", label: "Aksi",
      render: (_, r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v); setMapelId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Mata Pelajaran</Label><Select value={mapelId} onValueChange={setMapelId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelList?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Semester</Label><Select value={semId || "__all__"} onValueChange={(v) => setSemId(v === "__all__" ? "" : v)}><SelectTrigger className="w-36"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="__all__">Semua</SelectItem>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
        {canEdit && mapelId && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah KD</Button>}
      </div>

      {mapelId && (
        <Card><CardContent className="pt-6">
          <DataTable columns={columns} data={kdList || []} loading={isLoading} searchable pageSize={20} />
        </CardContent></Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit KD" : "Tambah KD"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Kode KD *</Label><Input value={form.kode_kd} onChange={(e) => setForm({ ...form, kode_kd: e.target.value })} placeholder="3.1" /></div>
            <div><Label>Deskripsi *</Label><Textarea value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} rows={3} /></div>
            <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex gap-4">
              <div><Label>Urutan</Label><Input type="number" value={form.urutan} onChange={(e) => setForm({ ...form, urutan: Number(e.target.value) })} className="w-20" /></div>
              <div className="flex items-center gap-2 pt-6"><Switch checked={form.aktif} onCheckedChange={(v) => setForm({ ...form, aktif: v })} /><Label>Aktif</Label></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate({ ...form, semester_id: semId || null })} disabled={!form.kode_kd || !form.deskripsi || saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus KD" description="Yakin ingin menghapus kompetensi dasar ini?" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </div>
  );
}

function SetupKKM() {
  const qc = useQueryClient();
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [kkmMap, setKkmMap] = useState<Record<string, string>>({});

  const { data: depts } = useDepartemen();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const { data: kelasList } = useKelas();
  const filteredKelas = deptId ? kelasList?.filter((k: any) => k.departemen?.id === deptId) : kelasList;

  const { data: mapelList } = useQuery({
    queryKey: ["mapel_kkm", deptId],
    enabled: !!deptId,
    queryFn: async () => { const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode").eq("aktif", true).eq("departemen_id", deptId).order("nama"); return data || []; },
  });

  const { data: kkmData, isLoading } = useQuery({
    queryKey: ["kkm_setup", kelasId, taId, semId],
    enabled: !!kelasId && !!taId && !!semId,
    queryFn: async () => {
      const { data } = await supabase.from("kkm").select("*").eq("kelas_id", kelasId).eq("tahun_ajaran_id", taId).eq("semester_id", semId);
      const map: Record<string, string> = {};
      (data || []).forEach((k: any) => { map[k.mapel_id] = String(k.nilai_kkm || 70); });
      (mapelList || []).forEach((m: any) => { if (!map[m.id]) map[m.id] = "70"; });
      setKkmMap(map);
      return data || [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(kkmMap).map(([mapel_id, nilai]) => ({
        mapel_id, kelas_id: kelasId, tahun_ajaran_id: taId, semester_id: semId, nilai_kkm: Number(nilai),
      }));
      const { error } = await supabase.from("kkm").upsert(rows, { onConflict: "mapel_id,kelas_id,tahun_ajaran_id,semester_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kkm_setup"] }); toast.success("KKM berhasil disimpan"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v); setKelasId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
      </div>

      {kelasId && taId && semId && mapelList && (
        <>
          <div className="flex justify-end"><Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan KKM"}</Button></div>
          {isLoading ? <Skeleton className="h-64" /> : (
            <Card><CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>No</TableHead><TableHead>Mata Pelajaran</TableHead><TableHead className="w-32">Nilai KKM</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mapelList.map((m: any, i: number) => (
                    <TableRow key={m.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{m.nama}</TableCell>
                      <TableCell><Input type="number" min={0} max={100} className="h-8 w-20 text-center" value={kkmMap[m.id] || "70"} onChange={(e) => setKkmMap(prev => ({ ...prev, [m.id]: e.target.value }))} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

function InputNilaiKD() {
  const qc = useQueryClient();
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [nilaiMap, setNilaiMap] = useState<Record<string, Record<string, string>>>({});

  const { data: depts } = useDepartemen();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const { data: kelasList } = useKelas();
  const filteredKelas = deptId ? kelasList?.filter((k: any) => k.departemen?.id === deptId) : kelasList;

  const { data: mapelList } = useQuery({
    queryKey: ["mapel_nilaikd", deptId],
    enabled: !!deptId,
    queryFn: async () => { const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode").eq("aktif", true).eq("departemen_id", deptId).order("nama"); return data || []; },
  });

  const { data: kdList } = useQuery({
    queryKey: ["kd_input", mapelId, semId],
    enabled: !!mapelId,
    queryFn: async () => {
      let q = supabase.from("kompetensi_dasar").select("id, kode_kd, deskripsi").eq("mapel_id", mapelId).eq("aktif", true).order("urutan");
      if (semId) q = q.eq("semester_id", semId);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: kkmVal } = useQuery({
    queryKey: ["kkm_val", mapelId, kelasId, taId, semId],
    enabled: !!mapelId && !!kelasId && !!taId && !!semId,
    queryFn: async () => {
      const { data } = await supabase.from("kkm").select("nilai_kkm").eq("mapel_id", mapelId).eq("kelas_id", kelasId).eq("tahun_ajaran_id", taId).eq("semester_id", semId).maybeSingle();
      return data?.nilai_kkm || 70;
    },
  });

  const { data: siswaData, isLoading } = useQuery({
    queryKey: ["nilai_kd_input", kelasId, mapelId, taId, semId],
    enabled: showTable && !!kelasId && !!mapelId && !!taId && !!semId,
    queryFn: async () => {
      const { data: ksList } = await supabase.from("kelas_siswa").select("siswa:siswa_id(id, nis, nama)").eq("kelas_id", kelasId).eq("aktif", true);
      const siswaList = (ksList || []).map((ks: any) => ks.siswa).filter(Boolean).sort((a: any, b: any) => a.nama.localeCompare(b.nama));
      const kdIds = (kdList || []).map((kd: any) => kd.id);
      if (kdIds.length && siswaList.length) {
        const { data: existing } = await supabase.from("nilai_kd").select("siswa_id, kd_id, nilai").eq("kelas_id", kelasId).eq("tahun_ajaran_id", taId).eq("semester_id", semId).in("kd_id", kdIds);
        const map: Record<string, Record<string, string>> = {};
        siswaList.forEach((s: any) => { map[s.id] = {}; });
        (existing || []).forEach((e: any) => { if (map[e.siswa_id]) map[e.siswa_id][e.kd_id] = String(e.nilai ?? ""); });
        setNilaiMap(map);
      }
      return siswaList;
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const rows: any[] = [];
      Object.entries(nilaiMap).forEach(([siswa_id, kdVals]) => {
        Object.entries(kdVals).forEach(([kd_id, nilai]) => {
          if (nilai) rows.push({ siswa_id, kd_id, kelas_id: kelasId, tahun_ajaran_id: taId, semester_id: semId, nilai: Number(nilai) });
        });
      });
      if (!rows.length) return;
      const { error } = await supabase.from("nilai_kd").upsert(rows, { onConflict: "siswa_id,kd_id,kelas_id,tahun_ajaran_id,semester_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nilai_kd"] }); toast.success("Nilai KD berhasil disimpan"); },
    onError: (e: any) => toast.error(e.message),
  });

  const kkm = kkmVal || 70;

  return (
    <div className="space-y-4 pt-4">
      <Card><CardContent className="pt-6">
        <div className="flex gap-3 items-end flex-wrap">
          <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v); setKelasId(""); setMapelId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Mata Pelajaran</Label><Select value={mapelId} onValueChange={setMapelId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelList?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nama}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={() => setShowTable(true)} disabled={!kelasId || !mapelId || !taId || !semId}>Tampilkan</Button>
        </div>
      </CardContent></Card>

      {showTable && siswaData && kdList && kdList.length > 0 && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">KKM: <strong>{kkm}</strong></p>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan Semua"}</Button>
          </div>
          {isLoading ? <Skeleton className="h-96" /> : (
            <Card><CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10">No</TableHead><TableHead>Nama Siswa</TableHead>
                  {kdList.map((kd: any) => <TableHead key={kd.id} className="text-xs text-center w-20" title={kd.deskripsi}>{kd.kode_kd}</TableHead>)}
                  <TableHead className="text-center">Rata-rata</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {siswaData.map((s: any, i: number) => {
                    const vals = kdList.map((kd: any) => Number(nilaiMap[s.id]?.[kd.id] || 0)).filter(n => n > 0);
                    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "-";
                    return (
                      <TableRow key={s.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{s.nama}</TableCell>
                        {kdList.map((kd: any) => {
                          const v = Number(nilaiMap[s.id]?.[kd.id] || 0);
                          return (
                            <TableCell key={kd.id}>
                              <Input type="number" min={0} max={100} className={cn("h-8 w-16 text-center text-xs font-bold", v > 0 && (v >= kkm ? "text-emerald-600" : "text-red-600"))}
                                value={nilaiMap[s.id]?.[kd.id] || ""}
                                onChange={(e) => setNilaiMap(prev => ({ ...prev, [s.id]: { ...prev[s.id], [kd.id]: e.target.value } }))}
                              />
                            </TableCell>
                          );
                        })}
                        <TableCell className={cn("text-center font-bold", typeof avg === "string" ? "" : Number(avg) >= kkm ? "text-emerald-600" : "text-red-600")}>{avg}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </>
      )}
      {showTable && kdList && kdList.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Belum ada Kompetensi Dasar untuk mata pelajaran ini. Silakan setup KD terlebih dahulu.</CardContent></Card>
      )}
    </div>
  );
}
