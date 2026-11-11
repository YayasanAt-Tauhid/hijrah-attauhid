import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { Users, FileText, CreditCard, Bell } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { getNamaOrtuDariAnak } from "@/lib/ortu";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

export default function PortalDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Fetch anak-anak
  const { data: anakList = [] } = useQuery({
    queryKey: ["portal-anak", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select(
          `
          siswa_id,
          hubungan,
          siswa:siswa_id (
            id, nama, nis, jenis_kelamin,
            siswa_detail (nama_ayah, nama_ibu),
            kelas_siswa (
              aktif,
              kelas:kelas_id (
                nama,
                departemen:departemen_id (nama, kode)
              )
            )
          )
        `
        )
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Bug 7 fix: useMemo agar siswaIds tidak recreated setiap render
  // (array reference stabil → queryKey tidak berubah → tidak refetch terus)
  const siswaIds = useMemo(
    () => anakList.map((a: any) => a.siswa_id),
    [anakList]
  );

  // Nama orang tua tidak tersimpan di akun login — turunkan dari data anak
  // (lihat komentar di src/lib/ortu.ts). Fallback ke prefix email jika kosong.
  const namaOrtu = useMemo(() => getNamaOrtuDariAnak(anakList as any[]), [anakList]);

  const { data: tagihanCount = 0 } = useQuery({
    queryKey: ["portal-tagihan-count", siswaIds],
    queryFn: async () => {
      if (siswaIds.length === 0) return 0;
      const { data } = await supabase
        .from("v_tagihan_belum_bayar")
        .select("*")
        .in("siswa_id", siswaIds)
        .eq("sudah_bayar", false)
        .eq("menunggak", true);

      // nominal sudah final dari tabel tagihan (dihitung saat tagihan di-generate),
      // tidak perlu dihitung ulang di klien.
      return ((data || []) as any[]).filter(t => t.nominal > 0).length;
    },
    enabled: siswaIds.length > 0,
  });

  // Recent notifications
  const { data: recentNotifs = [] } = useQuery({
    queryKey: ["portal-notif-dashboard", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifikasi_ortu")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(3);
      return data || [];
    },
    enabled: !!user,
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Selamat Datang, {namaOrtu || user?.email?.split("@")[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Portal Orang Tua Hijrah At-Tauhid
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{anakList.length}</p>
              <p className="text-sm text-muted-foreground">Anak Terdaftar</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate("/portal/tagihan")}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{tagihanCount}</p>
              <p className="text-sm text-muted-foreground">Tunggakan</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate("/portal/pembayaran")}
        >
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Riwayat</p>
              <p className="text-sm text-muted-foreground">Pembayaran</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Anak List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Data Anak</CardTitle>
        </CardHeader>
        <CardContent>
          {anakList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada data anak yang terhubung. Hubungi admin sekolah.
            </p>
          ) : (
            <div className="space-y-3">
              {anakList.map((item: any) => {
                const siswa = item.siswa;
                const activeKelas = siswa?.kelas_siswa?.find(
                  (ks: any) => ks.aktif
                );
                return (
                  <div
                    key={item.siswa_id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{siswa?.nama}</p>
                      <p className="text-sm text-muted-foreground">
                        NIS: {siswa?.nis || "-"} •{" "}
                        {activeKelas?.kelas?.departemen?.nama || "-"} —{" "}
                        {activeKelas?.kelas?.nama || "-"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Notifications */}
      {recentNotifs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notifikasi Terbaru
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentNotifs.map((n: any) => (
              <div
                key={n.id}
                className={`rounded-lg border p-3 text-sm cursor-pointer hover:bg-muted/50 ${
                  !n.dibaca ? "bg-emerald-50 border-emerald-200" : ""
                }`}
                onClick={() => n.url && navigate(n.url)}
              >
                <p className="font-medium">{n.judul}</p>
                <p className="text-muted-foreground text-xs mt-1">
                  {n.pesan}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {n.created_at &&
                    format(new Date(n.created_at), "dd MMM yyyy HH:mm", {
                      locale: idLocale,
                    })}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
