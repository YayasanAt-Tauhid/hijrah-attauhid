import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { syncMidtransPaymentStatus } from "@/server/payment";
import { useSearchParams } from "@/lib/router-compat";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Copy, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { PrintKuitansiGabungan } from "@/components/shared/PrintKuitansiGabungan";
import { canDownloadReceipt, downloadReceiptPdf, type PortalReceipt } from "@/lib/receiptDownload";
import { portalReceiptIdentity } from "@/lib/portalReceiptData";
import { historyBillBalance, isPendingHistoryOutdated, type HistoryBillBalance } from "@/lib/paymentHistory";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  paid: { label: "Pembayaran berhasil", variant: "default" },
  pending: { label: "Menunggu", variant: "secondary" },
  failed: { label: "Gagal", variant: "destructive" },
  expired: { label: "Kedaluwarsa", variant: "outline" },
};

interface RiwayatItem {
  key: string;
  order_id: string | null; // hanya ada untuk transaksi online
  tanggal: string | null;
  payment_type: string | null;
  status: string;
  total_amount: number;
  biaya_admin: number;
  receipt: PortalReceipt;
  items: { id: string; nama_item: string; jumlah: number; balance?: HistoryBillBalance | null }[];
}

export default function PortalRiwayat() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const highlightOrder = searchParams.get("order");
  const queryClient = useQueryClient();
  const syncedOrderRef = useRef<string | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<RiwayatItem | null>(null);

  const { data: anakIds = [] } = useQuery({
    queryKey: ["portal-anak-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ortu_siswa")
        .select("siswa_id")
        .eq("user_id", user!.id);
      return (data || []).map((d: any) => d.siswa_id);
    },
    enabled: !!user,
  });

  const { data: transaksi = [], isLoading, isError } = useQuery({
    queryKey: ["portal-riwayat", user?.id, anakIds],
    queryFn: async (): Promise<RiwayatItem[]> => {
      const [onlineResult, manualResult] = await Promise.all([
        supabase
          .from("transaksi_midtrans")
          .select("*, transaksi_midtrans_item(*, tagihan:tagihan_id(id, nominal, status, pembayaran!pembayaran_tagihan_id_fkey(jumlah)), siswa:siswa_id(nama, nis, nisn, kelas_siswa(aktif, kelas:kelas_id(nama))), departemen:departemen_id(nama))")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false }),
        anakIds.length > 0
          ? supabase
              .from("pembayaran")
              .select("id, jumlah, bulan, tanggal_bayar, keterangan, tagihan:tagihan_id(id, nominal, status, pembayaran!pembayaran_tagihan_id_fkey(jumlah)), siswa:siswa_id(nama, nis, nisn, kelas_siswa(aktif, kelas:kelas_id(nama))), departemen:departemen_id(nama), jenis_pembayaran:jenis_id(nama), jurnal:jurnal_id(nomor)")
              .in("siswa_id", anakIds)
              .order("tanggal_bayar", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      if (onlineResult.error) throw onlineResult.error;
      if ("error" in manualResult && manualResult.error) throw manualResult.error;
      const online = onlineResult.data;
      const manual = manualResult.data;

      // Pembayaran online yang sudah sukses juga tercatat di tabel `pembayaran`
      // (proses_pembayaran_midtrans_atomik ikut insert ke sana supaya jurnal &
      // status tagihan konsisten dengan jalur kasir). Tanpa filter ini, satu
      // transaksi online yang sama muncul DUA KALI di riwayat: sekali dari
      // transaksi_midtrans (metode aslinya, mis. QRIS), sekali lagi dari
      // `pembayaran` -- dan yang kedua salah dilabeli "Kasir" karena baris ini
      // tidak tahu bahwa asalnya online.
      const pembayaranIdOnline = new Set<string>(
        (online || []).flatMap((tx: any) =>
          (tx.transaksi_midtrans_item || [])
            .map((i: any) => i.pembayaran_id)
            .filter(Boolean)
        )
      );

      const onlineItems: RiwayatItem[] = (online || []).map((tx: any) => {
        const biayaAdmin = Number(tx.biaya_admin) || 0;
        const items = (tx.transaksi_midtrans_item || []).map((i: any) => ({
          id: i.id,
          nama_item: i.nama_item,
          jumlah: Number(i.jumlah),
          balance: historyBillBalance(i.tagihan),
        }));
        if (biayaAdmin > 0) {
          items.push({ id: `${tx.id}-biaya-admin`, nama_item: "Biaya Admin", jumlah: biayaAdmin });
        }
        return {
          key: tx.id,
          order_id: tx.order_id,
          tanggal: tx.created_at,
          payment_type: tx.payment_type,
          status: tx.status,
          total_amount: Number(tx.total_amount) + biayaAdmin,
          biaya_admin: biayaAdmin,
          items,
          receipt: {
            ...portalReceiptIdentity(tx.transaksi_midtrans_item || []),
            nomorBukti: tx.order_id,
            tanggalBayar: tx.paid_at || tx.created_at,
            metode: tx.payment_type || "Online",
            petugasNama: "Pembayaran Online",
            keterangan: tx.order_id ? `Order ID: ${tx.order_id}` : undefined,
            items: items.map((item: { id: string; nama_item: string; jumlah: number }) => ({
              id: item.id, jenisNama: item.nama_item, jumlah: item.jumlah, bulan: 0,
            })),
          },
        };
      });

      // Pembayaran yang dicatat manual oleh kasir/keuangan (bayar tunai/transfer
      // di kantor) -- exclude yang sebenarnya berasal dari pembayaran online
      // (sudah direpresentasikan oleh onlineItems di atas).
      const manualItems: RiwayatItem[] = (manual || [])
        .filter((p: any) => !pembayaranIdOnline.has(p.id))
        .map((p: any) => ({
          key: p.id,
          order_id: null,
          tanggal: p.tanggal_bayar,
          payment_type: "Kasir",
          status: "paid",
          total_amount: Number(p.jumlah),
          biaya_admin: 0,
          items: [{ id: p.id, nama_item: p.keterangan || p.jenis_pembayaran?.nama || "Pembayaran", jumlah: Number(p.jumlah), balance: historyBillBalance(p.tagihan) }],
          receipt: {
            ...portalReceiptIdentity([p]),
            nomorBukti: p.jurnal?.nomor || `HT-${format(new Date(p.tanggal_bayar), "yyyyMMdd")}-${p.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
            tanggalBayar: p.tanggal_bayar,
            metode: "Kasir",
            keterangan: p.keterangan || undefined,
            items: [{ id: p.id, jenisNama: p.jenis_pembayaran?.nama || "Pembayaran", jumlah: Number(p.jumlah), bulan: Number(p.bulan || 0) }],
          },
        }));

      return [...onlineItems, ...manualItems].sort((a, b) => {
        const ta = a.tanggal ? new Date(a.tanggal).getTime() : 0;
        const tb = b.tanggal ? new Date(b.tanggal).getTime() : 0;
        return tb - ta;
      });
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!highlightOrder || transaksi.length === 0) return;
    const found = transaksi.find((t) => t.order_id === highlightOrder);
    if (!found) return;

    if (found.status === "paid") {
      toast.success(`Transaksi ${highlightOrder} berhasil diproses`);
      return;
    }

    // Callback browser tidak selalu dibarengi webhook tepat waktu. Saat orang
    // tua kembali dari Midtrans dan order masih pending, minta server mengecek
    // Status API resmi satu kali. Server tetap memverifikasi kepemilikan order
    // dan signature sebelum membuat pembayaran/jurnal.
    if (found.status === "pending" && syncedOrderRef.current !== highlightOrder) {
      syncedOrderRef.current = highlightOrder;
      void syncMidtransPaymentStatus({ data: { order_id: highlightOrder } })
        .then(async (result) => {
          await queryClient.invalidateQueries({
            queryKey: ["portal-riwayat", user?.id],
          });
          if (result.status === "paid") {
            toast.success(`Transaksi ${highlightOrder} berhasil diproses`);
          } else if (result.status === "pending") {
            toast.info("Pembayaran masih menunggu konfirmasi Midtrans");
          } else {
            toast.error(`Pembayaran berstatus ${result.status}`);
          }
        })
        .catch((error) => {
          syncedOrderRef.current = null;
          toast.error(
            error instanceof Error
              ? error.message
              : "Status pembayaran belum dapat disinkronkan"
          );
        });
    }
  }, [highlightOrder, transaksi, queryClient, user?.id]);

  const downloadKwitansi = (tx: RiwayatItem) => {
    if (!canDownloadReceipt(tx.status) || downloadTarget) return;
    setDownloadTarget(tx);
  };

  const handleExportReady = useCallback(async (element: HTMLElement) => {
    if (!downloadTarget || !canDownloadReceipt(downloadTarget.status)) return;
    try {
      await downloadReceiptPdf(element, downloadTarget.order_id || downloadTarget.key);
      toast.success("Kwitansi berhasil diunduh");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kwitansi gagal diunduh. Silakan coba lagi.");
    } finally {
      setDownloadTarget(null);
    }
  }, [downloadTarget]);

  // Bug 5b fix: copyOrderId function selesai (sesi lalu terpotong)
  const copyOrderId = (orderId: string) => {
    navigator.clipboard.writeText(orderId).then(
      () => toast.success("Order ID disalin"),
      () => toast.error("Gagal menyalin Order ID")
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return <p className="py-8 text-center text-destructive">Riwayat pembayaran gagal dimuat. Silakan muat ulang halaman.</p>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Riwayat Pembayaran
        </h1>
        <p className="text-sm text-muted-foreground">
          Daftar seluruh transaksi pembayaran Anda, baik online maupun di kasir sekolah
        </p>
      </div>

      {transaksi.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Belum ada riwayat pembayaran
          </CardContent>
        </Card>
      ) : (
        <Accordion type="single" collapsible defaultValue={highlightOrder || undefined}>
          {transaksi.map((tx) => {
            const status = statusConfig[tx.status] || statusConfig.pending;
            const items = tx.items;
            const isHighlighted = tx.order_id === highlightOrder;
            const outdated = isPendingHistoryOutdated(tx.status, items);

            return (
              <AccordionItem
                key={tx.key}
                value={tx.order_id || tx.key}
                className={isHighlighted ? "ring-2 ring-emerald-500 rounded-lg" : ""}
              >
                <Card className="mb-3">
                  <AccordionTrigger className="px-5 py-4 hover:no-underline">
                    <div className="flex min-w-0 flex-1 flex-col items-start justify-between gap-3 text-left sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                            {tx.order_id || "Bayar di Kasir"}
                          </span>
                          {tx.order_id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyOrderId(tx.order_id!);
                              }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {tx.tanggal &&
                            format(
                              new Date(tx.tanggal),
                              "dd MMM yyyy HH:mm",
                              { locale: idLocale }
                            )}
                          {tx.payment_type && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {tx.payment_type}
                            </Badge>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-sm">
                          {formatRupiah(tx.total_amount)}
                        </span>
                        <Badge
                          variant={status.variant}
                          className={
                            tx.status === "paid"
                              ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                              : tx.status === "pending"
                              ? "bg-amber-100 text-amber-800 border-amber-300"
                              : ""
                          }
                        >
                          {status.label}
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-4">
                    {outdated && (
                      <p role="alert" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        Nominal transaksi lama ini sudah tidak sesuai dengan sisa tagihan atau tagihannya tidak dapat dibayar.
                        Jangan membayar melalui transaksi ini. Buka menu Tagihan untuk melihat sisa terbaru.
                        Status pembayaran di Midtrans masih perlu dikonfirmasi.
                      </p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Jumlah transaksi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-sm">
                              {item.nama_item}
                              {item.balance && (
                                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                  <p>Total tagihan: {formatRupiah(item.balance.nominal)}</p>
                                  <p>Sudah dibayar: {formatRupiah(item.balance.paid)}</p>
                                  <p className="font-medium text-foreground">
                                    {item.balance.remaining === 0
                                      ? "Tagihan lunas"
                                      : `Sisa tagihan: ${formatRupiah(item.balance.remaining)}`}
                                  </p>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatRupiah(item.jumlah)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {items.some((item) => item.balance) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sisa tagihan di atas adalah kondisi saat ini, termasuk pembayaran setelah transaksi ini.
                      </p>
                    )}
                    {canDownloadReceipt(tx.status) && (
                      <div className="mt-3 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!downloadTarget}
                          onClick={() => downloadKwitansi(tx)}
                        >
                          {downloadTarget?.key === tx.key
                            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            : <Download className="mr-1.5 h-4 w-4" />}
                          {downloadTarget?.key === tx.key ? "Menyiapkan PDF..." : "Download kwitansi"}
                        </Button>
                      </div>
                    )}
                  </AccordionContent>
                </Card>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
      {downloadTarget && canDownloadReceipt(downloadTarget.status) && (
        <PrintKuitansiGabungan
          {...downloadTarget.receipt}
          exportMode
          onExportReady={handleExportReady}
        />
      )}
    </div>
  );
}
