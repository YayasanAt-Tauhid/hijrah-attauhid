import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLembaga } from "@/hooks/useKeuangan";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatsCard } from "@/components/shared/StatsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCheck, Clock, AlertTriangle, HeartPulse, Save } from "lucide-react";
import { format } from "date-fns";

const STATUS_OPTIONS = [
  { value: "H", label: "Hadir", color: "bg-success/15 text-success" },
  { value: "I", label: "Izin", color: "bg-info/15 text-info" },
  { value: "S", label: "Sakit", color: "bg-warning/15 text-warning" },
  { value: "A", label: "Alpha", color: "bg-destructive/15 text-destructive" },
  { value: "C", label: "Cuti", color: "bg-muted text-muted-foreground" },
];

const BULAN_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_ORDER_AKADEMIK = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

interface PresensiRow {
  pegawai_id: string;
  nama: string;
  jabatan: string | null;
  dept_kode: string | null;
  status: string;
  jam_masuk: string;
  jam_pulang: string;
  keterangan: string;
}

export default function PresensiPegawai() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const canInput = role === "admin";

  const [deptId, setDeptId] = useState("");
  const [tanggal, setTanggal] = useState(format(new Date(), "yyyy-MM-dd"));
  const [rows, setRows] = useState<PresensiRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Rekap tab
  const now = new Date();
  const [rekapDeptId, setRekapDeptId] = useState("");
  const [rekapBulan, setRekapBulan] = useState(now.getMonth() + 1);
  const [rekapTahun, setRekapTahun] = useState(now.getFullYear());

  const { data: lembagaList } = useLembaga();

  // Fetch pegawai aktif for selected lembaga
  const { data: pegawaiAktif, isLoading: loadPeg } = useQuery({
    queryKey: ["pegawai_presensi", deptId],
    enabled: !!deptId,
    queryFn: async () => {
      let q = supabase
        .from("pegawai")
        .select("id, nama, jabatan, departemen_id, departemen:departemen_id(kode)")
        .eq("status", "aktif")
        .order("nama");

      // Include pegawai in this dept + pegawai yayasan (null dept)
      q = q.or(`departemen_id.eq.${deptId},departemen_id.is.null`);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        dept_kode: r.departemen?.kode || null,
      }));
    },
  });

  // Fetch existing presensi for date + dept
  const { data: existingPresensi } = useQuery({
    queryKey: ["presensi_pegawai", deptId, tanggal],
    enabled: !!deptId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presensi_pegawai")
        .select("*")
        .eq("departemen_id", deptId)
        .eq("tanggal", tanggal);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Build rows when pegawai or presensi changes
  useMemo(() => {
    if (!pegawaiAktif) return;
    const presensiMap = new Map<string, any>();
    (existingPresensi || []).forEach((p: any) => presensiMap.set(p.pegawai_id, p));

    const built: PresensiRow[] = pegawaiAktif.map((p: any) => {
      const existing = presensiMap.get(p.id);
      return {
        pegawai_id: p.id,
        nama: p.nama,
        jabatan: p.jabatan,
        dept_kode: p.dept_kode,
        status: existing?.status || "H",
        jam_masuk: existing?.jam_masuk || "",
        jam_pulang: existing?.jam_pulang || "",
        keterangan: existing?.keterangan || "",
      };
    });
    setRows(built);
  }, [pegawaiAktif, existingPresensi]);

  const updateRow = (idx: number, field: keyof PresensiRow, value: string) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  // Stats
  const countByStatus = (s: string) => rows.filter((r) => r.status === s).length;

  const handleSaveAll = async () => {
    if (!deptId || !tanggal) return;
    setSaving(true);
    try {
      const payload = rows.map((r) => ({
        pegawai_id: r.pegawai_id,
        departemen_id: deptId,
        tanggal,
        status: r.status,
        jam_masuk: r.jam_masuk || null,
        jam_pulang: r.jam_pulang || null,
        keterangan: r.keterangan || null,
      }));

      const { error } = await supabase
        .from("presensi_pegawai")
        .upsert(payload, { onConflict: "pegawai_id,tanggal" });

      if (error) throw error;
      toast.success("Presensi berhasil disimpan");
      qc.invalidateQueries({ queryKey: ["presensi_pegawai"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Rekap bulanan
  const { data: rekapData, isLoading: loadRekap } = useQuery({
    queryKey: ["rekap_presensi_pegawai", rekapDeptId, rekapBulan, rekapTahun],
    enabled: !!rekapDeptId,
    queryFn: async () => {
      const startDate = `${rekapTahun}-${String(rekapBulan).padStart(2, "0")}-01`;
      const endMonth = rekapBulan === 12 ? 1 : rekapBulan + 1;
      const endYear = rekapBulan === 12 ? rekapTahun + 1 : rekapTahun;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

      const { data, error } = await supabase
        .from("presensi_pegawai")
        .select("pegawai_id, status, pegawai:pegawai_id(nama, jabatan, departemen:departemen_id(kode))")
        .eq("departemen_id", rekapDeptId)
        .gte("tanggal", startDate)
        .lt("tanggal", endDate);

      if (error) throw error;

      // Group by pegawai
      const map = new Map<string, { nama: string; dept_kode: string; H: number; I: number; S: number; A: number; C: number }>();
      (data || []).forEach((r: any) => {
        const key = r.pegawai_id;
        if (!map.has(key)) {
          map.set(key, {
            nama: r.pegawai?.nama || "—",
            dept_kode: r.pegawai?.departemen?.kode || "Yayasan",
            H: 0, I: 0, S: 0, A: 0, C: 0,
          });
        }
        const entry = map.get(key)!;
        if (r.status in entry) (entry as any)[r.status]++;
      });

      return Array.from(map.values()).map((e) => ({
        ...e,
        total: e.H + e.I + e.S + e.A + e.C,
      }));
    },
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Presensi Pegawai</h1>
        <p className="text-sm text-muted-foreground">Input dan rekap presensi harian pegawai</p>
      </div>

      <Tabs defaultValue="input">
        <TabsList>
          <TabsTrigger value="input">Input Harian</TabsTrigger>
          <TabsTrigger value="rekap">Rekap Bulanan</TabsTrigger>
        </TabsList>

        {/* === INPUT HARIAN === */}
        <TabsContent value="input" className="space-y-6">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <Label>Lembaga *</Label>
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                <SelectContent>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tanggal</Label>
              <Input type="date" className="w-44" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
          </div>

          {!deptId ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Pilih lembaga terlebih dahulu</CardContent></Card>
          ) : loadPeg ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatsCard title="Hadir" value={countByStatus("H")} icon={UserCheck} color="success" />
                <StatsCard title="Izin" value={countByStatus("I")} icon={Clock} color="info" />
                <StatsCard title="Sakit" value={countByStatus("S")} icon={HeartPulse} color="warning" />
                <StatsCard title="Alpha" value={countByStatus("A")} icon={AlertTriangle} color="destructive" />
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="rounded-lg border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Nama</TableHead>
                          <TableHead>Jabatan</TableHead>
                          <TableHead>Lembaga</TableHead>
                          <TableHead className="w-28">Status</TableHead>
                          <TableHead className="w-28">Jam Masuk</TableHead>
                          <TableHead className="w-28">Jam Pulang</TableHead>
                          <TableHead>Keterangan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r, i) => (
                          <TableRow key={r.pegawai_id}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{r.nama}</TableCell>
                            <TableCell className="text-sm">{r.jabatan || "—"}</TableCell>
                            <TableCell className="text-sm">{r.dept_kode || <span className="italic text-muted-foreground">Yayasan</span>}</TableCell>
                            <TableCell>
                              <Select value={r.status} onValueChange={(v) => updateRow(i, "status", v)} disabled={!canInput}>
                                <SelectTrigger className={`h-8 text-xs font-medium ${STATUS_OPTIONS.find(s => s.value === r.status)?.color || ""}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTIONS.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>{s.value} — {s.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input type="time" className="h-8 text-xs" value={r.jam_masuk} onChange={(e) => updateRow(i, "jam_masuk", e.target.value)} disabled={!canInput} />
                            </TableCell>
                            <TableCell>
                              <Input type="time" className="h-8 text-xs" value={r.jam_pulang} onChange={(e) => updateRow(i, "jam_pulang", e.target.value)} disabled={!canInput} />
                            </TableCell>
                            <TableCell>
                              <Input className="h-8 text-xs" value={r.keterangan} onChange={(e) => updateRow(i, "keterangan", e.target.value)} disabled={!canInput} placeholder="—" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {canInput && rows.length > 0 && (
                    <div className="mt-4 flex justify-end">
                      <Button onClick={handleSaveAll} disabled={saving}>
                        <Save className="h-4 w-4 mr-2" />{saving ? "Menyimpan..." : "Simpan Semua"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* === REKAP BULANAN === */}
        <TabsContent value="rekap" className="space-y-6">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <Label>Lembaga</Label>
              <Select value={rekapDeptId} onValueChange={setRekapDeptId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                <SelectContent>
                  {lembagaList?.map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.kode} — {l.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bulan</Label>
              <Select value={String(rekapBulan)} onValueChange={(v) => setRekapBulan(Number(v))}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BULAN_ORDER_AKADEMIK.map((m) => <SelectItem key={m} value={String(m)}>{BULAN_NAMES[m - 1]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tahun</Label>
              <Input type="number" className="w-24" value={rekapTahun} onChange={(e) => setRekapTahun(Number(e.target.value))} />
            </div>
          </div>

          {!rekapDeptId ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">Pilih lembaga terlebih dahulu</CardContent></Card>
          ) : loadRekap ? (
            <Skeleton className="h-40" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rekap Presensi — {BULAN_NAMES[rekapBulan - 1]} {rekapTahun}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Nama</TableHead>
                        <TableHead>Lembaga</TableHead>
                        <TableHead className="text-center w-14">H</TableHead>
                        <TableHead className="text-center w-14">I</TableHead>
                        <TableHead className="text-center w-14">S</TableHead>
                        <TableHead className="text-center w-14">A</TableHead>
                        <TableHead className="text-center w-14">C</TableHead>
                        <TableHead className="text-center w-16">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!rekapData || rekapData.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Tidak ada data presensi</TableCell>
                        </TableRow>
                      ) : rekapData.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{r.nama}</TableCell>
                          <TableCell>{r.dept_kode}</TableCell>
                          <TableCell className="text-center text-success font-medium">{r.H}</TableCell>
                          <TableCell className="text-center text-info font-medium">{r.I}</TableCell>
                          <TableCell className="text-center text-warning font-medium">{r.S}</TableCell>
                          <TableCell className="text-center text-destructive font-medium">{r.A}</TableCell>
                          <TableCell className="text-center text-muted-foreground font-medium">{r.C}</TableCell>
                          <TableCell className="text-center font-bold">{r.total}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
