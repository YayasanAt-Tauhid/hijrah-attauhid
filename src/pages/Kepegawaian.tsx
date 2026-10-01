import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/components/shared/StatsCard";
import { Users, UserCheck, Building2, ClipboardList, Award, ListOrdered } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLembaga } from "@/hooks/useKeuangan";
import { format } from "date-fns";

const today = format(new Date(), "yyyy-MM-dd");

export default function Kepegawaian() {
  const navigate = useNavigate();
  const { data: lembagaList } = useLembaga();

  // Fetch pegawai count per lembaga
  const { data: pegawaiData, isLoading: loadPeg } = useQuery({
    queryKey: ["kepegawaian_rekap_pegawai"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pegawai")
        .select("id, departemen_id, status")
        .eq("status", "aktif");
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch presensi hari ini
  const { data: presensiData, isLoading: loadPres } = useQuery({
    queryKey: ["kepegawaian_rekap_presensi", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presensi_pegawai")
        .select("id, departemen_id, status")
        .eq("tanggal", today)
        .eq("status", "H");
      if (error) throw error;
      return data || [];
    },
  });

  const loading = loadPeg || loadPres;

  const totalPegawai = pegawaiData?.length || 0;
  const totalHadir = presensiData?.length || 0;

  // Per-lembaga cards
  const lembagaCards = (lembagaList || []).map((l: any) => {
    const pegCount = (pegawaiData || []).filter((p: any) => p.departemen_id === l.id).length;
    const hadirCount = (presensiData || []).filter((p: any) => p.departemen_id === l.id).length;
    return { id: l.id, kode: l.kode, nama: l.nama, pegawai: pegCount, hadir: hadirCount };
  });

  // Yayasan (null dept)
  const yayasanPeg = (pegawaiData || []).filter((p: any) => !p.departemen_id).length;
  const yayasanHadir = (presensiData || []).filter((p: any) => !p.departemen_id).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Kepegawaian</h1>
        <p className="text-sm text-muted-foreground">Manajemen data pegawai dan presensi</p>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate("/kepegawaian/pegawai")}>
          <Users className="h-4 w-4 mr-2" />Data Pegawai
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/kepegawaian/anak-ptk")}>
          <UserCheck className="h-4 w-4 mr-2" />Kandidat Anak PTK
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/kepegawaian/presensi")}>
          <ClipboardList className="h-4 w-4 mr-2" />Presensi
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/kepegawaian/duk")}>
          <ListOrdered className="h-4 w-4 mr-2" />DUK
        </Button>
      </div>

      {/* Global Stats */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Pegawai Aktif" value={totalPegawai} icon={Users} color="primary" />
          <StatsCard title="Hadir Hari Ini" value={totalHadir} icon={UserCheck} color="success" />
          <StatsCard title="Lembaga" value={lembagaCards.length} icon={Building2} color="info" />
          <StatsCard title="Pegawai Yayasan" value={yayasanPeg} icon={Users} color="warning" />
        </div>
      )}

      {/* Per-lembaga cards */}
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5" />Rekap Per Lembaga — Hari Ini
          </h2>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Yayasan card */}
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-2">Yayasan (Lintas Lembaga)</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pegawai Aktif</span>
                      <span className="font-medium">{yayasanPeg}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hadir Hari Ini</span>
                      <span className="font-medium text-success">{yayasanHadir}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {lembagaCards.map((l) => (
                <Card key={l.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <p className="font-semibold text-sm mb-2">{l.kode} — {l.nama}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pegawai Aktif</span>
                        <span className="font-medium">{l.pegawai}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hadir Hari Ini</span>
                        <span className="font-medium text-success">{l.hadir}</span>
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
