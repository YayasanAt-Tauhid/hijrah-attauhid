import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/components/shared/StatsCard";
import { useDepartemen } from "@/hooks/useAkademikData";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Users, UserCheck, UserX, GraduationCap } from "lucide-react";

const COLORS = ["hsl(199, 89%, 48%)", "hsl(340, 82%, 52%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(262, 83%, 58%)", "hsl(25, 95%, 53%)"];

export default function StatistikSiswa() {
  const [deptId, setDeptId] = useState("");
  const { data: depts } = useDepartemen();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["statistik_siswa", deptId],
    queryFn: async () => {
      const all = await fetchAllPages<any>((from, to) => {
        let q = supabase
          .from("siswa")
          .select("id, jenis_kelamin, status, agama, angkatan_id, angkatan:angkatan_id(nama)")
          .order("id")
          .range(from, to);
        if (deptId) q = q.eq("departemen_id", deptId);
        return q;
      });

      const total = all.length;
      const aktif = all.filter((s: any) => s.status === "aktif").length;
      const lulus = all.filter((s: any) => ["alumni", "lulus"].includes(s.status)).length;
      const nonAktif = total - aktif;

      // Gender
      const genderData = [
        { name: "Laki-laki", value: all.filter((s: any) => s.jenis_kelamin === "L").length },
        { name: "Perempuan", value: all.filter((s: any) => s.jenis_kelamin === "P").length },
      ];

      // Status
      const statusMap = new Map<string, number>();
      all.forEach((s: any) => statusMap.set(s.status || "aktif", (statusMap.get(s.status || "aktif") || 0) + 1));
      const statusData = Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));

      // Agama
      const agamaMap = new Map<string, number>();
      all.forEach((s: any) => { if (s.agama) agamaMap.set(s.agama, (agamaMap.get(s.agama) || 0) + 1); });
      const agamaData = Array.from(agamaMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

      // Per angkatan
      const angkatanMap = new Map<string, number>();
      all.filter((s: any) => s.status === "aktif").forEach((s: any) => {
        const nama = (s.angkatan as any)?.nama || "Tanpa Angkatan";
        angkatanMap.set(nama, (angkatanMap.get(nama) || 0) + 1);
      });
      const angkatanData = Array.from(angkatanMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name));

      return { total, aktif, lulus, nonAktif, genderData, statusData, agamaData, angkatanData };
    },
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Statistik Siswa</h1>
        <p className="text-sm text-muted-foreground">Grafik dan data statistik siswa</p>
      </div>

      <div className="flex gap-3">
        <div><Label>Lembaga</Label><Select value={deptId} onValueChange={(v) => setDeptId(v === "__all__" ? "" : v)}><SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger><SelectContent><SelectItem value="__all__">Semua</SelectItem>{depts?.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.kode || d.nama}</SelectItem>)}</SelectContent></Select></div>
      </div>

      {isLoading ? <Skeleton className="h-96" /> : stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatsCard title="Total Siswa" value={stats.total} icon={Users} color="primary" />
            <StatsCard title="Siswa Aktif" value={stats.aktif} icon={UserCheck} color="success" />
            <StatsCard title="Alumni/Lulus" value={stats.lulus} icon={GraduationCap} color="info" />
            <StatsCard title="Non-Aktif" value={stats.nonAktif} icon={UserX} color="destructive" />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Jenis Kelamin</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={stats.genderData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {stats.genderData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Status Siswa</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={stats.statusData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {stats.statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Siswa per Angkatan</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={stats.angkatanData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(199, 89%, 48%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Berdasarkan Agama</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={stats.agamaData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={80} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(262, 83%, 58%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
