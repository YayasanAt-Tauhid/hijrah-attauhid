import { Link } from "@/lib/router-compat";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  GraduationCap,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";

export default function AccessGateway() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-background to-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col justify-center">
        <div className="mb-8 text-center sm:mb-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white shadow-lg">
            H
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Hijrah At-Tauhid
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Silakan pilih akses sesuai kebutuhan Anda.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="overflow-hidden border-emerald-200 shadow-md ring-1 ring-emerald-100">
            <CardContent className="flex h-full flex-col p-6 sm:p-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <UsersRound className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Orang Tua / Wali Siswa
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Akses tagihan pendidikan, pembayaran online, riwayat pembayaran,
                bukti pembayaran, dan data anak.
              </p>

              <div className="mt-5 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <WalletCards className="h-4 w-4 text-emerald-600" />
                  <span>Pembayaran biaya pendidikan</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>Portal khusus orang tua</span>
                </div>
              </div>

              <Button
                asChild
                className="mt-7 h-11 w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <Link to="/portal/login">
                  Masuk Portal Orang Tua
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Belum punya akun? Pendaftaran tersedia pada halaman Portal Orang Tua.
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-sm">
            <CardContent className="flex h-full flex-col p-6 sm:p-7">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <GraduationCap className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Pegawai / Guru / Admin
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Akses sistem administrasi sekolah untuk akademik, keuangan,
                kepegawaian, dan layanan internal lainnya.
              </p>

              <div className="mt-5 rounded-lg border bg-muted/30 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                Gunakan akun internal sekolah yang telah diberikan oleh administrator.
              </div>

              <Button asChild variant="outline" className="mt-auto h-11 w-full">
                <Link to="/login">
                  Masuk Aplikasi Sekolah
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          © 2026 Hijrah At-Tauhid — Sistem Manajemen Sekolah
        </p>
      </div>
    </main>
  );
}
