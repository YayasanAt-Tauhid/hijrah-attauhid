import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "@/lib/router-compat";
import {
  GraduationCap, BookOpen, Calendar, ClipboardList,
  UserPlus, ArrowRightLeft, Clock, Database,
  BookOpenCheck, MessageSquare, FileText, BarChart3, Users, Settings,
} from "lucide-react";

const subModules = [
  { title: "Data Siswa", desc: "Kelola data siswa dan orang tua", icon: GraduationCap, url: "/akademik/siswa" },
  { title: "SPMB", desc: "Sistem Penerimaan Murid Baru", icon: UserPlus, url: "/akademik/spmb" },
  { title: "Konfigurasi SPMB", desc: "Atur jenis pembayaran pendaftaran dan pembayaran online", icon: Settings, url: "/akademik/spmb-konfigurasi" },
  { title: "Mutasi Siswa", desc: "Pindah masuk/keluar dan status siswa", icon: ArrowRightLeft, url: "/akademik/mutasi" },
  { title: "Jadwal Pelajaran", desc: "Atur jadwal kelas dan guru", icon: Calendar, url: "/akademik/jadwal" },
  { title: "Presensi Siswa", desc: "Input dan rekap kehadiran harian", icon: Clock, url: "/akademik/presensi" },
  { title: "Presensi KBM", desc: "Presensi per mata pelajaran", icon: BookOpenCheck, url: "/akademik/presensi-kbm" },
  { title: "Penilaian & Nilai", desc: "Input nilai, import/export Excel", icon: ClipboardList, url: "/akademik/penilaian" },
  { title: "Cetak Rapor", desc: "Cetak rapor siswa per semester", icon: BookOpen, url: "/akademik/rapor" },
  { title: "Komentar Rapor", desc: "Komentar wali kelas & kepala sekolah", icon: MessageSquare, url: "/akademik/komentar-rapor" },
  { title: "Legger Nilai", desc: "Rekap nilai seluruh mapel per kelas", icon: ClipboardList, url: "/akademik/legger" },
  { title: "RPP", desc: "Rencana Pelaksanaan Pembelajaran", icon: FileText, url: "/akademik/rpp" },
  { title: "Statistik Siswa", desc: "Grafik dan statistik data siswa", icon: BarChart3, url: "/akademik/statistik" },
  { title: "Data Alumni", desc: "Data siswa yang telah lulus", icon: Users, url: "/akademik/alumni" },
  { title: "Kalender Akademik", desc: "Jadwal kegiatan dan kalender sekolah", icon: Calendar, url: "/akademik/kalender" },
  { title: "Referensi Akademik", desc: "Mata pelajaran, kelas, tingkat", icon: Database, url: "/akademik/referensi" },
];

export default function Akademik() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Akademik</h1>
        <p className="text-sm text-muted-foreground">Manajemen data akademik sekolah</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subModules.map((m) => (
          <Card
            key={m.title}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(m.url)}
          >
            <CardContent className="flex items-start gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <m.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{m.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{m.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
