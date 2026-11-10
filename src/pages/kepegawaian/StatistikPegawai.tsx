import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useLembaga } from "@/hooks/useKeuangan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatsCard } from "@/components/shared/StatsCard";
import { Users, UserCheck, GraduationCap, Briefcase, Building2, Award, BookOpen } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = [
  "hsl(var(--primary))", "hsl(142 76% 36%)", "hsl(45 93% 47%)",
  "hsl(0 84% 60%)", "hsl(262 83% 58%)", "hsl(199 89% 48%)",
  "hsl(24 95% 53%)", "hsl(330 81% 60%)",
];

type PegawaiRow = {
  id: string;
  nama: string;
  jabatan: string | null;
  jenis_kelamin: string | null;
  agama: string | null;
  status: string | null;
  departemen_id: string | null;
};

export default function StatistikPegawai() {
  const { data: lembagaList } = useLembaga();

  const { data: pegawaiList, isLoading } = useQuery({
    queryKey: ["pegawai_statistik"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pegawai").select("id, nama, jabatan, jenis_kelamin, agama, status, departemen_id").order("nama");
      if (error) throw error;
      return (data || []) as PegawaiRow[];
    },
  });

  const { data: diklatCount } = useQuery({
    queryKey: ["diklat_count"],
    queryFn: async () => {
      const { count } = await supabase.from("riwayat_diklat").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: pendidikanData } = useQuery({
    queryKey: ["pendidikan_stats"],
    queryFn: async () => {
      const { data } = await supabase.from("riwayat_pendidikan").select("jenjang, pegawai_id");
      return data || [];
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;

  const all = pegawaiList || [];
  const aktif = all.filter(p => p.status === "aktif");
  const guru = aktif.filter(p => (p.jabatan || "").toLowerCase().includes("guru"));
  const tendik = aktif.length - guru.length;

  // Gender distribution
  const genderData = [
    { name: "Laki-laki", value: aktif.filter(p => p.jenis_kelamin === "L").length },
    { name: "Perempuan", value: aktif.filter(p => p.jenis_kelamin === "P").length },
  ].filter(d => d.value > 0);

  // Distribution per lembaga
  const lembagaMap = new Map<string, string>();
  lembagaList?.forEach((l) => lembagaMap.set(l.id, l.kode || l.nama));

  const perLembaga: { name: string; guru: number; tendik: number }[] = [];
  const yayasanGuru = aktif.filter(p => !p.departemen_id && (p.jabatan || "").toLowerCase().includes("guru")).length;
  const yayasanTendik = aktif.filter(p => !p.departemen_id && !(p.jabatan || "").toLowerCase().includes("guru")).length;
  if (yayasanGuru || yayasanTendik) perLembaga.push({ name: "Yayasan", guru: yayasanGuru, tendik: yayasanTendik });

  lembagaList?.forEach((l) => {
    const lPeg = aktif.filter(p => p.departemen_id === l.id);
    const lGuru = lPeg.filter(p => (p.jabatan || "").toLowerCase().includes("guru")).length;
    const lTendik = lPeg.length - lGuru;
    if (lGuru || lTendik) perLembaga.push({ name: l.kode || l.nama, guru: lGuru, tendik: lTendik });
  });

  // Agama distribution
  const agamaCount = aktif.reduce<Record<string, number>>((acc, p) => {
    const a = p.agama || "Tidak Diketahui";
    acc[a] = (acc[a] || 0) + 1;
    return acc;
  }, {});
  const agamaData = Object.entries(agamaCount).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Pendidikan terakhir per pegawai (highest)
  const JENJANG_ORDER = ["SD", "SMP", "SMA", "D3", "S1", "S2", "S3"];
  const pegHighest = new Map<string, string>();
  (pendidikanData || []).forEach(p => {
    const cur = pegHighest.get(p.pegawai_id!) || "";
    if (JENJANG_ORDER.indexOf(p.jenjang) > JENJANG_ORDER.indexOf(cur)) {
      pegHighest.set(p.pegawai_id!, p.jenjang);
    }
  });
  const pendidikanCount = Array.from(pegHighest.values()).reduce<Record<string, number>>((acc, j) => {
    acc[j] = (acc[j] || 0) + 1;
    return acc;
  }, {});
  const pendidikanChartData = JENJANG_ORDER.filter(j => pendidikanCount[j]).map(j => ({ name: j, value: pendidikanCount[j] }));

  // Struktur organisasi (simple hierarchy)
  const jabatanGroups = aktif.reduce<Record<string, string[]>>((acc, p) => {
    const jab = p.jabatan || "Lainnya";
    if (!acc[jab]) acc[jab] = [];
    acc[jab].push(p.nama);
    return acc;
  }, {});
  const sortedJabatan = Object.entries(jabatanGroups).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Statistik Kepegawaian</h1>
        <p className="text-sm text-muted-foreground">Ringkasan data dan struktur organisasi pegawai</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Total Pegawai" value={all.length} icon={Users} color="primary" />
        <StatsCard title="Aktif" value={aktif.length} icon={UserCheck} color="success" />
        <StatsCard title="Guru" value={guru.length} icon={GraduationCap} color="info" />
        <StatsCard title="Tenaga Kependidikan" value={tendik} icon={Briefcase} color="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Gender Pie */}
        <Card>
          <CardHeader><CardTitle className="text-base">Distribusi Gender</CardTitle></CardHeader>
          <CardContent>
            {genderData.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={genderData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                    {genderData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">Belum ada data</p>}
          </CardContent>
        </Card>

        {/* Agama Pie */}
        <Card>
          <CardHeader><CardTitle className="text-base">Distribusi Agama</CardTitle></CardHeader>
          <CardContent>
            {agamaData.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={agamaData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                    {agamaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">Belum ada data</p>}
          </CardContent>
        </Card>

        {/* Per Lembaga Bar */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Pegawai Per Lembaga</CardTitle></CardHeader>
          <CardContent>
            {perLembaga.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={perLembaga}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="guru" name="Guru" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                  <Bar dataKey="tendik" name="Tendik" fill="hsl(45 93% 47%)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">Belum ada data</p>}
          </CardContent>
        </Card>

        {/* Pendidikan Bar */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />Jenjang Pendidikan</CardTitle></CardHeader>
          <CardContent>
            {pendidikanChartData.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={pendidikanChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" name="Jumlah" fill="hsl(262 83% 58%)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-8">Belum ada data riwayat pendidikan</p>}
          </CardContent>
        </Card>
      </div>

      {/* Diklat summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatsCard title="Total Sertifikasi/Diklat" value={diklatCount || 0} icon={Award} color="primary" />
        <StatsCard title="Jenjang Pendidikan Tercatat" value={pegHighest.size} icon={BookOpen} color="info" />
      </div>

      {/* Struktur Organisasi */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />Struktur Jabatan</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedJabatan.map(([jabatan, names]) => (
              <div key={jabatan} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-sm">{jabatan}</p>
                  <Badge variant="secondary">{names.length}</Badge>
                </div>
                <div className="space-y-0.5">
                  {names.sort().map((n, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{n}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
