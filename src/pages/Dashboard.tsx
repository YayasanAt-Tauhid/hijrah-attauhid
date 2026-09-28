import { Users, GraduationCap, Wallet, BookOpen, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { getAkademikManagedDepartemenIds } from "@/lib/akademikScope";
import { id as idLocale } from "date-fns/locale";

function formatRupiahSingkat(n: number): string {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}jt`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return `Rp ${n}`;
}

const COLORS = ["hsl(210, 80%, 30%)", "hsl(38, 92%, 50%)"];
const STATUS_COLORS: Record<string, string> = {
  H: "hsl(142, 71%, 45%)",
  I: "hsl(38, 92%, 50%)",
  S: "hsl(199, 89%, 48%)",
  A: "hsl(0, 72%, 51%)",
};
const STATUS_LABELS: Record<string, string> = { H: "Hadir", I: "Izin", S: "Sakit", A: "Alpha" };
const HARI_SINGKAT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export default function Dashboard() {
  const { role } = useAuth();

  // 1. Total Siswa Aktif
  const { data: totalSiswa, isLoading: loadSiswa } = useQuery({
    queryKey: ["dashboard_total_siswa", role],
    queryFn: async () => {
      const managedDepartemenIds = await getAkademikManagedDepartemenIds(role);
      if (role === "admin_tu" && !managedDepartemenIds?.length) return 0;

      let q = supabase
        .from("siswa")
        .select("*", { count: "exact", head: true })
        .eq("status", "aktif");
      if (managedDepartemenIds) q = q.in("departemen_id", managedDepartemenIds);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },
  });

  // 2. Total Pegawai Aktif
  const { data: totalPegawai, isLoading: loadPegawai } = useQuery({
    queryKey: ["dashboard_total_pegawai"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pegawai")
        .select("*", { count: "exact", head: true })
        .eq("status", "aktif");
      if (error) throw error;
      return count || 0;
    },
  });

  // 3. Pembayaran Bulan Ini
  const { data: pembayaranBulanIni, isLoading: loadPembayaran } = useQuery({
    queryKey: ["dashboard_pembayaran_bulan"],
    queryFn: async () => {
      const now = new Date();
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const endM = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
      const endY = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
      const end = `${endY}-${String(endM).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("pembayaran")
        .select("jumlah")
        .gte("tanggal_bayar", start)
        .lt("tanggal_bayar", end);
      if (error) throw error;
      return (data || []).reduce((s, r) => s + Number(r.jumlah || 0), 0);
    },
  });

  // 4. Total Buku
  const { data: totalBuku, isLoading: loadBuku } = useQuery({
    queryKey: ["dashboard_total_buku"],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from("koleksi_buku")
          .select("*", { count: "exact", head: true });
        if (error) return 0;
        return count || 0;
      } catch { return 0; }
    },
  });

  // 5. Kehadiran 5 Hari Terakhir
  const { data: attendanceData, isLoading: loadAttendance } = useQuery({
    queryKey: ["dashboard_kehadiran_5hari"],
    queryFn: async () => {
      const today = new Date();
      const startDate = format(subDays(today, 4), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("presensi_siswa")
        .select("tanggal, status")
        .gte("tanggal", startDate)
        .order("tanggal");
      if (error) throw error;
      
      const grouped = new Map<string, { H: number; I: number; S: number; A: number }>();
      for (let i = 0; i < 5; i++) {
        const d = format(subDays(today, 4 - i), "yyyy-MM-dd");
        grouped.set(d, { H: 0, I: 0, S: 0, A: 0 });
      }
      (data || []).forEach((r) => {
        const entry = grouped.get(r.tanggal);
        if (entry && r.status && r.status in entry) {
          entry[r.status as keyof typeof entry]++;
        }
      });
      return Array.from(grouped, ([tanggal, counts]) => {
        const d = new Date(tanggal + "T00:00:00");
        return {
          hari: HARI_SINGKAT[d.getDay()],
          hadir: counts.H,
          izin: counts.I,
          alpa: counts.A,
        };
      });
    },
  });

  // 6. Komposisi Siswa
  const { data: genderData, isLoading: loadGender } = useQuery({
    queryKey: ["dashboard_komposisi_siswa", role],
    queryFn: async () => {
      const managedDepartemenIds = await getAkademikManagedDepartemenIds(role);
      if (role === "admin_tu" && !managedDepartemenIds?.length) {
        return [
          { name: "Laki-laki", value: 0 },
          { name: "Perempuan", value: 0 },
        ];
      }

      let q = supabase
        .from("siswa")
        .select("jenis_kelamin")
        .eq("status", "aktif");
      if (managedDepartemenIds) q = q.in("departemen_id", managedDepartemenIds);
      const { data, error } = await q;
      if (error) throw error;
      let L = 0, P = 0;
      (data || []).forEach((r) => {
        if (r.jenis_kelamin === "L") L++;
        else if (r.jenis_kelamin === "P") P++;
      });
      return [
        { name: "Laki-laki", value: L },
        { name: "Perempuan", value: P },
      ];
    },
  });

  // 7. Ringkasan Per Lembaga
  const { data: lembagaData, isLoading: loadLembaga } = useQuery({
    queryKey: ["dashboard_ringkasan_lembaga"],
    queryFn: async () => {
      const { data: depts, error: dErr } = await supabase
        .from("departemen")
        .select("id, nama, kode")
        .eq("aktif", true)
        .order("nama");
      if (dErr) throw dErr;
      if (!depts?.length) return [];

      // Count siswa aktif per dept via kelas_siswa
      const { data: kelasSiswa } = await supabase
        .from("kelas_siswa")
        .select("kelas:kelas_id(departemen_id), siswa:siswa_id(status)")
        .eq("aktif", true);

      const { data: pegawaiData } = await supabase
        .from("pegawai")
        .select("departemen_id")
        .eq("status", "aktif");

      return depts.map((d) => {
        const siswaCount = (kelasSiswa || []).filter(
          (ks: any) => ks.kelas?.departemen_id === d.id && ks.siswa?.status === "aktif"
        ).length;
        const pegawaiCount = (pegawaiData || []).filter(
          (p) => p.departemen_id === d.id
        ).length;
        return { ...d, siswaCount, pegawaiCount };
      });
    },
  });

  const stats = [
    { label: "Total Siswa", value: totalSiswa, loading: loadSiswa, icon: GraduationCap },
    { label: "Total Pegawai", value: totalPegawai, loading: loadPegawai, icon: Users },
    { label: "Pembayaran Bulan Ini", value: pembayaranBulanIni, loading: loadPembayaran, icon: Wallet, isRupiah: true },
    { label: "Total Buku", value: totalBuku, loading: loadBuku, icon: BookOpen },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Selamat datang di Hijrah At-Tauhid — Ringkasan informasi sekolah
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="stat-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  {s.loading ? (
                    <Skeleton className="h-6 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {s.isRupiah
                        ? formatRupiahSingkat(s.value || 0)
                        : (s.value ?? 0).toLocaleString("id-ID")}
                    </p>
                  )}
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <s.icon className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Kehadiran Siswa 5 Hari Terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {loadAttendance ? (
              <Skeleton className="h-[280px] w-full" />
            ) : attendanceData && attendanceData.some((d) => d.hadir > 0 || d.izin > 0 || d.alpa > 0) ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={attendanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(210,20%,90%)" />
                  <XAxis dataKey="hari" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="hadir" fill="hsl(142,71%,45%)" name="Hadir" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="izin" fill="hsl(38,92%,50%)" name="Izin" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="alpa" fill="hsl(0,72%,51%)" name="Alpha" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Belum ada data presensi
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Komposisi Siswa</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loadGender ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={genderData || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      strokeWidth={2}
                    >
                      {(genderData || []).map((_, index) => (
                        <Cell key={index} fill={COLORS[index]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  {(genderData || []).map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: COLORS[i] }}
                      />
                      <span className="text-muted-foreground">
                        {d.name}: {d.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ringkasan Per Lembaga */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Ringkasan Per Lembaga
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadLembaga ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(lembagaData || []).map((d) => (
                <Card key={d.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <p className="font-semibold text-sm mb-2">{d.kode ? `${d.kode} — ` : ""}{d.nama}</p>
                    <div className="flex gap-6 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <GraduationCap className="h-3 w-3" />
                        <span>{d.siswaCount} siswa</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span>{d.pegawaiCount} pegawai</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
