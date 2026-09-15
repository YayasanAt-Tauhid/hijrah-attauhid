import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSiswaList } from "@/hooks/useSiswa";
import { useKelas, useTahunAjaran } from "@/hooks/useAkademikData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowRightLeft, GraduationCap, LogOut, ArrowDown } from "lucide-react";

export default function MutasiSiswa() {
  const qc = useQueryClient();
  const { data: siswaList = [] } = useSiswaList();
  const { data: kelasList = [] } = useKelas();
  const { data: taList = [] } = useTahunAjaran();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterKelas, setFilterKelas] = useState("");
  const [targetKelas, setTargetKelas] = useState("");
  const [targetTA, setTargetTA] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const activeSiswa = siswaList.filter((s) => s.status === "aktif");
  // Filter kelas asal — wajib dipakai agar "pilih semua" tidak menyeret seluruh sekolah
  const shownSiswa = filterKelas
    ? activeSiswa.filter((s) => s.kelas_siswa?.find((ks) => ks.aktif)?.kelas?.id === filterKelas)
    : activeSiswa;

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleKenaikan = async () => {
    if (!targetKelas || !targetTA || selected.size === 0) {
      toast.error("Pilih siswa, kelas tujuan, dan tahun ajaran");
      return;
    }
    setIsProcessing(true);
    try {
      const { error } = await (supabase as any).rpc("akademik_mutasi", {
        p_ids: Array.from(selected), p_action: "kelas", p_kelas_id: targetKelas, p_tahun_ajaran_id: targetTA,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      toast.success(`${selected.size} siswa berhasil dipindahkan`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error("Gagal: " + e.message);
    }
    setIsProcessing(false);
  };

  const handleBulkStatus = async (status: string) => {
    if (selected.size === 0) { toast.error("Pilih siswa terlebih dahulu"); return; }
    setIsProcessing(true);
    try {
      const { error } = await (supabase as any).rpc("akademik_mutasi", {
        p_ids: Array.from(selected), p_action: status,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
      toast.success(`${selected.size} siswa diubah statusnya menjadi "${status}"`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error("Gagal: " + e.message);
    }
    setIsProcessing(false);
  };

  const SiswaTable = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={filterKelas || "__all__"} onValueChange={(v) => { setFilterKelas(v === "__all__" ? "" : v); setSelected(new Set()); }}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter kelas asal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Semua Kelas</SelectItem>
            {kelasList.map((k) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{shownSiswa.length} siswa aktif{filterKelas ? " di kelas ini" : ""}</p>
      </div>
      <div className="rounded-lg border overflow-x-auto max-h-[400px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selected.size === shownSiswa.length && shownSiswa.length > 0}
                onCheckedChange={(c) => {
                  setSelected(c ? new Set(shownSiswa.map((s) => s.id)) : new Set());
                }}
              />
            </TableHead>
            <TableHead>NIS</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Kelas Saat Ini</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shownSiswa.map((s) => {
            const kelas = s.kelas_siswa?.find((ks) => ks.aktif)?.kelas;
            return (
              <TableRow key={s.id}>
                <TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} /></TableCell>
                <TableCell>{s.nis || "-"}</TableCell>
                <TableCell>{s.nama}</TableCell>
                <TableCell>{kelas?.nama || "-"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mutasi Siswa</h1>
        <p className="text-sm text-muted-foreground">Kenaikan kelas, kelulusan, dan mutasi siswa</p>
      </div>

      <Tabs defaultValue="kenaikan">
        <TabsList>
          <TabsTrigger value="kenaikan"><ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />Kenaikan Kelas</TabsTrigger>
          <TabsTrigger value="kelulusan"><GraduationCap className="h-3.5 w-3.5 mr-1.5" />Kelulusan</TabsTrigger>
          <TabsTrigger value="pindah"><LogOut className="h-3.5 w-3.5 mr-1.5" />Pindah Sekolah</TabsTrigger>
          <TabsTrigger value="tinggal"><ArrowDown className="h-3.5 w-3.5 mr-1.5" />Tidak Naik</TabsTrigger>
        </TabsList>

        <TabsContent value="kenaikan" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Pilih Kelas Tujuan</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Select value={targetKelas} onValueChange={setTargetKelas}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Kelas tujuan" /></SelectTrigger>
                <SelectContent>{kelasList.map((k) => <SelectItem key={k.id} value={k.id}>{k.nama}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={targetTA} onValueChange={setTargetTA}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tahun ajaran" /></SelectTrigger>
                <SelectContent>{taList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={handleKenaikan} disabled={isProcessing}>
                Proses Kenaikan ({selected.size} siswa)
              </Button>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        <TabsContent value="kelulusan" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Button onClick={() => handleBulkStatus("alumni")} disabled={isProcessing}>
                <GraduationCap className="h-4 w-4 mr-2" />
                Luluskan {selected.size} Siswa
              </Button>
              <p className="text-sm text-muted-foreground">Siswa terpilih akan diubah statusnya menjadi Alumni</p>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        <TabsContent value="pindah" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3">
              <Button variant="outline" onClick={() => handleBulkStatus("pindah")} disabled={isProcessing}>
                <LogOut className="h-4 w-4 mr-2" />
                Tandai Pindah ({selected.size} siswa)
              </Button>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>

        <TabsContent value="tinggal" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-3">Siswa yang tidak naik kelas akan tetap di kelas saat ini di tahun ajaran baru.</p>
              <div className="flex items-center gap-3">
                <Select value={targetTA} onValueChange={setTargetTA}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tahun ajaran baru" /></SelectTrigger>
                  <SelectContent>{taList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={async () => {
                  if (!targetTA || selected.size === 0) { toast.error("Pilih siswa dan tahun ajaran"); return; }
                  setIsProcessing(true);
                  try {
                    const { error } = await (supabase as any).rpc("akademik_mutasi", {
                      p_ids: Array.from(selected), p_action: "tinggal", p_tahun_ajaran_id: targetTA,
                    });
                    if (error) throw error;
                    qc.invalidateQueries({ queryKey: ["siswa"] });
      qc.invalidateQueries({ queryKey: ["statistik_siswa"] });
                    toast.success(`${selected.size} siswa tinggal kelas`);
                    setSelected(new Set());
                  } catch (e: any) { toast.error(e.message); }
                  setIsProcessing(false);
                }} disabled={isProcessing}>
                  Proses Tinggal Kelas ({selected.size})
                </Button>
              </div>
            </CardContent>
          </Card>
          <SiswaTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
