import { useLocation, Link } from "@/lib/router-compat";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbSegment {
  label: string;
  path: string;
}

const routeMap: Record<string, string> = {
  // Root
  "/": "Dashboard",
  // Keuangan
  "/keuangan": "Keuangan",
  "/keuangan/pembayaran": "Pembayaran SPP",
  "/keuangan/pembayaran-pmb": "Pembayaran SPMB",
  "/keuangan/pembayaran-spmb": "Pembayaran SPMB",
  "/keuangan/penerimaan-lain": "Penerimaan Lain",
  "/keuangan/pengeluaran": "Pengeluaran",
  "/keuangan/online-payment": "Online Payment",
  "/keuangan/tabungan": "Tabungan Siswa",
  "/keuangan/tabungan-pegawai": "Tabungan Pegawai",
  "/keuangan/tunggakan": "Tunggakan",
  "/keuangan/laporan-siswa": "Laporan Per Siswa",
  "/keuangan/laporan-kelas": "Laporan Per Kelas",
  "/keuangan/rekap-harian": "Rekap Harian",
  "/keuangan/laporan-pengeluaran": "Laporan Pengeluaran",
  "/keuangan/laporan": "Laporan Unit Pendidikan",
  "/keuangan/laporan-unit-usaha": "Laporan Unit Usaha & Dana",
  "/keuangan/jurnal": "Jurnal Umum",
  "/keuangan/buku-besar": "Buku Besar",
  "/keuangan/rekon-antar-lembaga": "Rekonsiliasi Antar Lembaga",
  "/keuangan/isak35": "Ringkasan ISAK 35",
  "/keuangan/isak35/komprehensif": "Penghasilan Komprehensif",
  "/keuangan/isak35/posisi-keuangan": "Posisi Keuangan",
  "/keuangan/isak35/arus-kas": "Arus Kas",
  "/keuangan/isak35/perubahan-aset-neto": "Perubahan Aset Neto",
  "/keuangan/isak35/calk": "Catatan Laporan Keuangan",
  "/keuangan/aset-tetap": "Aset Tetap",
  "/keuangan/tutup-buku": "Tutup Buku",
  "/keuangan/pengakuan-pendapatan": "Pengakuan Pendapatan",
  "/keuangan/audit-trail": "Audit Trail",
  "/keuangan/audit-perubahan": "Audit Perubahan Data",
  "/keuangan/referensi": "Referensi Keuangan",
  "/keuangan/piutang": "Manajemen Piutang",
  "/keuangan/diskon-siswa": "Siswa Penerima Keringanan",
  // Akademik
  "/akademik": "Akademik",
  "/akademik/siswa": "Data Siswa",
  "/akademik/siswa/tambah": "Tambah Siswa",
  "/akademik/alumni": "Data Alumni",
  "/akademik/referensi": "Referensi",
  "/akademik/jadwal": "Jadwal",
  "/akademik/kalender": "Kalender",
  "/akademik/rpp": "RPP",
  "/akademik/pmb": "SPMB",
  "/akademik/spmb": "SPMB",
  "/akademik/spmb-konfigurasi": "Konfigurasi SPMB",
  "/akademik/mutasi": "Mutasi",
  "/akademik/presensi": "Presensi",
  "/akademik/presensi-kbm": "Presensi KBM",
  "/akademik/penilaian": "Penilaian",
  "/akademik/rapor": "Cetak Rapor",
  "/akademik/komentar-rapor": "Komentar Rapor",
  "/akademik/legger": "Legger Nilai",
  "/akademik/statistik": "Statistik Siswa",
  // Kepegawaian
  "/kepegawaian": "Kepegawaian",
  "/kepegawaian/pegawai": "Data Pegawai",
  "/kepegawaian/presensi": "Presensi Pegawai",
  "/kepegawaian/jadwal": "Jadwal Pegawai",
  "/kepegawaian/duk": "DUK",
  "/kepegawaian/statistik": "Statistik",
  "/kepegawaian/struktur": "Struktur Organisasi",
  // Pengaturan
  "/pengaturan": "Pengaturan",
  "/pengaturan/sekolah": "Identitas Sekolah",
  "/pengaturan/pengguna": "Manajemen Pengguna",
  "/pengaturan/ortu": "Manajemen Ortu",
  "/pengaturan/notifikasi": "Notifikasi Gateway",
  "/pengaturan/backup": "Backup & Export",
  "/pengaturan/migrasi-data": "Migrasi Data",
  "/pengaturan/cek-kesehatan": "Cek Kesehatan Data",
  // Modul lain
  "/cbe": "CBE",
  "/simtaka": "SIMTAKA",
  "/buletin": "Buletin",
};

function buildBreadcrumbs(pathname: string): BreadcrumbSegment[] {
  // exact match first
  if (routeMap[pathname]) {
    const segments: BreadcrumbSegment[] = [];

    // build parent chain from path segments
    const parts = pathname.split("/").filter(Boolean);
    let accumulated = "";
    for (const part of parts) {
      accumulated += "/" + part;
      if (routeMap[accumulated]) {
        segments.push({ label: routeMap[accumulated], path: accumulated });
      }
    }
    return segments;
  }

  // dynamic routes: e.g. /akademik/siswa/:id or /akademik/siswa/:id/edit
  const parts = pathname.split("/").filter(Boolean);
  const segments: BreadcrumbSegment[] = [];
  let accumulated = "";

  for (let i = 0; i < parts.length; i++) {
    accumulated += "/" + parts[i];
    if (routeMap[accumulated]) {
      segments.push({ label: routeMap[accumulated], path: accumulated });
    } else {
      // likely a dynamic segment (id, etc.) — skip or show generic label
      const prevPath = segments[segments.length - 1]?.path || "";
      const editLabel = parts[i] === "edit" ? "Edit" : parts[i] === "tambah" ? "Tambah" : "Detail";
      if (parts[i] === "edit" || parts[i] === "tambah") {
        segments.push({ label: editLabel, path: accumulated });
      }
      // uuid-like segments: skip silently
    }
  }
  if (
    parts.length === 3
    && parts[0] === "akademik"
    && parts[1] === "spmb"
    && !segments.some((segment) => segment.path === pathname)
  ) {
    segments.push({ label: "Detail SPMB", path: pathname });
  }

  return segments;
}

export function AppBreadcrumb() {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);

  // Don't show breadcrumb on dashboard
  if (location.pathname === "/" || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] text-muted-foreground">
      <Link
        to="/"
        className="flex items-center hover:text-foreground transition-colors"
        aria-label="Dashboard"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
