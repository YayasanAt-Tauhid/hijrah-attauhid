import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  GraduationCap,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { getNamaOrtuDariAnak } from "@/lib/ortu";
import { inisialNama, labelKelas } from "@/lib/portalAnak";
import { PortalHero } from "@/components/portal/PortalHero";
import { cn } from "@/lib/utils";

const kartu = "rounded-[1.125rem] border bg-card shadow-sm";

const PINTASAN = [
  { label: "Riwayat", sub: "Pembayaran", href: "/portal/pembayaran", icon: CreditCard, tint: "bg-blue-100 text-blue-700" },
  { label: "Presensi", sub: "Kehadiran", href: "/portal/presensi", icon: CalendarCheck, tint: "bg-amber-100 text-amber-700" },
  { label: "Nilai", sub: "Per semester", href: "/portal/nilai", icon: GraduationCap, tint: "bg-teal-100 text-teal-700" },
];

// Warna avatar bergantian agar anak mudah dibedakan.
const WARNA_AVATAR = ["bg-emerald-700", "bg-teal-700", "bg-cyan-800", "bg-green-800"];

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

  const namaTampil = namaOrtu || user?.email?.split("@")[0] || "";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 animate-fade-in">
      <div>
        <PortalHero
          eyebrow="Assalamu'alaikum,"
          title={namaTampil}
          subtitle="Portal Orang Tua Hijrah At-Tauhid"
          icon={GraduationCap}
          className="pb-16"
        />

        <section
          className={cn(kartu, "relative mx-2 -mt-11 flex flex-col gap-3.5 p-4 shadow-md")}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "grid h-12 w-12 shrink-0 place-items-center rounded-2xl",
                tagihanCount > 0 ? "bg-red-50 text-red-700" : "bg-emerald-100 text-emerald-700",
              )}
            >
              {tagihanCount > 0 ? <Wallet className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold leading-snug">Biaya Pendidikan</p>
              <p
                className={cn(
                  "text-[13px] font-semibold leading-snug",
                  tagihanCount > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-800 dark:text-emerald-300",
                )}
              >
                {tagihanCount > 0
                  ? `${tagihanCount} biaya sudah jatuh tempo`
                  : "Tidak ada biaya yang jatuh tempo"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/portal/tagihan")}
            className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 text-[15px] font-bold text-white shadow-[0_2px_10px_rgba(4,120,87,0.28)] hover:bg-emerald-800"
          >
            {tagihanCount > 0 ? "Lihat dan bayar" : "Lihat biaya"}
            <ChevronRight aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
        </section>
      </div>

      {/* Anak */}
      <section aria-labelledby="beranda-anak" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="beranda-anak" className="text-[17px] font-extrabold leading-tight">
            Anak saya
          </h2>
          {anakList.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
              {anakList.length} anak
            </span>
          )}
        </div>
        {anakList.length === 0 ? (
          <p className={cn(kartu, "p-4 text-sm text-muted-foreground")}>
            Belum ada data anak yang terhubung. Hubungi admin sekolah.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {anakList.map((item: any, index: number) => {
              const siswa = item.siswa;
              const activeKelas = siswa?.kelas_siswa?.find((ks: any) => ks.aktif);
              const kelas = labelKelas(activeKelas?.kelas?.nama);
              return (
                <li key={item.siswa_id} className={cn(kartu, "flex items-center gap-3 p-3.5")}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white",
                      WARNA_AVATAR[index % WARNA_AVATAR.length],
                    )}
                  >
                    {inisialNama(siswa?.nama || "")}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-base font-bold leading-normal">
                      {siswa?.nama}
                      {kelas && (
                        <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-emerald-100 px-2.5 align-[1px] text-xs font-semibold leading-normal text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                          {kelas}
                        </span>
                      )}
                    </p>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {`${activeKelas?.kelas?.departemen?.nama || "-"} · NIS ${siswa?.nis || "-"}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pintasan */}
      <section aria-labelledby="beranda-pintasan" className="space-y-3">
        <h2 id="beranda-pintasan" className="text-[17px] font-extrabold leading-tight">
          Pintasan
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {PINTASAN.map((item) => (
            <button
              key={item.href}
              type="button"
              onClick={() => navigate(item.href)}
              className={cn(kartu, "flex flex-col items-start gap-2.5 p-3.5 text-left transition-shadow hover:shadow-md")}
            >
              <span aria-hidden="true" className={cn("grid h-10 w-10 place-items-center rounded-xl", item.tint)}>
                <item.icon className="h-[22px] w-[22px]" />
              </span>
              <span>
                <span className="block text-sm font-bold leading-tight">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{item.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Kabar terbaru */}
      {recentNotifs.length > 0 && (
        <section aria-labelledby="beranda-kabar" className="space-y-3">
          <h2 id="beranda-kabar" className="text-[17px] font-extrabold leading-tight">
            Kabar terbaru
          </h2>
          <ul className={cn(kartu, "divide-y overflow-hidden")}>
            {recentNotifs.map((n: any) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => n.url && navigate(n.url)}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3.5 text-left hover:bg-muted/50",
                    !n.dibaca && "bg-emerald-50 dark:bg-emerald-950/30",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      n.dibaca ? "bg-border" : "bg-emerald-500",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold leading-snug">
                      {n.judul}
                      {!n.dibaca && <span className="sr-only"> Belum dibaca</span>}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{n.pesan}</span>
                    {n.created_at && (
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        {format(new Date(n.created_at), "dd MMM yyyy · HH.mm", { locale: idLocale })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
