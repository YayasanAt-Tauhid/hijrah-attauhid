import { useState, useEffect, useMemo } from "react";
import { useMidtrans } from "@/hooks/useMidtrans";
import { useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createPayment } from "@/server/payment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, CreditCard, Loader2, ShieldCheck } from "lucide-react";

const NAMA_BULAN = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

interface KeranjangItem {
  siswa_id: string;
  nama_siswa: string;
  jenis_id: string;
  jenis_nama: string;
  bulan: number;
  jumlah: number;
  departemen_id?: string;
  departemen_nama?: string;
  tahun_ajaran_id?: string;
  tahun_ajaran_nama?: string;
  kelas_nama?: string;
}

export default function PortalCheckout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [keranjang, setKeranjang] = useState<KeranjangItem[]>([]);
  const {
    isReady: isMidtransReady,
    isLoading: isMidtransLoading,
    error: midtransError,
    loadMidtrans,
  } = useMidtrans();

  // Load Midtrans script when component mounts
  useEffect(() => {
    loadMidtrans();
  }, [loadMidtrans]);

  useEffect(() => {
    const raw = sessionStorage.getItem("keranjang_tagihan");
    if (!raw) {
      navigate("/portal/tagihan", { replace: true });
      return;
    }
    try {
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0) {
        navigate("/portal/tagihan", { replace: true });
        return;
      }
      setKeranjang(items);
    } catch {
      navigate("/portal/tagihan", { replace: true });
    }
  }, [navigate]);

  // Group by siswa
  const grouped = useMemo(() => {
    const map = new Map<string, KeranjangItem[]>();
    keranjang.forEach((item) => {
      const list = map.get(item.siswa_id) || [];
      list.push(item);
      map.set(item.siswa_id, list);
    });
    return map;
  }, [keranjang]);

  const totalAmount = keranjang.reduce((sum, i) => sum + i.jumlah, 0);

  const handleBayar = async () => {
    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Sesi login habis. Silakan login ulang.");
        navigate("/portal/login");
        return;
      }

      let result: Awaited<ReturnType<typeof createPayment>>;
      try {
        result = await createPayment({
          data: {
            items: keranjang,
            customer: {
              user_id: user!.id,
              email: user!.email || "",
              nama: user!.email?.split("@")[0] || "User",
            },
          },
        });
      } catch (err: any) {
        toast.error(err?.message || "Gagal membuat transaksi");
        setIsLoading(false);
        return;
      }

      if (!result.snap_token) {
        toast.error("Gagal membuat transaksi");
        setIsLoading(false);
        return;
      }

      // Cek window.snap tersedia sebelum memanggil
      if (!window.snap || typeof window.snap.pay !== "function") {
        toast.error("Layanan pembayaran belum siap. Coba muat ulang halaman.");
        setIsLoading(false);
        return;
      }

      if (result.reused) toast.info(`Melanjutkan pembayaran sebelumnya (Order ID: ${result.order_id}).`);
      // Open Midtrans Snap. Pilihan channel + fee customer ditangani Midtrans.
      window.snap.pay(result.snap_token, {
        onSuccess: () => {
          toast.success("Pembayaran berhasil!");
          sessionStorage.removeItem("keranjang_tagihan");
          navigate(`/portal/pembayaran?order=${result.order_id}`);
        },
        onPending: () => {
          toast.info("Pembayaran pending. Selesaikan pembayaran Anda.");
          sessionStorage.removeItem("keranjang_tagihan");
          navigate(`/portal/pembayaran?order=${result.order_id}`);
        },
        onError: (snapResult: any) => {
          toast.error(
            "Pembayaran gagal: " +
              (snapResult?.status_message || "Unknown error")
          );
          setIsLoading(false);
        },
        onClose: () => {
          toast.info("Jendela pembayaran ditutup. Transaksi tetap menunggu pembayaran; lanjutkan dari Riwayat Pembayaran atau batalkan secara khusus.");
          setIsLoading(false);
        },
      });
    } catch (err: any) {
      toast.error("Terjadi kesalahan: " + err.message);
      setIsLoading(false);
    }
  };

  if (keranjang.length === 0) return null;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/portal/tagihan")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Checkout</h1>
          <p className="text-sm text-muted-foreground">
            Periksa tagihan sebelum melanjutkan ke Midtrans
          </p>
        </div>
      </div>

      {/* Detail Tagihan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Detail Tagihan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Array.from(grouped.entries()).map(([siswaId, items]) => {
            const first = items[0];
            const subtotal = items.reduce((s, i) => s + i.jumlah, 0);
            return (
              <div key={siswaId}>
                <p className="font-semibold text-sm mb-2">
                  {first.nama_siswa}
                  <span className="font-normal text-muted-foreground ml-2">
                    ({first.departemen_nama} — {first.kelas_nama})
                  </span>
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jenis Pembayaran</TableHead>
                      <TableHead>Bulan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.jenis_nama}</TableCell>
                        <TableCell>
                          {item.bulan === 0
                            ? `Sekali Bayar${item.tahun_ajaran_nama ? ` — TA ${item.tahun_ajaran_nama}` : ""}`
                            : `${NAMA_BULAN[item.bulan] || "-"}${item.tahun_ajaran_nama ? ` — TA ${item.tahun_ajaran_nama}` : ""}`}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatRupiah(item.jumlah)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-semibold">
                        Subtotal {first.nama_siswa}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {formatRupiah(subtotal)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            );
          })}

          <div className="border-t pt-4 flex justify-between items-center">
            <span className="text-lg font-bold">TOTAL TAGIHAN</span>
            <span className="text-xl font-bold text-emerald-700">
              {formatRupiah(totalAmount)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Info Pembayaran */}
      <Card>
        <CardContent className="flex items-start gap-4 p-5">
          <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Pembayaran via Midtrans</p>
            <p>
              Pilih metode pembayaran langsung di halaman Midtrans setelah menekan
              tombol di bawah. Biaya layanan, bila berlaku, dihitung dan ditampilkan
              oleh Midtrans sesuai metode yang dipilih. Aplikasi tidak menambahkan
              biaya admin ke total tagihan.
            </p>
          </div>
        </CardContent>
      </Card>

      {midtransError ? (
        <p className="text-sm text-destructive text-center">
          Layanan pembayaran belum siap: {midtransError}
        </p>
      ) : null}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => navigate("/portal/tagihan")}
          disabled={isLoading}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Ubah Pilihan
        </Button>
        <Button
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12 text-base"
          onClick={handleBayar}
          disabled={isLoading || !isMidtransReady}
        >
          {isLoading || isMidtransLoading ? (
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
          ) : (
            <CreditCard className="h-5 w-5 mr-2" />
          )}
          {isMidtransLoading ? "Memuat..." : "Lanjutkan Pembayaran"}
        </Button>
      </div>
    </div>
  );
}
