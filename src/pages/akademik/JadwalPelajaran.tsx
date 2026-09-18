import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartemen, useTingkat, useKelas, useTahunAjaran, useSemester } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

const HARI_LIST = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const TIME_SLOTS = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];

export default function JadwalPelajaran() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Jadwal Pelajaran</h1>
        <p className="text-sm text-muted-foreground">Kelola jadwal pelajaran kelas dan guru</p>
      </div>
      <Tabs defaultValue="kelas">
        <TabsList>
          <TabsTrigger value="kelas">Jadwal per Kelas</TabsTrigger>
          <TabsTrigger value="guru">Jadwal per Guru</TabsTrigger>
        </TabsList>
        <TabsContent value="kelas"><JadwalPerKelas /></TabsContent>
        <TabsContent value="guru"><JadwalPerGuru /></TabsContent>
      </Tabs>
    </div>
  );
}

function JadwalPerKelas() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "admin_tu" || role === "kepala_sekolah" || role === "guru";
  const [deptId, setDeptId] = useState("");
  const [tingkatId, setTingkatId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ mapel_id: "", pegawai_id: "", hari: "", jam_mulai: "", jam_selesai: "", ruangan: "" });

  const { data: depts } = useDepartemen();
  const { data: tingkatList } = useTingkat(deptId || undefined);
  const { data: kelasList } = useKelas(tingkatId || undefined);
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const aktifTA = taList?.find((t: any) => t.aktif);

  useEffect(() => { if (aktifTA && !taId) setTaId(aktifTA.id); }, [aktifTA]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: jadwalData, isLoading } = useQuery({
    queryKey: ["jadwal_kelas", kelasId, taId, semId],
    enabled: !!kelasId && !!taId && !!semId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jadwal")
        .select("*, mata_pelajaran:mapel_id(nama, kode), pegawai:pegawai_id(nama), kelas:kelas_id(nama)")
        .eq("kelas_id", kelasId)
        .eq("tahun_ajaran_id", taId)
        .eq("semester_id", semId)
        .order("jam_mulai");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: mapelList } = useQuery({
    queryKey: ["mapel_for_jadwal", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode, tingkat_id").eq("aktif", true)
        .or(`departemen_id.is.null,departemen_id.eq.${deptId}`).order("nama");
      return data || [];
    },
  });

  // Mapel ber-tingkat hanya muncul untuk tingkat yang dipilih
  const mapelOptions = (mapelList || []).filter((m: any) =>
    !m.tingkat_id || !tingkatId || m.tingkat_id === tingkatId);

  const { data: guruList } = useQuery({
    queryKey: ["guru_for_jadwal"],
    queryFn: async () => { const { data } = await supabase.from("pegawai").select("id, nama").eq("status", "aktif").order("nama"); return data || []; },
  });

  const saveMut = useMutation({
    mutationFn: async (values: any) => {
      const payload = { ...values, kelas_id: kelasId, tahun_ajaran_id: taId, semester_id: semId };
      if (editItem) { const { error } = await supabase.from("jadwal").update(payload).eq("id", editItem.id); if (error) throw error; }
      else { const { error } = await supabase.from("jadwal").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jadwal_kelas"] }); toast.success("Jadwal disimpan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("jadwal").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jadwal_kelas"] }); toast.success("Jadwal dihapus"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openAdd = () => { setEditItem(null); setForm({ mapel_id: "", pegawai_id: "", hari: "", jam_mulai: "", jam_selesai: "", ruangan: "" }); setDialogOpen(true); };
  const openEdit = (j: any) => { setEditItem(j); setForm({ mapel_id: j.mapel_id || "", pegawai_id: j.pegawai_id || "", hari: j.hari || "", jam_mulai: j.jam_mulai || "", jam_selesai: j.jam_selesai || "", ruangan: j.ruangan || "" }); setDialogOpen(true); };

  // Build grid
  const gridData = useMemo(() => {
    const grid: Record<string, Record<string, any>> = {};
    TIME_SLOTS.forEach((t) => { grid[t] = {}; HARI_LIST.forEach((h) => { grid[t][h] = null; }); });
    (jadwalData || []).forEach((j: any) => {
      const slot = j.jam_mulai?.slice(0, 5);
      if (slot && grid[slot] && j.hari) {
        grid[slot][j.hari] = j;
      }
    });
    return grid;
  }, [jadwalData]);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}{t.aktif ? " ✓" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v); setTingkatId(""); setKelasId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Tingkat</Label><Select value={tingkatId} onValueChange={(v) => { setTingkatId(v); setKelasId(""); }}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{tingkatList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{kelasList?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
      </div>

      {kelasId && taId && semId ? (
        <>
          {canEdit && <div className="flex justify-end"><Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Tambah Jadwal</Button></div>}
          {isLoading ? <Skeleton className="h-96" /> : (
            <Card>
              <CardContent className="pt-6 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead className="w-20">Jam</TableHead>{HARI_LIST.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {TIME_SLOTS.map((slot) => (
                      <TableRow key={slot}>
                        <TableCell className="font-mono text-xs">{slot}</TableCell>
                        {HARI_LIST.map((hari) => {
                          const j = gridData[slot]?.[hari];
                          return (
                            <TableCell key={hari} className="text-xs min-w-[120px]">
                              {j ? (
                                <div className="space-y-0.5">
                                  <p className="font-medium text-primary">{j.mata_pelajaran?.nama || j.mata_pelajaran?.kode}</p>
                                  <p className="text-muted-foreground">{j.pegawai?.nama}</p>
                                  {canEdit && (
                                    <div className="flex gap-1 mt-1">
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(j)}><Pencil className="h-3 w-3" /></Button>
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteId(j.id)}><Trash2 className="h-3 w-3" /></Button>
                                    </div>
                                  )}
                                </div>
                              ) : <span className="text-muted-foreground">-</span>}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      ) : <p className="text-sm text-muted-foreground text-center py-8">Pilih tahun ajaran, semester, dan kelas untuk melihat jadwal</p>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Jadwal</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Mata Pelajaran *</Label><Select value={form.mapel_id} onValueChange={(v) => setForm({ ...form, mapel_id: v })}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelOptions.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.kode ? `${m.kode} - ` : ""}{m.nama}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Guru *</Label><Select value={form.pegawai_id} onValueChange={(v) => setForm({ ...form, pegawai_id: v })}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{guruList?.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.nama}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Hari *</Label><Select value={form.hari} onValueChange={(v) => setForm({ ...form, hari: v })}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{HARI_LIST.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Jam Mulai *</Label><Input type="time" value={form.jam_mulai} onChange={(e) => setForm({ ...form, jam_mulai: e.target.value })} /></div>
              <div><Label>Jam Selesai *</Label><Input type="time" value={form.jam_selesai} onChange={(e) => setForm({ ...form, jam_selesai: e.target.value })} /></div>
            </div>
            <div><Label>Ruangan</Label><Input value={form.ruangan} onChange={(e) => setForm({ ...form, ruangan: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button><Button onClick={() => { if (!form.mapel_id || !form.pegawai_id || !form.hari || !form.jam_mulai || !form.jam_selesai) { toast.error("Lengkapi data"); return; } saveMut.mutate(form); }} disabled={saveMut.isPending}>Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Jadwal" description="Yakin hapus jadwal ini?" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </div>
  );
}

function JadwalPerGuru() {
  const [guruId, setGuruId] = useState("");
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);

  const { data: guruList } = useQuery({
    queryKey: ["guru_list_jadwal"],
    queryFn: async () => { const { data } = await supabase.from("pegawai").select("id, nama, jabatan").eq("status", "aktif").order("nama"); return data || []; },
  });

  const { data: jadwalGuru, isLoading } = useQuery({
    queryKey: ["jadwal_guru", guruId, taId, semId],
    enabled: !!guruId && !!taId && !!semId,
    queryFn: async () => {
      const { data, error } = await supabase.from("jadwal").select("*, mata_pelajaran:mapel_id(nama), kelas:kelas_id(nama)").eq("pegawai_id", guruId).eq("tahun_ajaran_id", taId).eq("semester_id", semId).order("jam_mulai");
      if (error) throw error;
      return data as any[];
    },
  });

  const totalJam = (jadwalGuru || []).length;
  const kelasSet = new Set((jadwalGuru || []).map((j: any) => j.kelas?.nama).filter(Boolean));

  const gridData = useMemo(() => {
    const grid: Record<string, Record<string, any>> = {};
    TIME_SLOTS.forEach((t) => { grid[t] = {}; HARI_LIST.forEach((h) => { grid[t][h] = null; }); });
    (jadwalGuru || []).forEach((j: any) => {
      const slot = j.jam_mulai?.slice(0, 5);
      if (slot && grid[slot] && j.hari) grid[slot][j.hari] = j;
    });
    return grid;
  }, [jadwalGuru]);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Guru</Label><Select value={guruId} onValueChange={setGuruId}><SelectTrigger className="w-56"><SelectValue placeholder="Pilih guru" /></SelectTrigger><SelectContent>{guruList?.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
      </div>

      {guruId && taId && semId ? (
        isLoading ? <Skeleton className="h-96" /> : (
          <>
            <Card>
              <CardContent className="pt-6 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-20">Jam</TableHead>{HARI_LIST.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {TIME_SLOTS.map((slot) => (
                      <TableRow key={slot}>
                        <TableCell className="font-mono text-xs">{slot}</TableCell>
                        {HARI_LIST.map((hari) => {
                          const j = gridData[slot]?.[hari];
                          return <TableCell key={hari} className="text-xs">{j ? <div><p className="font-medium">{j.kelas?.nama}</p><p className="text-muted-foreground">{j.mata_pelajaran?.nama}</p></div> : <span className="text-muted-foreground">-</span>}</TableCell>;
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span>Total jam mengajar: <strong>{totalJam} jam/minggu</strong></span>
              <span>Kelas diajar: <strong>{Array.from(kelasSet).join(", ") || "-"}</strong></span>
            </div>
          </>
        )
      ) : <p className="text-sm text-muted-foreground text-center py-8">Pilih guru, tahun ajaran, dan semester</p>}
    </div>
  );
}
