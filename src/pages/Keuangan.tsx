import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/shared/StatsCard";
import { Wallet, TrendingUp, TrendingDown, PiggyBank, Building2, ReceiptText, ClipboardList, GraduationCap, BadgePercent } from "lucide-react";
import { useRekapPembayaranBulanan, useRekapPengeluaranBulanan, useTotalTabungan, useRekapKeuanganPerLembaga, formatRupiah, BULAN_NAMES, BULAN_ORDER_AKADEMIK } from "@/hooks/useKeuangan";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();

const links = [
  { label: "Pembayaran SPP", url: "/keuangan/pembayaran" },
  { label: "Tunggakan", url: "/keuangan/tunggakan" },
  { label: "Pengeluaran", url: "/keuangan/pengeluaran" },
  { label: "Tabungan Siswa", url: "/keuangan/tabungan" },
  { label: "Jurnal Umum", url: "/keuangan/jurnal" },
  { label: "Buku Besar", url: "/keuangan/buku-besar" },
  { label: "Lap. Unit Pendidikan", url: "/keuangan/laporan" },
  { label: "Lap. Unit Usaha & Dana", url: "/keuangan/laporan-unit-usaha" },
  { label: "ISAK 35", url: "/keuangan/isak35" },
  { label: "Laporan Per Siswa", url: "/keuangan/laporan-siswa" },
  { label: "Laporan Per Kelas", url: "/keuangan/laporan-kelas" },
  { label: "Lap. Pengeluaran", url: "/keuangan/laporan-pengeluaran" },
  { label: "Penerimaan Lain", url: "/keuangan/penerimaan-lain" },
  { label: "Rekap Harian", url: "/keuangan/rekap-harian" },
  { label: "Online Payment", url: "/keuangan/online-payment" },
  { label: "Audit Trail", url: "/keuangan/audit-trail" },
  { label: "Audit Perubahan Data", url: "/keuangan/audit-perubahan" },
  { label: "Pembayaran SPMB", url: "/keuangan/pembayaran-spmb" },
  { label: "Referensi", url: "/keuangan/referensi" },
  { label: "Tutup Buku", url: "/keuangan/tutup-buku" },
  { label: "Rekon Antar Lembaga", url: "/keuangan/rekon-antar-lembaga" },
  { label: "Cek Kejanggalan", url: "/keuangan/cek-kejanggalan" },
];

export default function Keuangan() {
  const { role } = useAuth();

  if (role === "kasir") return <KasirKeuanganLanding />;
  if (role === "sekretaris_yayasan") return <SekretarisKeuanganLanding />;

  return <DashboardKeuangan />;
}

function KasirKeuanganLanding() {
  const navigate = useNavigate();
  const actions = [
    { label: "Input Pembayaran", description: "Terima pembayaran siswa dan cetak kuitansi.", url: "/keuangan/pembayaran", icon: ReceiptText },
    { label: "Pembayaran SPMB", description: "Terima biaya pendaftaran calon murid di loket.", url: "/keuangan/pembayaran-spmb", icon: GraduationCap },
    { label: "Tunggakan", description: "Lihat tagihan siswa yang masih belum dibayar.", url: "/keuangan/tunggakan", icon: ClipboardList },
    { label: "Rekap Kasir Saya", description: "Lihat transaksi yang Anda catat sendiri per hari.", url: "/keuangan/rekap-kasir", icon: Wallet },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Loket Kasir</h1>
        <p className="text-sm text-muted-foreground">
          Akses operasional penerimaan pembayaran. Laporan yayasan dan menu akuntansi tidak ditampilkan untuk kasir.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Card key={action.url} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="rounded-lg bg-primary/10 p-3 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{action.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                  <Button className="mt-4" size="sm" onClick={() => navigate(action.url)}>
                    Buka
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SekretarisKeuanganLanding() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Keringanan & Beasiswa</h1>
        <p className="text-sm text-muted-foreground">
          Akses sekretaris yayasan dibatasi pada alur persetujuan keringanan siswa.
        </p>
      </div>
      <Card className="max-w-xl">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <BadgePercent className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Siswa Penerima Keringanan</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tinjau dan putuskan pengajuan beasiswa atau keringanan sesuai kewenangan.
            </p>
            <Button className="mt-4" size="sm" onClick={() => navigate("/keuangan/diskon-siswa")}>
              Buka Persetujuan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardKeuangan() {
  const navigate = useNavigate();
  const { data: rekapPemasukan, isLoading: loadP } = useRekapPembayaranBulanan(currentYear);
  const { data: rekapPengeluaran, isLoading: loadE } = useRekapPengeluaranBulanan(currentYear);
  const { data: totalTabungan, isLoading: loadT } = useTotalTabungan();
  const { data: rekapLembaga, isLoading: loadRL } = useRekapKeuanganPerLembaga(currentYear);

  const pemasukanBulanIni = rekapPemasukan?.[currentMonth - 1]?.total || 0;
  const pengeluaranBulanIni = rekapPengeluaran?.[currentMonth - 1]?.total || 0;
  const totalPemasukan = rekapPemasukan?.reduce((s, r) => s + r.total, 0) || 0;
  const totalPengeluaranYTD = rekapPengeluaran?.reduce((s, r) => s + r.total, 0) || 0;
  const saldoKas = totalPemasukan - totalPengeluaranYTD;

  const totalPemasukanYayasan = rekapLembaga?.reduce((s, r) => s + r.totalPemasukan, 0) || 0;
  const totalPengeluaranYayasan = rekapLembaga?.reduce((s, r) => s + r.totalPengeluaran, 0) || 0;
  const saldoYayasan = totalPemasukanYayasan - totalPengeluaranYayasan;

  const chartData = BULAN_ORDER_AKADEMIK.map((m) => ({
    bulan: BULAN_NAMES[m - 1].substring(0, 3),
    Penerimaan: rekapPemasukan?.[m - 1]?.total || 0,
    Pengeluaran: rekapPengeluaran?.[m - 1]?.total || 0,
  }));

  const loading = loadP || loadE || loadT;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard Keuangan Yayasan</h1>
          <p className="text-sm text-muted-foreground">Ringkasan keuangan seluruh lembaga — {currentYear}</p>
        </div>
        {/* Quick links */}
        <div className="flex flex-wrap justify-end gap-2">
          {links.map((l) => (
            <Button
              key={l.url}
              variant="outline"
              size="sm"
              className="rounded-lg font-semibold"
              onClick={() => navigate(l.url)}
            >
              {l.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Pemasukan Bulan Ini" value={formatRupiah(pemasukanBulanIni)} icon={TrendingUp} color="success" />
          <StatsCard title="Pengeluaran Bulan Ini" value={formatRupiah(pengeluaranBulanIni)} icon={TrendingDown} color="destructive" />
          <StatsCard title="Saldo Kas (YTD)" value={formatRupiah(saldoKas)} icon={Wallet} color="primary" />
          <StatsCard title="Total Tabungan Siswa" value={formatRupiah(totalTabungan || 0)} icon={PiggyBank} color="info" />
        </div>
      )}

      {/* Rekap Per Lembaga */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Rekap Keuangan Per Lembaga — {currentYear}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadRL ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rekapLembaga?.map((r) => (
                <Card
                  key={r.departemen_id}
                  className="cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() => navigate(`/keuangan/laporan?lembaga=${r.departemen_id}`)}
                >
                  <CardContent className="p-4">
                    <p className="font-semibold text-sm mb-2">{r.kode} — {r.lembaga}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pemasukan</span>
                        <span className="font-medium text-success">{formatRupiah(r.totalPemasukan)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pengeluaran</span>
                        <span className="font-medium text-destructive">{formatRupiah(r.totalPengeluaran)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1">
                        <span className="text-muted-foreground">Saldo</span>
                        <span className={`font-bold ${r.saldo >= 0 ? "text-success" : "text-destructive"}`}>
                          {formatRupiah(r.saldo)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Total Konsolidasi Yayasan */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center mb-4">
            <p className="text-sm font-medium text-muted-foreground">Total Konsolidasi Yayasan {currentYear}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Pemasukan</p>
              <p className="text-lg font-bold text-success">{formatRupiah(totalPemasukanYayasan)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Pengeluaran</p>
              <p className="text-lg font-bold text-destructive">{formatRupiah(totalPengeluaranYayasan)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Saldo Yayasan</p>
              <p className={`text-lg font-bold ${saldoYayasan >= 0 ? "text-primary" : "text-destructive"}`}>
                {formatRupiah(saldoYayasan)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Grafik Penerimaan vs Pengeluaran {currentYear}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-72" /> : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bulan" />
                  <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}jt`} />
                  <Tooltip formatter={(v: number) => formatRupiah(v)} />
                  <Legend />
                  <Bar dataKey="Penerimaan" fill="hsl(var(--success))" radius={[4,4,0,0]} />
                  <Bar dataKey="Pengeluaran" fill="hsl(var(--destructive))" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground text-center mt-2">* Data gabungan seluruh lembaga</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
