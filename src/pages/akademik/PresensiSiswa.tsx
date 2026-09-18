import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { namaBulan, BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";

const STATUS_OPTIONS = [
  { value: "H", label: "H", color: "bg-emerald-500 text-white" },
  { value: "I", label: "I", color: "bg-yellow-500 text-white" },
  { value: "S", label: "S", color: "bg-blue-500 text-white" },
  { value: "A", label: "A", color: "bg-red-500 text-white" },
];

export default function PresensiSiswa() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Presensi Siswa</h1>
        <p className="text-sm text-muted-foreground">Input dan rekap kehadiran siswa harian</p>
      </div>
      <Tabs defaultValue="input">
        <TabsList><TabsTrigger value="input">Input Presensi</TabsTrigger><TabsTrigger value="rekap">Rekap Presensi</TabsTrigger></TabsList>
        <TabsContent value="input"><InputPresensi /></TabsContent>
        <TabsContent value="rekap"><RekapPresensi /></TabsContent>
      </Tabs>
    </div>
  );
}

function InputPresensi() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canEdit = role === "admin" || role === "admin_tu" || role === "kepala_sekolah" || role === "guru";
  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [deptId, setDeptId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [showTable, setShowTable] = useState(false);
  const [presensiMap, setPresensiMap] = useState<Record<string, { status: string; keterangan: string }>>({});

  const { data: depts } = useDepartemen();
  const { data: kelasList } = useKelas();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);

  const filteredKelas = deptId ? kelasList?.filter((k: any) => k.departemen?.id === deptId) : kelasList;

  const { data: siswaData, isLoading, refetch } = useQuery({
    queryKey: ["presensi_input_siswa", kelasId, tanggal],
    enabled: showTable && !!kelasId,
    queryFn: async () => {
      const { data: ksList } = await supabase
        .from("kelas_siswa")
        .select("siswa:siswa_id(id, nis, nama, jenis_kelamin)")
        .eq("kelas_id", kelasId)
        .eq("aktif", true);
      
      const { data: existing } = await supabase
        .from("presensi_siswa")
        .select("siswa_id, status, keterangan, id")
        .eq("kelas_id", kelasId)
        .eq("tanggal", tanggal);

      const existingMap = new Map((existing || []).map((e) => [e.siswa_id, e]));
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

  const setStatus = (siswaId: string, status: string) => {
    setPresensiMap((prev) => ({ ...prev, [siswaId]: { ...prev[siswaId], status } }));
  };
  const setKeterangan = (siswaId: string, keterangan: string) => {
    setPresensiMap((prev) => ({ ...prev, [siswaId]: { ...prev[siswaId], keterangan } }));
  };

  const semuaHadir = () => {
    const map: Record<string, { status: string; keterangan: string }> = {};
    Object.keys(presensiMap).forEach((id) => { map[id] = { ...presensiMap[id], status: "H" }; });
    setPresensiMap(map);
  };

  const summary = useMemo(() => {
    const s = { H: 0, I: 0, S: 0, A: 0, total: 0 };
    Object.values(presensiMap).forEach((v) => { s[v.status as keyof typeof s]++; s.total++; });
    return s;
  }, [presensiMap]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(presensiMap).map(([siswa_id, v]) => ({
        siswa_id, kelas_id: kelasId, tanggal, status: v.status,
        keterangan: v.keterangan || null, tahun_ajaran_id: taId || null, semester_id: semId || null,
      }));
      const { error } = await supabase.from("presensi_siswa").upsert(rows, { onConflict: "siswa_id,kelas_id,tanggal" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["presensi"] }); toast.success("Presensi berhasil disimpan"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-end flex-wrap">
            <div><Label>Tanggal</Label><Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="w-40" /></div>
            <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v === "__all__" ? "" : v); setKelasId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="__all__">Semua</SelectItem>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih kelas" /></SelectTrigger><SelectContent>{filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
            <Button onClick={() => setShowTable(true)} disabled={!kelasId}>Tampilkan Siswa</Button>
          </div>
        </CardContent>
      </Card>

      {showTable && kelasId && (
        isLoading ? <Skeleton className="h-96" /> : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {siswaData?.sudahAda && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Sudah diisi</Badge>}
                <Button variant="outline" size="sm" onClick={semuaHadir}>Semua Hadir</Button>
              </div>
              {canEdit && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? "Menyimpan..." : "Simpan Presensi"}</Button>}
            </div>

            <Card>
              <CardContent className="pt-6 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">No</TableHead>
                      <TableHead>NIS</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead className="w-10">L/P</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Keterangan</TableHead>
                    </TableRow>
                  </TableHeader>
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
                              <button
                                key={opt.value}
                                onClick={() => setStatus(s.id, opt.value)}
                                className={cn(
                                  "h-8 w-8 rounded text-xs font-bold transition-all",
                                  presensiMap[s.id]?.status === opt.value ? opt.color : "bg-muted text-muted-foreground hover:bg-muted/80"
                                )}
                              >{opt.label}</button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell><Input className="h-8 text-xs" placeholder="keterangan..." value={presensiMap[s.id]?.keterangan || ""} onChange={(e) => setKeterangan(s.id, e.target.value)} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

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

function RekapPresensi() {
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [kelasId, setKelasId] = useState("");
  const { data: kelasList } = useKelas();

  const { data: rekapData, isLoading } = useQuery({
    queryKey: ["rekap_presensi", kelasId, bulan, tahun],
    enabled: !!kelasId,
    queryFn: async () => {
      const startDate = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
      const endM = bulan === 12 ? 1 : bulan + 1;
      const endY = bulan === 12 ? tahun + 1 : tahun;
      const endDate = `${endY}-${String(endM).padStart(2, "0")}-01`;

      const data = await fetchAllPages<any>((from, to) =>
        supabase
          .from("presensi_siswa")
          .select("siswa_id, tanggal, status, siswa:siswa_id(nis, nama)")
          .eq("kelas_id", kelasId)
          .gte("tanggal", startDate)
          .lt("tanggal", endDate)
          .order("id").range(from, to));

      const grouped = new Map<string, { siswa_id: string; nis: string; nama: string; days: Record<number, string>; H: number; I: number; S: number; A: number }>();
      data.forEach((r: any) => {
        if (!grouped.has(r.siswa_id)) grouped.set(r.siswa_id, { siswa_id: r.siswa_id, nis: r.siswa?.nis || "", nama: r.siswa?.nama || "", days: {}, H: 0, I: 0, S: 0, A: 0 });
        const entry = grouped.get(r.siswa_id)!;
        const day = new Date(r.tanggal).getDate();
        entry.days[day] = r.status;
        if (r.status in entry) entry[r.status as "H" | "I" | "S" | "A"]++;
      });
      return Array.from(grouped.values()).sort((a, b) => a.nama.localeCompare(b.nama));
    },
  });

  const daysInMonth = new Date(tahun, bulan, 0).getDate();

  return (
    <div className="space-y-4 pt-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div><Label>Bulan</Label><Select value={String(bulan)} onValueChange={(v) => setBulan(Number(v))}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{BULAN_ORDER_AKADEMIK.map((m) => <SelectItem key={m} value={String(m)}>{namaBulan(m)}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Tahun</Label><Input type="number" className="w-24" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} /></div>
        <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{kelasList?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
        {rekapData && <ExportButton data={rekapData.map((r) => ({ NIS: r.nis, Nama: r.nama, Hadir: r.H, Izin: r.I, Sakit: r.S, Alpha: r.A }))} filename={`rekap-presensi-${bulan}-${tahun}`} />}
      </div>
      {kelasId && (isLoading ? <Skeleton className="h-96" /> : (
        <Card><CardContent className="pt-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>NIS</TableHead><TableHead>Nama</TableHead>
                {Array.from({ length: daysInMonth }, (_, i) => <TableHead key={i} className="w-8 text-center text-xs">{i + 1}</TableHead>)}
                <TableHead className="text-center">H</TableHead><TableHead className="text-center">I</TableHead><TableHead className="text-center">S</TableHead><TableHead className="text-center">A</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rekapData?.map((r) => (
                <TableRow key={r.siswa_id}>
                  <TableCell className="text-xs">{r.nis}</TableCell>
                  <TableCell className="text-xs font-medium">{r.nama}</TableCell>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const s = r.days[i + 1];
                    return <TableCell key={i} className={cn("text-center text-xs font-bold", s === "H" && "text-emerald-600", s === "I" && "text-yellow-600", s === "S" && "text-blue-600", s === "A" && "text-red-600")}>{s || ""}</TableCell>;
                  })}
                  <TableCell className="text-center text-xs font-bold text-emerald-600">{r.H}</TableCell>
                  <TableCell className="text-center text-xs font-bold text-yellow-600">{r.I}</TableCell>
                  <TableCell className="text-center text-xs font-bold text-blue-600">{r.S}</TableCell>
                  <TableCell className="text-center text-xs font-bold text-red-600">{r.A}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      ))}
    </div>
  );
}
