import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportButton } from "@/components/shared/ExportButton";
import { useDepartemen, useKelas, useTahunAjaran, useSemester } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Printer } from "lucide-react";

export default function LaporanPencapaian() {
  const [taId, setTaId] = useState("");
  const [semId, setSemId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [show, setShow] = useState(false);

  const { data: depts } = useDepartemen();
  const { data: taList } = useTahunAjaran();
  const { data: semList } = useSemester(taId || undefined);
  const { data: kelasList } = useKelas();
  const filteredKelas = deptId ? kelasList?.filter((k: any) => k.departemen?.id === deptId) : kelasList;

  const { data: mapelList } = useQuery({
    queryKey: ["mapel_laporan_kd", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      const { data } = await supabase.from("mata_pelajaran").select("id, nama, kode").eq("aktif", true).eq("departemen_id", deptId).order("nama");
      return data || [];
    },
  });

  const { data: kdList } = useQuery({
    queryKey: ["kd_laporan", mapelId, semId],
    enabled: !!mapelId,
    queryFn: async () => {
      let q = supabase.from("kompetensi_dasar").select("id, kode_kd, deskripsi").eq("mapel_id", mapelId).eq("aktif", true).order("urutan");
      if (semId) q = q.eq("semester_id", semId);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: kkmVal } = useQuery({
    queryKey: ["kkm_laporan", mapelId, kelasId, taId, semId],
    enabled: !!mapelId && !!kelasId && !!taId && !!semId,
    queryFn: async () => {
      const { data } = await supabase.from("kkm").select("nilai_kkm").eq("mapel_id", mapelId).eq("kelas_id", kelasId).eq("tahun_ajaran_id", taId).eq("semester_id", semId).maybeSingle();
      return data?.nilai_kkm || 70;
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ["laporan_pencapaian", kelasId, mapelId, taId, semId],
    enabled: show && !!kelasId && !!mapelId && !!taId && !!semId,
    queryFn: async () => {
      const { data: ksList } = await supabase.from("kelas_siswa").select("siswa:siswa_id(id, nis, nama)").eq("kelas_id", kelasId).eq("aktif", true);
      const siswaList = (ksList || []).map((ks: any) => ks.siswa).filter(Boolean).sort((a: any, b: any) => a.nama.localeCompare(b.nama));
      const kdIds = (kdList || []).map((kd: any) => kd.id);
      const nilaiMap: Record<string, Record<string, number>> = {};
      if (kdIds.length && siswaList.length) {
        const { data: existing } = await supabase.from("nilai_kd").select("siswa_id, kd_id, nilai").eq("kelas_id", kelasId).eq("tahun_ajaran_id", taId).eq("semester_id", semId).in("kd_id", kdIds);
        siswaList.forEach((s: any) => { nilaiMap[s.id] = {}; });
        (existing || []).forEach((e: any) => { if (nilaiMap[e.siswa_id]) nilaiMap[e.siswa_id][e.kd_id] = e.nilai ?? 0; });
      }
      return { siswaList, nilaiMap };
    },
  });

  const kkm = kkmVal || 70;

  const summary = useMemo(() => {
    if (!reportData || !kdList) return null;
    const { siswaList, nilaiMap } = reportData;
    let tuntas = 0, belumTuntas = 0;
    siswaList.forEach((s: any) => {
      const vals = kdList.map((kd: any) => nilaiMap[s.id]?.[kd.id] || 0).filter(n => n > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      if (avg >= kkm) tuntas++; else belumTuntas++;
    });
    return { tuntas, belumTuntas, total: siswaList.length };
  }, [reportData, kdList, kkm]);

  const exportData = useMemo(() => {
    if (!reportData || !kdList) return [];
    return reportData.siswaList.map((s: any, i: number) => {
      const row: any = { No: i + 1, NIS: s.nis, Nama: s.nama };
      kdList.forEach((kd: any) => { row[kd.kode_kd] = reportData.nilaiMap[s.id]?.[kd.id] || ""; });
      const vals = kdList.map((kd: any) => reportData.nilaiMap[s.id]?.[kd.id] || 0).filter(n => n > 0);
      row["Rata-rata"] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "-";
      row["Status"] = vals.length && Number(row["Rata-rata"]) >= kkm ? "Tuntas" : "Belum Tuntas";
      return row;
    });
  }, [reportData, kdList, kkm]);

  return (
    <div className="space-y-4 pt-4">
      <Card><CardContent className="pt-6">
        <div className="flex gap-3 items-end flex-wrap">
          <div><Label>Tahun Ajaran</Label><Select value={taId} onValueChange={setTaId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{taList?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Semester</Label><Select value={semId} onValueChange={setSemId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{semList?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => { setDeptId(v); setKelasId(""); setMapelId(""); }}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Kelas</Label><Select value={kelasId} onValueChange={setKelasId}><SelectTrigger className="w-36"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{filteredKelas?.map((k: any) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Mata Pelajaran</Label><Select value={mapelId} onValueChange={setMapelId}><SelectTrigger className="w-44"><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{mapelList?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.nama}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={() => setShow(true)} disabled={!kelasId || !mapelId || !taId || !semId}>Tampilkan</Button>
        </div>
      </CardContent></Card>

      {show && reportData && kdList && kdList.length > 0 && (
        <>
          {summary && (
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{summary.total}</p><p className="text-xs text-muted-foreground">Total Siswa</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-emerald-600">{summary.tuntas}</p><p className="text-xs text-muted-foreground">Tuntas</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-destructive">{summary.belumTuntas}</p><p className="text-xs text-muted-foreground">Belum Tuntas</p></CardContent></Card>
            </div>
          )}

          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">KKM: <strong>{kkm}</strong></p>
            <div className="flex gap-2">
              <ExportButton data={exportData} filename="laporan_pencapaian_kd" />
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Cetak</Button>
            </div>
          </div>

          {isLoading ? <Skeleton className="h-96" /> : (
            <Card><CardContent className="pt-6 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10">No</TableHead>
                  <TableHead>NIS</TableHead>
                  <TableHead>Nama Siswa</TableHead>
                  {kdList.map((kd: any) => <TableHead key={kd.id} className="text-xs text-center w-20" title={kd.deskripsi}>{kd.kode_kd}</TableHead>)}
                  <TableHead className="text-center">Rata-rata</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {reportData.siswaList.map((s: any, i: number) => {
                    const vals = kdList.map((kd: any) => reportData.nilaiMap[s.id]?.[kd.id] || 0).filter(n => n > 0);
                    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                    const tuntas = vals.length > 0 && avg >= kkm;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="text-sm">{s.nis}</TableCell>
                        <TableCell className="font-medium text-sm">{s.nama}</TableCell>
                        {kdList.map((kd: any) => {
                          const v = reportData.nilaiMap[s.id]?.[kd.id] || 0;
                          return <TableCell key={kd.id} className={cn("text-center text-xs font-bold", v > 0 && (v >= kkm ? "text-emerald-600" : "text-destructive"))}>{v || "-"}</TableCell>;
                        })}
                        <TableCell className={cn("text-center font-bold", avg > 0 && (avg >= kkm ? "text-emerald-600" : "text-destructive"))}>{avg > 0 ? avg.toFixed(1) : "-"}</TableCell>
                        <TableCell className="text-center">
                          {vals.length > 0 ? (
                            tuntas ? <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto" /> : <XCircle className="h-5 w-5 text-destructive mx-auto" />
                          ) : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}
