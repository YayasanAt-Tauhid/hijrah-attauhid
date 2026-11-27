import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, GraduationCap } from "lucide-react";
import { PortalHero } from "@/components/portal/PortalHero";
import { AnakChips, AnakInfo } from "@/components/portal/AnakChips";
import { formatRataRata, rataRataNilai } from "@/lib/portalAkademik";
import { cn } from "@/lib/utils";

const kartu = "rounded-[1.125rem] border bg-card shadow-sm";
const NILAI_TUNTAS = 70;

export default function PortalNilai() {
  const { user } = useAuth();
  const [selectedSiswa, setSelectedSiswa] = useState("");

  const { data: anakList = [] } = useQuery({
    queryKey: ["portal-anak-nilai", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select("siswa_id, siswa:siswa_id (id, nama, nis)")
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const effectiveSiswa = selectedSiswa || anakList[0]?.siswa_id || "";

  const { data: nilai = [], isLoading } = useQuery({
    queryKey: ["portal-nilai", effectiveSiswa],
    queryFn: async () => {
      const { data } = await supabase
        .from("penilaian")
        .select(`
          *,
          mapel:mapel_id (nama, kode),
          kelas:kelas_id (nama),
          semester:semester_id (nama),
          tahun_ajaran:tahun_ajaran_id (nama)
        `)
        .eq("siswa_id", effectiveSiswa)
        .order("tahun_ajaran_id", { ascending: false });
      return data || [];
    },
    enabled: !!effectiveSiswa,
  });

  // Group by tahun_ajaran + semester
  const grouped = nilai.reduce((acc: any, n: any) => {
    const key = `${n.tahun_ajaran?.nama || "-"} — ${n.semester?.nama || "-"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(n);
    return acc;
  }, {} as Record<string, any[]>);

  const selectedAnak = anakList.find((a: any) => a.siswa_id === effectiveSiswa);
  const siswaInfo = selectedAnak?.siswa as any;
  const pilihanAnak = anakList.map((a: any) => ({ id: a.siswa_id, nama: a.siswa?.nama ?? "-" }));
  const periodeList = Object.entries(grouped) as [string, any[]][];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 animate-fade-in">
      <PortalHero
        title="Nilai Anak"
        subtitle="Nilai akademik anak per semester."
        icon={GraduationCap}
      />

      {anakList.length > 1 ? (
        <AnakChips anak={pilihanAnak} selectedId={effectiveSiswa} onSelect={setSelectedSiswa} />
      ) : (
        siswaInfo && <AnakInfo nama={siswaInfo.nama} nis={siswaInfo.nis} />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : periodeList.length === 0 ? (
        <p className={cn(kartu, "py-12 text-center text-sm text-muted-foreground")}>
          Belum ada data nilai
        </p>
      ) : (
        periodeList.map(([period, items], index) => {
          const rata = formatRataRata(rataRataNilai(items.map((n) => n.nilai)));
          return (
            <details
              key={`${effectiveSiswa}-${period}`}
              open={index === 0}
              className={cn(kartu, "group overflow-hidden")}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-[17px] font-extrabold tabular-nums text-white"
                >
                  {rata}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold leading-snug">{period}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{`Rata-rata ${rata}`}</span>
                </span>
                <ChevronDown aria-hidden="true" className="h-6 w-6 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ul className="divide-y border-t">
                {items.map((n: any) => {
                  const ada = n.nilai !== null && n.nilai !== undefined;
                  const tuntas = ada && n.nilai >= NILAI_TUNTAS;
                  return (
                    <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold leading-snug">
                          {n.mapel?.nama || "-"}
                          <span className="ml-2 inline-block rounded-full border px-2 align-[1px] text-[11px] font-semibold leading-relaxed text-muted-foreground">
                            {n.jenis_ujian || "-"}
                          </span>
                        </span>
                        {n.keterangan && (
                          <span className="block text-xs leading-snug text-muted-foreground">{n.keterangan}</span>
                        )}
                      </span>
                      <span
                        role="img"
                        aria-label={
                          !ada
                            ? "Nilai belum tersedia"
                            : tuntas
                              ? `Nilai ${n.nilai}`
                              : `Nilai ${n.nilai}, di bawah ${NILAI_TUNTAS}`
                        }
                        className={cn(
                          "min-w-12 shrink-0 rounded-xl px-2 py-1.5 text-center text-xl font-extrabold leading-none tabular-nums",
                          !ada
                            ? "bg-muted text-muted-foreground"
                            : tuntas
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800",
                        )}
                      >
                        {ada ? n.nilai : "-"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })
      )}
    </div>
  );
}
