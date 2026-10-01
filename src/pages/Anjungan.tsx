import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { CalendarDays, Users, BookOpen, AlertTriangle, Clock } from "lucide-react";
import { BrandLogo } from "@/components/shared/BrandLogo";

export default function Anjungan() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // School info
  const { data: sekolah } = useQuery({
    queryKey: ["anjungan-sekolah"],
    queryFn: async () => {
      const { data } = await supabase.from("sekolah").select("*").limit(1).single();
      return data;
    },
  });

  // Active announcements
  const { data: pengumuman = [] } = useQuery({
    queryKey: ["anjungan-pengumuman"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase
        .from("pengumuman")
        .select("*")
        .eq("aktif", true)
        .lte("tanggal_tayang", today)
        .order("penting", { ascending: false })
        .order("tanggal_tayang", { ascending: false })
        .limit(8);
      return data || [];
    },
    refetchInterval: 60000,
  });

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["anjungan-stats"],
    queryFn: async () => {
      const { count: totalSiswa } = await supabase
        .from("siswa")
        .select("*", { count: "exact", head: true })
        .eq("status", "aktif");
      const { count: totalGuru } = await supabase
        .from("pegawai")
        .select("*", { count: "exact", head: true })
        .eq("status", "aktif");
      const { count: totalBuku } = await supabase
        .from("koleksi_buku")
        .select("*", { count: "exact", head: true })
        .eq("aktif", true);
      return {
        totalSiswa: totalSiswa || 0,
        totalGuru: totalGuru || 0,
        totalBuku: totalBuku || 0,
      };
    },
    refetchInterval: 300000,
  });

  // Today's schedule summary
  const today = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][currentTime.getDay()];

  const { data: jadwalHariIni = [] } = useQuery({
    queryKey: ["anjungan-jadwal", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("jadwal")
        .select("*, kelas:kelas_id(nama), mapel:mapel_id(nama), pegawai:pegawai_id(nama)")
        .eq("hari", today)
        .order("jam_mulai")
        .limit(20);
      return data || [];
    },
    refetchInterval: 300000,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-emerald-900 text-white">
      {/* Header */}
      <header className="bg-black/30 backdrop-blur border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BrandLogo className="h-12 w-12 rounded-xl bg-white shadow-sm" />
            <div>
              <h1 className="text-xl font-bold">{sekolah?.nama || "Hijrah At-Tauhid"}</h1>
              <p className="text-sm text-emerald-300">{sekolah?.alamat || "Anjungan Informasi"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-mono font-bold tabular-nums">
              {format(currentTime, "HH:mm:ss")}
            </p>
            <p className="text-sm text-emerald-300">
              {format(currentTime, "EEEE, dd MMMM yyyy", { locale: idLocale })}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-white/10 border-white/10 text-white">
            <CardContent className="flex items-center gap-4 p-5">
              <Users className="h-8 w-8 text-emerald-400" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalSiswa ?? "..."}</p>
                <p className="text-sm text-emerald-300">Siswa Aktif</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/10 border-white/10 text-white">
            <CardContent className="flex items-center gap-4 p-5">
              <Users className="h-8 w-8 text-blue-400" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalGuru ?? "..."}</p>
                <p className="text-sm text-blue-300">Guru & Staff</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/10 border-white/10 text-white">
            <CardContent className="flex items-center gap-4 p-5">
              <BookOpen className="h-8 w-8 text-amber-400" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalBuku ?? "..."}</p>
                <p className="text-sm text-amber-300">Koleksi Buku</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          {/* Pengumuman */}
          <Card className="bg-white/10 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <CalendarDays className="h-5 w-5" /> Pengumuman
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pengumuman.length === 0 ? (
                <p className="text-emerald-300 text-sm">Tidak ada pengumuman saat ini</p>
              ) : (
                pengumuman.map((p: any) => (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-4 ${
                      p.penting
                        ? "border-amber-500/50 bg-amber-500/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {p.penting && (
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                      )}
                      <span className="font-semibold text-sm">{p.judul}</span>
                      <Badge variant="secondary" className="text-[10px] bg-white/10 text-white/70">
                        {p.kategori}
                      </Badge>
                    </div>
                    <p className="text-sm text-emerald-200 line-clamp-2">{p.konten}</p>
                    <p className="text-[10px] text-emerald-400 mt-1">
                      {p.tanggal_tayang && format(new Date(p.tanggal_tayang), "dd MMM yyyy", { locale: idLocale })}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Jadwal Hari Ini */}
          <Card className="bg-white/10 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Clock className="h-5 w-5" /> Jadwal {today}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {jadwalHariIni.length === 0 ? (
                <p className="text-emerald-300 text-sm">Tidak ada jadwal hari ini</p>
              ) : (
                jadwalHariIni.slice(0, 10).map((j: any) => (
                  <div key={j.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                    <div className="text-emerald-400 font-mono text-xs shrink-0">
                      {j.jam_mulai?.slice(0, 5)}-{j.jam_selesai?.slice(0, 5)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{j.mapel?.nama}</p>
                      <p className="text-xs text-emerald-300">
                        {j.kelas?.nama} • {j.pegawai?.nama}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="mt-8 border-t border-white/10 py-4 text-center text-xs text-emerald-400">
        © {new Date().getFullYear()} Hijrah At-Tauhid — Anjungan Informasi Sekolah
      </footer>
    </div>
  );
}
