import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck, CheckCircle, XCircle, Clock, AlertTriangle, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { PortalHero } from "@/components/portal/PortalHero";
import { AnakChips, AnakInfo } from "@/components/portal/AnakChips";
import { ringkasPresensi, type PresensiStatus } from "@/lib/portalAkademik";
import { cn } from "@/lib/utils";

// Teks status selalu ditampilkan di samping ikon/warna agar tidak hanya
// bergantung pada warna.
const statusConfig: Record<PresensiStatus, { label: string; icon: LucideIcon; tint: string }> = {
  H: { label: "Hadir", icon: CheckCircle, tint: "bg-emerald-100 text-emerald-800" },
  I: { label: "Izin", icon: Clock, tint: "bg-blue-100 text-blue-800" },
  S: { label: "Sakit", icon: AlertTriangle, tint: "bg-amber-100 text-amber-900" },
  A: { label: "Alpha", icon: XCircle, tint: "bg-red-100 text-red-800" },
};

const URUTAN_STATUS: PresensiStatus[] = ["H", "I", "S", "A"];
const kartu = "rounded-[1.125rem] border bg-card shadow-sm";

// Keliling lingkaran r=42 pada kanvas 104px, untuk cincin persentase.
const KELILING = 2 * Math.PI * 42;

export default function PortalPresensi() {
  const { user } = useAuth();
  const [selectedSiswa, setSelectedSiswa] = useState("");

  const { data: anakList = [] } = useQuery({
    queryKey: ["portal-anak-presensi", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select("siswa_id, siswa:siswa_id (id, nama, nis)")
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  // Auto-select first child
  const effectiveSiswa = selectedSiswa || anakList[0]?.siswa_id || "";

  const { data: presensi = [], isLoading } = useQuery({
    queryKey: ["portal-presensi", effectiveSiswa],
    queryFn: async () => {
      const { data } = await supabase
        .from("presensi_siswa")
        .select("*, kelas:kelas_id(nama)")
        .eq("siswa_id", effectiveSiswa)
        .order("tanggal", { ascending: false })
        .limit(100);
      return data || [];
    },
    enabled: !!effectiveSiswa,
  });

  const { counts, total, persenHadir } = useMemo(() => ringkasPresensi(presensi), [presensi]);

  const selectedAnak = anakList.find((a: any) => a.siswa_id === effectiveSiswa);
  const siswaInfo = selectedAnak?.siswa as any;
  const pilihanAnak = anakList.map((a: any) => ({ id: a.siswa_id, nama: a.siswa?.nama ?? "-" }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 animate-fade-in">
      <PortalHero
        title="Presensi Anak"
        subtitle="Rekap kehadiran anak di sekolah."
        icon={CalendarCheck}
      />

      {anakList.length > 1 ? (
        <AnakChips anak={pilihanAnak} selectedId={effectiveSiswa} onSelect={setSelectedSiswa} />
      ) : (
        siswaInfo && <AnakInfo nama={siswaInfo.nama} nis={siswaInfo.nis} />
      )}

      {/* Ringkasan */}
      <section aria-label="Ringkasan presensi" className={cn(kartu, "space-y-3.5 p-4")}>
        {total > 0 && (
          <p className="text-[13px] font-bold text-muted-foreground">Dari {total} presensi terakhir</p>
        )}
        <div className="flex items-center gap-4">
          <div className="relative h-[104px] w-[104px] shrink-0">
            <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
              <circle cx="52" cy="52" r="42" fill="none" strokeWidth="12" className="stroke-emerald-100" />
              <circle
                cx="52"
                cy="52"
                r="42"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                className="stroke-emerald-700"
                strokeDasharray={`${(persenHadir / 100) * KELILING} ${KELILING}`}
                transform="rotate(-90 52 52)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold leading-none">{persenHadir}%</span>
              <span className="mt-1 text-xs font-semibold text-muted-foreground">Kehadiran</span>
            </div>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            {URUTAN_STATUS.map((key) => {
              const cfg = statusConfig[key];
              const Icon = cfg.icon;
              return (
                <div key={key} className={cn("flex items-center gap-2 rounded-xl px-2.5 py-2", cfg.tint)}>
                  <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xl font-extrabold leading-none tabular-nums">{counts[key]}</span>
                    <span className="block text-xs font-semibold leading-snug">{cfg.label}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Detail */}
      <section aria-labelledby="presensi-riwayat" className="space-y-3">
        <h2 id="presensi-riwayat" className="text-[17px] font-extrabold leading-tight">
          Riwayat presensi
        </h2>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        ) : presensi.length === 0 ? (
          <p className={cn(kartu, "py-10 text-center text-sm text-muted-foreground")}>
            Belum ada data presensi
          </p>
        ) : (
          <ul className={cn(kartu, "divide-y overflow-hidden")}>
            {presensi.map((p: any) => {
              const cfg = statusConfig[p.status as PresensiStatus] || statusConfig.H;
              const Icon = cfg.icon;
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", cfg.tint)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug">
                      {p.tanggal && format(new Date(p.tanggal), "EEEE, dd MMMM yyyy", { locale: idLocale })}
                    </span>
                    {p.keterangan && (
                      <span className="block text-xs leading-snug text-muted-foreground">{p.keterangan}</span>
                    )}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", cfg.tint)}>
                    {cfg.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
