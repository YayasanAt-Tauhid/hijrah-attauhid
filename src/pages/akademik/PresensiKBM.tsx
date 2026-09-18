import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton } from "@/components/shared/ExportButton";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartemen, useKelas, useTahunAjaran, useSemester } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "H", label: "H", color: "bg-emerald-500 text-white" },
  { value: "I", label: "I", color: "bg-yellow-500 text-white" },
  { value: "S", label: "S", color: "bg-blue-500 text-white" },
  { value: "A", label: "A", color: "bg-red-500 text-white" },
];

export default function PresensiKBM() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Presensi KBM</h1>
        <p className="text-sm text-muted-foreground">Presensi kehadiran siswa per mata pelajaran</p>
      </div>
      <Tabs defaultValue="input">
        <TabsList>
          <TabsTrigger value="input">Input Presensi</TabsTrigger>
          <TabsTrigger value="rekap">Rekap per Mapel</TabsTrigger>
        </TabsList>
        <TabsContent value="input"><InputPresensiKBM /></TabsContent>
        <TabsContent value="rekap"><RekapPresensiKBM /></TabsContent>
      </Tabs>
    </div>
  );
}

function InputPresensiKBM() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "admin_tu" || role === "kepala_sekolah" || role === "guru";
  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [deptId, setDeptId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [jamKe, setJamKe] = useState("1");
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [presensiMap, setPresensiMap] = useState<Record<string, { status: string; keterangan: string }>>({});

  const { data: depts } = useDepartemen();
  const { data: kelasList } = useKelas();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const filteredKelas = deptId ? kelasList?.filter((k: any) => k.departemen?.id === deptId) : kelasList;

  const { data: mapelList } = useQuery({
    queryKey: ["mapel_kbm", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode, departemen_id, tingkat_id").eq("aktif", true)
        .or(`departemen_id.is.null,departemen_id.eq.${deptId}`).order("nama");
      return data || [];
    },
  });

  // Mapel ber-tingkat hanya muncul untuk kelas dengan tingkat yang sama
  const selectedKelas = kelasList?.find((k: any) => k.id === kelasId);
  const mapelOptions = (mapelList || []).filter((m: any) =>
    !m.tingkat_id || !(selectedKelas as any)?.tingkat_id || m.tingkat_id === (selectedKelas as any).tingkat_id);

  const { data: siswaData, isLoading, refetch } = useQuery({
    queryKey: ["presensi_kbm_input", kelasId, mapelId, tanggal, jamKe],
    enabled: showTable && !!kelasId && !!mapelId,
    queryFn: async () => {
      const { data: ksList } = await supabase
        .from("kelas_siswa").select("siswa:siswa_id(id, nis, nama, jenis_kelamin)")
        .eq("kelas_id", kelasId).eq("aktif", true);

      const { data: existing } = await supabase
        .from("presensi_kbm").select("siswa_id, status, keterangan")
        .eq("kelas_id", kelasId).eq("mapel_id", mapelId)
        .eq("tanggal", tanggal).eq("jam_ke", Number(jamKe));

      const existingMap = new Map((existing || []).map((e: any) => [e.siswa_id, e]));
      const siswaList = (ksList || []).map((ks: any) => ks.siswa).filter(Boolean).sort((a: any, b: any) => a.nama.localeCompare(b.nama));

      const map: Record<string, { status: string; keterangan: string }> = {};
      siswaList.forEach((s: any) => {
        const ex = existingMap.get(s.id);
        map[s.id] = { status: ex?.status || "H", keterangan: ex?.keterangan || "" };
      });
      setPresensiMap(map);
      return { siswaList, sudahAda: (existing || []).length > 0 };
    },
  });

  const summary = useMemo(() => {
    const s = { H: 0, I: 0, S: 0, A: 0, total: 0 };
    Object.values(presensiMap).forEach((v) => { s[v.status as keyof typeof s]++; s.total++; });
    return s;
  }, [presensiMap]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(presensiMap).map(([siswa_id, v]) => ({
        siswa_id, kelas_id: kelasId, mapel_id: mapelId, tanggal,
        jam_ke: Number(jamKe), status: v.status,
        keterangan: v.keterangan || null,
        tahun_ajaran_id: taId || null, semester_id: semId || null,
      }));
      // Delete existing then insert
      await supabase.from("presensi_kbm").delete()
        .eq("kelas_id", kelasId).eq("mapel_id", mapelId)
        .eq("tanggal", tanggal).eq("jam_ke", Number(jamKe));
      const { error } = await supabase.from("presensi_kbm").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["presensi_kbm"] }); toast.success("Presensi KBM berhasil disimpan"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <Card><CardContent className="pt-6">
        <div className="flex gap-3 items-end flex-wrap">
          <div><Label>Tanggal</Label><Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="w-40" /></div>
          <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v === "__all__" ? "" : v); setKelasId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Kelas</Label><Select value={kelasId} onValueChange={(v) => { setKelasId(v); setMapelId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Mata Pelajaran</Label><Select value={mapelId} onValueChange={setMapelId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelOptions.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Jam ke-</Label><Input type="number" min={1} max={12} className="w-20" value={jamKe} onChange={(e) => setJamKe(e.target.value)} /></div>
          <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={() => setShowTable(true)} disabled={!kelasId || !mapelId}>Tampilkan</Button>
        </div>
      </CardContent></Card>

      {showTable && kelasId && mapelId && (
        isLoading ? <Skeleton className="h-96" /> : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {siswaData?.sudahAda && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Sudah diisi</Badge>}
              </div>
              {canEdit && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan Presensi"}</Button>}
            </div>
            <Card><CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10">No</TableHead>
                  <TableHead>NIS</TableHead><TableHead>Nama</TableHead><TableHead className="w-10">L/P</TableHead>
                  <TableHead>Status</TableHead><TableHead>Keterangan</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {siswaData?.siswaList?.map((s: any, i: number) => (
                    <TableRow key={s.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="text-xs">{s.nis || "-"}</TableCell>
                      <TableCell className="font-medium text-sm">{s.nama}</TableCell>
                      <TableCell>{s.jenis_kelamin || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {STATUS_OPTIONS.map((opt) => (
                            <button key={opt.value} onClick={() => setPresensiMap(p => ({ ...p, [s.id]: { ...p[s.id], status: opt.value } }))}
                              className={cn("h-8 w-8 rounded text-xs font-bold transition-all", presensiMap[s.id]?.status === opt.value ? opt.color : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell><Input className="h-8 text-xs" placeholder="keterangan..." value={presensiMap[s.id]?.keterangan || ""} onChange={(e) => setPresensiMap(p => ({ ...p, [s.id]: { ...p[s.id], keterangan: e.target.value } }))} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
            <div className="flex gap-4 text-sm">
              <span>Hadir: <strong className="text-emerald-600">{summary.H}</strong></span>
              <span>Izin: <strong className="text-yellow-600">{summary.I}</strong></span>
              <span>Sakit: <strong className="text-blue-600">{summary.S}</strong></span>
              <span>Alpha: <strong className="text-red-600">{summary.A}</strong></span>
              <span>Total: <strong>{summary.total}</strong></span>
            </div>
          </>
        )
      )}
    </div>
  );
}

function RekapPresensiKBM() {
  const [kelasId, setKelasId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const { data: kelasList } = useKelas();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const { data: mapelList } = useQuery({
    queryKey: ["mapel_rekap_kbm"],
    queryFn: async () => { const { data } = await supabase.from("mata_pelajaran").select("id, nama, departemen_id, tingkat_id").eq("aktif", true).order("nama"); return data || []; },
  });

  // Mapel mengikuti lembaga/tingkat kelas yang dipilih
  const selectedKelas = kelasList?.find((k: any) => k.id === kelasId);
  const mapelOptions = (mapelList || []).filter((m: any) =>
    !selectedKelas ||
    ((!m.departemen_id || m.departemen_id === (selectedKelas as any).departemen_id) &&
      (!m.tingkat_id || m.tingkat_id === (selectedKelas as any).tingkat_id)));

  const { data: rekapData, isLoading } = useQuery({
    queryKey: ["rekap_kbm", kelasId, mapelId, taId, semId],
    enabled: !!kelasId && !!mapelId && !!taId && !!semId,
    queryFn: async () => {
      const data = await fetchAllPages<any>((from, to) =>
        supabase
          .from("presensi_kbm").select("siswa_id, status, siswa:siswa_id(nis, nama)")
          .eq("kelas_id", kelasId).eq("mapel_id", mapelId)
          .eq("tahun_ajaran_id", taId).eq("semester_id", semId)
          .order("id").range(from, to));

      const grouped = new Map<string, { nis: string; nama: string; H: number; I: number; S: number; A: number; total: number }>();
      (data || []).forEach((r: any) => {
        if (!grouped.has(r.siswa_id)) grouped.set(r.siswa_id, { nis: r.siswa?.nis || "", nama: r.siswa?.nama || "", H: 0, I: 0, S: 0, A: 0, total: 0 });
        const e = grouped.get(r.siswa_id)!;
        if (r.status in e) e[r.status as "H" | "I" | "S" | "A"]++;
        e.total++;
      });
      return Array.from(grouped.values()).sort((a, b) => a.nama.localeCompare(b.nama));
    },
  });

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Kelas</Label><Select value={kelasId} onValueChange={(v) => { setKelasId(v); setMapelId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{kelasList?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Mata Pelajaran</Label><Select value={mapelId} onValueChange={setMapelId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelOptions.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nama}</SelectItem>)}</SelectContent></Select></div>
        {rekapData && <ExportButton data={rekapData.map(r => ({ NIS: r.nis, Nama: r.nama, Hadir: r.H, Izin: r.I, Sakit: r.S, Alpha: r.A, Total: r.total }))} filename="rekap-presensi-kbm" />}
      </div>
      {kelasId && mapelId && taId && semId && (isLoading ? <Skeleton className="h-96" /> : (
        <Card><CardContent className="pt-6 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>No</TableHead><TableHead>NIS</TableHead><TableHead>Nama</TableHead>
              <TableHead className="text-center">H</TableHead><TableHead className="text-center">I</TableHead>
              <TableHead className="text-center">S</TableHead><TableHead className="text-center">A</TableHead>
              <TableHead className="text-center">Total</TableHead><TableHead className="text-center">% Hadir</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rekapData?.map((r, i) => (
                <TableRow key={r.nis + i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="text-xs">{r.nis}</TableCell>
                  <TableCell className="font-medium text-sm">{r.nama}</TableCell>
                  <TableCell className="text-center text-emerald-600 font-bold">{r.H}</TableCell>
                  <TableCell className="text-center text-yellow-600 font-bold">{r.I}</TableCell>
                  <TableCell className="text-center text-blue-600 font-bold">{r.S}</TableCell>
                  <TableCell className="text-center text-red-600 font-bold">{r.A}</TableCell>
                  <TableCell className="text-center">{r.total}</TableCell>
                  <TableCell className="text-center font-bold">{r.total ? ((r.H / r.total) * 100).toFixed(0) + "%" : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      ))}
    </div>
  );
}
