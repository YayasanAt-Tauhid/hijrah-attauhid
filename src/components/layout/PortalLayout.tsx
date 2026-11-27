import { Outlet, useNavigate, useLocation } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, User, KeyRound, Home, Wallet, History, CalendarDays, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { BrandLogo } from "@/components/shared/BrandLogo";

const navItems = [
  { label: "Beranda", href: "/portal", icon: Home },
  { label: "Biaya", href: "/portal/tagihan", icon: Wallet },
  { label: "Riwayat", href: "/portal/pembayaran", icon: History },
  { label: "Presensi", href: "/portal/presensi", icon: CalendarDays },
  { label: "Nilai", href: "/portal/nilai", icon: GraduationCap },
  { label: "Profil", href: "/portal/profil", icon: User },
];

export default function PortalLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isActive = (href: string) =>
    href === "/portal" ? pathname === href : pathname.startsWith(href);
  const queryClient = useQueryClient();

  // Bug 6 fix: unread count refetch tiap 30 detik
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notif-unread-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("notifikasi_ortu")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("dibaca", false);
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  // Bug 6 fix: notifications juga refetch tiap 30 detik agar dropdown tidak stale
  const { data: notifications = [] } = useQuery({
    queryKey: ["notif-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifikasi_ortu")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const markAsRead = useMutation({
    mutationFn: async (notifId: string) => {
      await supabase
        .from("notifikasi_ortu")
        .update({ dibaca: true })
        .eq("id", notifId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notif-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["notif-recent"] });
    },
  });

  const handleNotifClick = (notif: any) => {
    if (!notif.dibaca) markAsRead.mutate(notif.id);
    if (notif.url) navigate(notif.url);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/portal/login");
  };

  const inisial = user?.email?.charAt(0).toUpperCase() || "U";

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f7f5] dark:bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0f3d2e] text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pb-2 pt-3 xl:h-16 xl:py-0">
          {/* Left */}
          <button
            type="button"
            aria-label="Ke beranda portal"
            className="flex min-w-0 items-center gap-2.5 rounded-lg text-left"
            onClick={() => navigate("/portal")}
          >
            <BrandLogo className="h-9 w-9 rounded-[10px] bg-white" />
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight">Hijrah At-Tauhid</span>
              <span className="block text-[11px] leading-tight text-emerald-200/80">Portal Orang Tua</span>
            </span>
          </button>

          {/* Center Nav (layar lebar) */}
          <nav aria-label="Menu utama" className="hidden items-center gap-1 xl:flex">
            {navItems.map((item) => {
              const aktif = isActive(item.href);
              return (
                <button
                  key={item.href}
                  type="button"
                  aria-current={aktif ? "page" : undefined}
                  onClick={() => navigate(item.href)}
                  className={cn(
                    "flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm transition-colors",
                    aktif
                      ? "bg-white font-bold text-emerald-800"
                      : "font-semibold text-[#bfe3d1] hover:bg-white/10 hover:text-white",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-2">
            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}
                  className="relative h-11 w-11 rounded-xl bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="p-2 font-semibold text-sm border-b">Notifikasi</div>
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Belum ada notifikasi
                  </div>
                ) : (
                  notifications.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${
                        !n.dibaca ? "bg-emerald-50" : ""
                      }`}
                      onClick={() => handleNotifClick(n)}
                    >
                      <span className="font-medium text-sm">{n.judul}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {n.pesan}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {n.created_at &&
                          format(new Date(n.created_at), "dd MMM yyyy HH:mm", {
                            locale: idLocale,
                          })}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-center justify-center text-emerald-700 font-medium"
                  onClick={() => navigate("/portal")}
                >
                  Lihat Semua
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Menu akun"
                  className="grid h-11 w-11 place-items-center rounded-full bg-emerald-400 text-[15px] font-extrabold text-emerald-950 hover:bg-emerald-300"
                >
                  {inisial}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="max-w-[16rem] truncate px-2 py-1.5 text-xs text-muted-foreground">
                  {user?.email}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/portal/profil")}>
                  <User className="h-4 w-4 mr-2" />
                  Profil Saya
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/portal/profil")}>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Ganti Password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Mobile Nav */}
        <nav
          aria-label="Menu utama (ponsel)"
          className="mx-auto grid max-w-7xl grid-cols-6 gap-0.5 px-2 pb-2.5 xl:hidden"
        >
          {navItems.map((item) => {
            const aktif = isActive(item.href);
            return (
              <button
                key={item.href}
                type="button"
                aria-current={aktif ? "page" : undefined}
                onClick={() => navigate(item.href)}
                className={cn(
                  "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] px-0.5 py-1 text-[11px] transition-colors",
                  aktif
                    ? "bg-white font-bold text-emerald-800"
                    : "font-semibold text-[#bfe3d1] hover:bg-white/10 hover:text-white",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-4 text-center text-xs text-muted-foreground">
        © 2025 Hijrah At-Tauhid — Portal Orang Tua
      </footer>
    </div>
  );
}
