import { Outlet, useNavigate, useLocation } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, User, KeyRound, Home, FileText, CreditCard, History, CalendarDays, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const navItems = [
  { label: "Beranda", href: "/portal", icon: Home },
  { label: "Tagihan", href: "/portal/tagihan", icon: FileText },
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

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-emerald-700 text-white shadow-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          {/* Left */}
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate("/portal")}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 font-bold text-sm">
              H
            </div>
            <span className="font-semibold text-sm hidden sm:inline">
              Hijrah At-Tauhid <span className="font-normal opacity-80">| Portal Orang Tua</span>
            </span>
          </div>

          {/* Center Nav */}
          <nav className="hidden xl:flex items-center gap-1">
            {navItems.map((item) => (
              <Button
                key={item.href}
                variant="ghost"
                size="sm"
                className="text-white/90 hover:text-white hover:bg-white/10"
                onClick={() => navigate(item.href)}
              >
                <item.icon className="h-4 w-4 mr-1.5" />
                {item.label}
              </Button>
            ))}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-2">
            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-white hover:bg-white/10"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 min-w-5 bg-red-500 text-[10px] px-1 border-0">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </Badge>
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
                  notifications.map((n: any) => (
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/10 gap-2"
                >
                  <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                    {user?.email?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="hidden sm:inline text-sm max-w-[120px] truncate">
                    {user?.email?.split("@")[0]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
        <nav className="xl:hidden grid grid-cols-6 items-center gap-1 border-t border-white/20 px-1 py-1">
          {navItems.map((item) => (
            <Button
              key={item.href}
              variant="ghost"
              size="sm"
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`min-w-0 text-white/80 hover:text-white hover:bg-white/10 flex-col h-auto px-1 py-1 gap-0.5 text-[10px] ${isActive(item.href) ? "bg-white/10 text-white" : ""}`}
              onClick={() => navigate(item.href)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Button>
          ))}
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
