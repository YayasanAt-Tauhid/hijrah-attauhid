import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartemen, useTahunAjaran } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isWithinInterval, parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { cn } from "@/lib/utils";

const KATEGORI = [
  { value: "umum", label: "Umum", color: "hsl(var(--primary))" },
  { value: "libur", label: "Libur", color: "hsl(0, 72%, 51%)" },
  { value: "ujian", label: "Ujian", color: "hsl(38, 92%, 50%)" },
  { value: "kegiatan", label: "Kegiatan", color: "hsl(142, 71%, 45%)" },
  { value: "rapat", label: "Rapat", color: "hsl(262, 83%, 58%)" },
];

const getKategoriColor = (k: string) => KATEGORI.find(c => c.value === k)?.color || "hsl(var(--primary))";

export default function KalenderAkademik() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "admin_tu" || role === "kepala_sekolah";
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [taId, setTaId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ judul: "", deskripsi: "", kategori: "umum", tanggal_mulai: "", tanggal_selesai: "", warna: "" });

  const { data: depts } = useDepartemen();
  const { data: taList } = useTahunAjaran();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const { data: events, isLoading } = useQuery({
    queryKey: ["kalender", format(currentMonth, "yyyy-MM"), taId, deptId],
    queryFn: async () => {
      let q = supabase.from("kalender_akademik").select("*").lte("tanggal_mulai", format(endOfWeek(monthEnd, { weekStartsOn: 1 }), "yyyy-MM-dd")).gte("tanggal_mulai", format(startOfWeek(monthStart, { weekStartsOn: 1 }), "yyyy-MM-dd"));
      if (taId) q = q.eq("tahun_ajaran_id", taId);
      if (deptId) q = q.eq("departemen_id", deptId);
      const { data, error } = await q.order("tanggal_mulai");
      if (error) throw error;
      return data as any[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (values: any) => {
      const payload = { ...values, tahun_ajaran_id: taId || null, departemen_id: deptId || null, warna: getKategoriColor(values.kategori) };
      if (!payload.tanggal_selesai) payload.tanggal_selesai = null;
      if (editItem) { const { error } = await supabase.from("kalender_akademik").update(payload).eq("id", editItem.id); if (error) throw error; }
      else { const { error } = await supabase.from("kalender_akademik").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kalender"] }); toast.success("Event disimpan"); setDialogOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("kalender_akademik").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kalender"] }); toast.success("Event dihapus"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openAdd = (date?: Date) => {
    setEditItem(null);
    setForm({ judul: "", deskripsi: "", kategori: "umum", tanggal_mulai: date ? format(date, "yyyy-MM-dd") : "", tanggal_selesai: "", warna: "" });
    setDialogOpen(true);
  };
  const openEdit = (e: any) => {
    setEditItem(e);
    setForm({ judul: e.judul, deskripsi: e.deskripsi || "", kategori: e.kategori || "umum", tanggal_mulai: e.tanggal_mulai, tanggal_selesai: e.tanggal_selesai || "", warna: e.warna || "" });
    setDialogOpen(true);
  };

  // Calendar grid
  const calendarDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days: Date[] = [];
    let day = start;
    while (day <= end) { days.push(day); day = addDays(day, 1); }
    return days;
  }, [currentMonth]);

  const getEventsForDay = (day: Date) => {
    return (events || []).filter((e: any) => {
      const start = parseISO(e.tanggal_mulai);
      if (e.tanggal_selesai) {
        const end = parseISO(e.tanggal_selesai);
        return isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
      }
      return isSameDay(day, start);
    });
  };

  // Upcoming events
  const upcoming = (events || []).filter((e: any) => parseISO(e.tanggal_mulai) >= new Date()).slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kalender Akademik</h1>
          <p className="text-sm text-muted-foreground">Jadwal kegiatan dan kalender sekolah</p>
        </div>
        {canEdit && <Button onClick={() => openAdd()}><Plus className="h-4 w-4 mr-2" />Tambah Event</Button>}
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Tahun Ajaran</Label><Select value={taId || "__all__"} onValueChange={(v) => setTaId(v === "__all__" ? "" : v)}><SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="__all__">Semua</SelectItem>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Lembaga</Label><Select value={deptId || "__all__"} onValueChange={(v) => setDeptId(v === "__all__" ? "" : v)}><SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="__all__">Semua</SelectItem>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex gap-1">
          {KATEGORI.map(k => (
            <Badge key={k.value} variant="outline" className="text-xs" style={{ borderColor: k.color, color: k.color }}>{k.label}</Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Calendar */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <CardTitle className="text-lg">{format(currentMonth, "MMMM yyyy", { locale: localeId })}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-96" /> : (
              <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(d => (
                  <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calendarDays.map((day, i) => {
                  const dayEvents = getEventsForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  return (
                    <div
                      key={i}
                      className={cn(
                        "bg-background min-h-[80px] p-1 cursor-pointer hover:bg-accent/30 transition-colors",
                        !isCurrentMonth && "opacity-40"
                      )}
                      onClick={() => canEdit && openAdd(day)}
                    >
                      <span className={cn("text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full", isToday && "bg-primary text-primary-foreground")}>
                        {format(day, "d")}
                      </span>
                      <div className="space-y-0.5 mt-0.5">
                        {dayEvents.slice(0, 3).map((e: any) => (
                          <div
                            key={e.id}
                            className="text-[10px] px-1 py-0.5 rounded truncate text-white cursor-pointer"
                            style={{ backgroundColor: e.warna || getKategoriColor(e.kategori) }}
                            onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}
                          >
                            {e.judul}
                          </div>
                        ))}
                        {dayEvents.length > 3 && <p className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} lagi</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: upcoming */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Kegiatan Mendatang</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada kegiatan mendatang</p>}
            {upcoming.map((e: any) => (
              <div key={e.id} className="flex gap-2 items-start group">
                <div className="w-1 h-full min-h-[32px] rounded-full shrink-0" style={{ backgroundColor: e.warna || getKategoriColor(e.kategori) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.judul}</p>
                  <p className="text-xs text-muted-foreground">{format(parseISO(e.tanggal_mulai), "d MMM yyyy", { locale: localeId })}{e.tanggal_selesai ? ` - ${format(parseISO(e.tanggal_selesai), "d MMM", { locale: localeId })}` : ""}</p>
                </div>
                {canEdit && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(e)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteId(e.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editItem ? "Edit" : "Tambah"} Event</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Judul *</Label><Input value={form.judul} onChange={(e) => setForm({ ...form, judul: e.target.value })} /></div>
            <div><Label>Kategori</Label><Select value={form.kategori} onValueChange={(v) => setForm({ ...form, kategori: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{KATEGORI.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Tanggal Mulai *</Label><Input type="date" value={form.tanggal_mulai} onChange={(e) => setForm({ ...form, tanggal_mulai: e.target.value })} /></div>
              <div><Label>Tanggal Selesai</Label><Input type="date" value={form.tanggal_selesai} onChange={(e) => setForm({ ...form, tanggal_selesai: e.target.value })} /></div>
            </div>
            <div><Label>Deskripsi</Label><Textarea value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            {editItem && <Button variant="destructive" size="sm" onClick={() => { setDeleteId(editItem.id); setDialogOpen(false); }}>Hapus</Button>}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => { if (!form.judul || !form.tanggal_mulai) { toast.error("Judul dan tanggal mulai wajib diisi"); return; } saveMut.mutate(form); }} disabled={saveMut.isPending}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Hapus Event" description="Yakin hapus event ini?" onConfirm={() => { if (deleteId) deleteMut.mutate(deleteId); setDeleteId(null); }} />
    </div>
  );
}
