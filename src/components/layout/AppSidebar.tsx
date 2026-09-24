import {
  LayoutDashboard, GraduationCap, Wallet, Users,
  MonitorPlay, BookOpen, Megaphone, Settings,
  ChevronRight, Receipt, BarChart3,
  BookMarked, FileSpreadsheet, SlidersHorizontal,
  UserPlus, CalendarDays, ClipboardCheck, FileText,
  BarChart2, Database, UserCog, Bell, HardDrive,
  Activity, ShieldCheck, Wrench,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useLocation } from "@/lib/router-compat";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface SubMenuItem {
  title: string;
  url: string;
  roles?: UserRole[];
}

interface SubGroup {
  title: string;
  icon: typeof LayoutDashboard;
  roles?: UserRole[];
  items: SubMenuItem[];
}

interface MenuItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
  children?: SubMenuItem[];
  subGroups?: SubGroup[];
}

const menuItems: MenuItem[] = [
  {
    title: "Dashboard", url: "/", icon: LayoutDashboard,
    roles: ["admin", "kepala_sekolah", "guru", "keuangan", "siswa", "pustakawan", "kasir"],
  },
  {
    title: "Akademik", url: "/akademik", icon: GraduationCap,
    roles: ["admin", "admin_tu", "kepala_sekolah", "guru"],
    subGroups: [
      {
        title: "Data Siswa",
        icon: Users,
        items: [
          { title: "Daftar Siswa", url: "/akademik/siswa" },
          { title: "Data Alumni", url: "/akademik/alumni" },
          { title: "SPMB", url: "/akademik/spmb" },
          { title: "Konfigurasi SPMB", url: "/akademik/spmb-konfigurasi" },
          { title: "Mutasi Siswa", url: "/akademik/mutasi" },
          { title: "Statistik Siswa", url: "/akademik/statistik" },
        ],
      },
      {
        title: "Kegiatan Belajar",
        icon: CalendarDays,
        items: [
          { title: "Jadwal Pelajaran", url: "/akademik/jadwal" },
          { title: "Kalender Akademik", url: "/akademik/kalender" },
          { title: "Presensi Siswa", url: "/akademik/presensi" },
          { title: "Presensi KBM", url: "/akademik/presensi-kbm" },
          { title: "RPP", url: "/akademik/rpp" },
        ],
      },
      {
        title: "Penilaian & Rapor",
        icon: ClipboardCheck,
        items: [
          { title: "Penilaian", url: "/akademik/penilaian" },
          { title: "Legger Nilai", url: "/akademik/legger" },
          { title: "Komentar Rapor", url: "/akademik/komentar-rapor" },
          { title: "Cetak Rapor", url: "/akademik/rapor" },
        ],
      },
      {
        title: "Referensi",
        icon: Database,
        items: [
          { title: "Referensi Akademik", url: "/akademik/referensi" },
        ],
      },
    ],
  },
  {
    title: "Keuangan", url: "/keuangan", icon: Wallet,
    roles: ["admin", "keuangan", "kasir", "sekretaris_yayasan"],
    subGroups: [
      {
        // Sekretaris yayasan hanya punya akses ke sub-grup ini (untuk
        // menyetujui pengajuan), bukan ke jurnal/laporan keuangan lainnya.
        title: "Keringanan & Beasiswa",
        icon: Users,
        roles: ["admin", "keuangan", "sekretaris_yayasan"],
        items: [
          { title: "Siswa Penerima Keringanan", url: "/keuangan/diskon-siswa", roles: ["admin", "keuangan", "sekretaris_yayasan"] },
        ],
      },
      {
        title: "Transaksi Harian",
        icon: Receipt,
        roles: ["admin", "keuangan", "kasir"],
        items: [
          { title: "Input Pembayaran", url: "/keuangan/pembayaran", roles: ["admin", "keuangan", "kasir"] },
          { title: "Pembayaran SPMB", url: "/keuangan/pembayaran-spmb", roles: ["admin", "keuangan"] },
          { title: "Penerimaan Lain", url: "/keuangan/penerimaan-lain", roles: ["admin", "keuangan"] },
          { title: "Pengeluaran", url: "/keuangan/pengeluaran", roles: ["admin", "keuangan"] },
          { title: "Kas Kecil", url: "/keuangan/kas-kecil", roles: ["admin", "keuangan"] },
          { title: "Online Payment", url: "/keuangan/online-payment", roles: ["admin", "keuangan"] },
          { title: "Tabungan Siswa", url: "/keuangan/tabungan", roles: ["admin", "keuangan"] },
          { title: "Tabungan Pegawai", url: "/keuangan/tabungan-pegawai", roles: ["admin", "keuangan"] },
        ],
      },
      {
        title: "Laporan & Rekap",
        icon: BarChart3,
        roles: ["admin", "keuangan", "kasir"],
        items: [
          { title: "Tunggakan", url: "/keuangan/tunggakan", roles: ["admin", "keuangan", "kasir"] },
          { title: "Laporan Per Siswa", url: "/keuangan/laporan-siswa", roles: ["admin", "keuangan"] },
          { title: "Laporan Per Kelas", url: "/keuangan/laporan-kelas", roles: ["admin", "keuangan"] },
          { title: "Rekap Harian", url: "/keuangan/rekap-harian", roles: ["admin", "keuangan"] },
          { title: "Lap. Pengeluaran", url: "/keuangan/laporan-pengeluaran", roles: ["admin", "keuangan"] },
          { title: "Lap. Unit Pendidikan", url: "/keuangan/laporan", roles: ["admin", "keuangan"] },
          { title: "Lap. Unit Usaha & Dana", url: "/keuangan/laporan-unit-usaha", roles: ["admin", "keuangan"] },
        ],
      },
      {
        title: "Akuntansi",
        icon: BookMarked,
        roles: ["admin", "keuangan"],
        items: [
          { title: "Jurnal Umum", url: "/keuangan/jurnal" },
          { title: "Buku Besar", url: "/keuangan/buku-besar" },
          { title: "Manajemen Piutang", url: "/keuangan/piutang" },
          { title: "Aset Tetap", url: "/keuangan/aset-tetap" },
          { title: "Tutup Buku", url: "/keuangan/tutup-buku" },
          { title: "Pengakuan Pendapatan", url: "/keuangan/pengakuan-pendapatan" },
        ],
      },
      {
        title: "Laporan ISAK 35",
        icon: FileSpreadsheet,
        roles: ["admin", "keuangan"],
        items: [
          { title: "Ringkasan", url: "/keuangan/isak35" },
          { title: "Penghasilan Komprehensif", url: "/keuangan/isak35/komprehensif" },
          { title: "Posisi Keuangan", url: "/keuangan/isak35/posisi-keuangan" },
          { title: "Arus Kas", url: "/keuangan/isak35/arus-kas" },
          { title: "Perubahan Aset Neto", url: "/keuangan/isak35/perubahan-aset-neto" },
        ],
      },
      {
        title: "Pengaturan",
        icon: SlidersHorizontal,
        roles: ["admin", "keuangan"],
        items: [
          { title: "Audit Trail", url: "/keuangan/audit-trail" },
          { title: "Audit Perubahan Data", url: "/keuangan/audit-perubahan" },
          { title: "Referensi", url: "/keuangan/referensi" },
        ],
      },
    ],
  },
  {
    title: "Kepegawaian", url: "/kepegawaian", icon: Users,
    roles: ["admin"],
    subGroups: [
      {
        title: "Data & Informasi",
        icon: UserCog,
        items: [
          { title: "Data Pegawai", url: "/kepegawaian/pegawai" },
          { title: "Struktur Organisasi", url: "/kepegawaian/struktur" },
          { title: "DUK", url: "/kepegawaian/duk" },
          { title: "Statistik Pegawai", url: "/kepegawaian/statistik" },
        ],
      },
      {
        title: "Kehadiran & Jadwal",
        icon: CalendarDays,
        items: [
          { title: "Presensi Pegawai", url: "/kepegawaian/presensi" },
          { title: "Jadwal Pegawai", url: "/kepegawaian/jadwal" },
        ],
      },
    ],
  },
  {
    title: "CBE", url: "/cbe", icon: MonitorPlay,
    roles: ["admin", "kepala_sekolah", "guru"],
  },
  {
    title: "SIMTAKA", url: "/simtaka", icon: BookOpen,
    roles: ["admin", "kepala_sekolah", "pustakawan"],
  },
  {
    title: "Buletin", url: "/buletin", icon: Megaphone,
    roles: ["admin", "kepala_sekolah"],
  },
  {
    title: "Pengaturan", url: "/pengaturan", icon: Settings,
    roles: ["admin"],
    subGroups: [
      {
        title: "Sistem & Identitas",
        icon: Wrench,
        items: [
          { title: "Identitas Sekolah", url: "/pengaturan/sekolah" },
          { title: "Notifikasi Gateway", url: "/pengaturan/notifikasi" },
          { title: "Integrasi API", url: "/pengaturan/integrasi-api" },
        ],
      },
      {
        title: "Pengguna & Akses",
        icon: ShieldCheck,
        items: [
          { title: "Manajemen Pengguna", url: "/pengaturan/pengguna" },
          { title: "Admin TU Akademik", url: "/pengaturan/admin-tu" },
          { title: "Manajemen Ortu", url: "/pengaturan/ortu" },
        ],
      },
      {
        title: "Data & Pemeliharaan",
        icon: HardDrive,
        items: [
          { title: "Backup & Export", url: "/pengaturan/backup" },
          { title: "Migrasi Data", url: "/pengaturan/migrasi-data" },
          { title: "Cek Kesehatan Data", url: "/pengaturan/cek-kesehatan" },
        ],
      },
    ],
  },
];

// ── SubGroupCollapsible: nested collapsible untuk grup menu ─────────────────
function SubGroupCollapsible({
  title,
  icon: Icon,
  items,
  isActive,
  pathname,
}: {
  title: string;
  icon: typeof LayoutDashboard;
  items: SubMenuItem[];
  isActive: boolean;
  pathname: string;
}) {
  return (
    <Collapsible defaultOpen={isActive} className="group/subgroup">
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
              isActive && "text-sidebar-foreground"
            )}
          >
            <span className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {title}
            </span>
            <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]/subgroup:rotate-90" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-3 border-l border-sidebar-border pl-2 mt-0.5 mb-1 space-y-0.5">
            {items.map((sub) => {
              const subActive = pathname === sub.url || pathname.startsWith(sub.url + "/");
              return (
                <SidebarMenuSubItem key={sub.url}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={subActive}
                    className="h-7 text-xs data-[active=true]:shadow-[inset_2px_0_0_0_hsl(var(--sidebar-primary))]"
                  >
                    <NavLink
                      to={sub.url}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      {sub.title}
                    </NavLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </div>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role } = useAuth();

  const visibleItems = menuItems.filter(
    (item) => !role || item.roles.includes(role)
  );

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-bold text-sidebar-primary-foreground text-sm">
            H
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-sidebar-foreground">Hijrah At-Tauhid</span>
              <span className="text-[10px] text-sidebar-foreground/60 leading-tight">
                Sistem Manajemen Sekolah
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  item.url === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.url);

                // ── Menu dengan subGroups (Keuangan, Akademik, Kepegawaian, Pengaturan) ──
                if (item.subGroups && !collapsed) {
                  return (
                    <Collapsible key={item.title} defaultOpen={isActive} className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.title}
                            className="justify-between data-[active=true]:shadow-[inset_3px_0_0_0_hsl(var(--sidebar-primary))]"
                          >
                            <div className="flex items-center gap-2">
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </div>
                            <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subGroups
                              .filter((sg) => !sg.roles || !role || sg.roles.includes(role))
                              .map((sg) => {
                                const filteredItems = sg.items.filter(
                                  (s) => !s.roles || !role || s.roles.includes(role)
                                );
                                if (filteredItems.length === 0) return null;

                                const sgActive = filteredItems.some(
                                  (s) => location.pathname === s.url || location.pathname.startsWith(s.url + "/")
                                );

                                return (
                                  <SubGroupCollapsible
                                    key={sg.title}
                                    title={sg.title}
                                    icon={sg.icon}
                                    items={filteredItems}
                                    isActive={sgActive}
                                    pathname={location.pathname}
                                  />
                                );
                              })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                // ── Menu tanpa children (CBE, SIMTAKA, Buletin) ───────────
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className="data-[active=true]:shadow-[inset_3px_0_0_0_hsl(var(--sidebar-primary))]"
                    >
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className="hover:bg-sidebar-accent/50"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
