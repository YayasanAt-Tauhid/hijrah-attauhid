import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { syncMidtransPaymentStatus, resumePendingMidtransPayment, cancelPendingMidtransPayment } from "@/server/payment";
import { useMidtrans } from "@/hooks/useMidtrans";
import { useSearchParams } from "@/lib/router-compat";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { Ban, CheckCircle2, Clock, Copy, Download, History, Loader2, CreditCard, XCircle, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { PrintKuitansiGabungan } from "@/components/shared/PrintKuitansiGabungan";
import { canDownloadReceipt, downloadReceiptPdf, type PortalReceipt } from "@/lib/receiptDownload";
import { portalReceiptIdentity } from "@/lib/portalReceiptData";
import { historyBillBalance, isPendingHistoryOutdated, type HistoryBillBalance } from "@/lib/paymentHistory";
import { PortalHero } from "@/components/portal/PortalHero";
import { labelMetode } from "@/lib/portalRiwayatLabel";
import { cn } from "@/lib/utils";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);

// Status selalu berupa teks, bukan hanya warna.
const statusConfig: Record<string, { label: string; icon: LucideIcon; tint: string }> = {
  paid: { label: "Berhasil", icon: CheckCircle2, tint: "bg-emerald-100 text-emerald-800" },
  pending: { label: "Menunggu", icon: Clock, tint: "bg-amber-100 text-amber-900" },
  failed: { label: "Gagal", icon: XCircle, tint: "bg-red-100 text-red-800" },
  expired: { label: "Kedaluwarsa", icon: Ban, tint: "bg-slate-200 text-slate-800" },
};

interface RiwayatItem {
  key: string;
  order_id: string | null; // hanya ada untuk transaksi online
  tanggal: string | null;
  payment_type: string | null;
  status: string;
  total_amount: number;
  biaya_admin: number;
  expired_at?: string | null;
  gateway_closed_at?: string | null;
  has_snap_token?: boolean;
  receipt: PortalReceipt;
  items: { id: string; nama_item: string; jumlah: number; balance?: HistoryBillBalance | null }[];
}

export default function PortalRiwayat() {
  const { user } = useAuth();
  const { loadMidtrans } = useMidtrans();
  const [paymentAction, setPaymentAction] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<RiwayatItem | null>(null);
  useEffect(() => { void loadMidtrans(); }, [loadMidtrans]);
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
              .select("id, jumlah, bulan, tanggal_bayar, keterangan, tagihan:tagihan_id(id, label_tampil, nominal, status, pembayaran!pembayaran_tagihan_id_fkey(jumlah)), siswa:siswa_id(nama, nis, nisn, kelas_siswa(aktif, kelas:kelas_id(nama))), departemen:departemen_id(nama), jenis_pembayaran:jenis_id(nama), jurnal:jurnal_id(nomor)")
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
          expired_at: tx.expired_at,
          gateway_closed_at: tx.gateway_closed_at,
          has_snap_token: Boolean(tx.snap_token),
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
          items: [{ id: p.id, nama_item: p.tagihan?.label_tampil || p.keterangan || p.jenis_pembayaran?.nama || "Pembayaran", jumlah: Number(p.jumlah), balance: historyBillBalance(p.tagihan) }],
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

  const lanjutkanPembayaran = async (tx: RiwayatItem) => {
    if (!tx.order_id || paymentAction) return;
    setPaymentAction(tx.order_id);
    try {
      if (!window.snap || typeof window.snap.pay !== "function") {
        await loadMidtrans();
      }
      if (!window.snap || typeof window.snap.pay !== "function") {
        throw new Error("Layanan Midtrans belum siap. Silakan coba lagi.");
      }
      const result = await resumePendingMidtransPayment({ data: { order_id: tx.order_id } });
      // Same token + order ID: no new transaction is created on a retry.
      window.snap.pay(result.snap_token, {
        onSuccess: () => {
          toast.success("Pembayaran diterima Midtrans. Sedang memeriksa pencatatan...");
          void syncMidtransPaymentStatus({ data: { order_id: result.order_id } })
            .catch(() => toast.info("Pencatatan pembayaran masih diverifikasi. Periksa kembali Riwayat."))
            .finally(() => void queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] }));
        },
        onPending: () => {
          toast.info("Pembayaran masih pending. Nomor transaksi tetap sama.");
          void queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] });
        },
        onError: () => {
          toast.error("Midtrans melaporkan kendala pembayaran. Periksa kembali status sebelum mencoba lagi.");
          void queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] });
        },
        onClose: () => toast.info("Jendela pembayaran ditutup. Transaksi tetap aktif hingga dibatalkan atau kedaluwarsa."),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal melanjutkan pembayaran.");
      void queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] });
    } finally {
      setPaymentAction(null);
    }
  };

  const batalkanPembayaran = async () => {
    if (!cancelTarget?.order_id || paymentAction) return;
    const orderId = cancelTarget.order_id;
    setPaymentAction(orderId);
    try {
      await cancelPendingMidtransPayment({ data: { order_id: orderId } });
      toast.success("Sesi Midtrans berhasil ditutup. Anda dapat memilih tagihan dan membuat pembayaran baru.");
      setCancelTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sesi Midtrans belum bisa dibatalkan.");
      void queryClient.invalidateQueries({ queryKey: ["portal-riwayat", user?.id] });
    } finally {
      setPaymentAction(null);
    }
  };

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
    <div className="mx-auto w-full max-w-3xl space-y-4 animate-fade-in">
      <PortalHero
        title="Riwayat Pembayaran"
        subtitle="Semua pembayaran Anda, online maupun di kasir sekolah."
        icon={History}
      />

      {transaksi.length === 0 ? (
        <p className="rounded-[1.125rem] border bg-card py-12 text-center text-sm text-muted-foreground shadow-sm">
          Belum ada riwayat pembayaran
        </p>
      ) : (
        <Accordion type="single" collapsible defaultValue={highlightOrder || undefined} className="space-y-3">
          {transaksi.map((tx) => {
            const status = statusConfig[tx.status] || statusConfig.pending;
            const StatusIcon = status.icon;
            const items = tx.items;
            const isHighlighted = tx.order_id === highlightOrder;
            const outdated = isPendingHistoryOutdated(tx.status, items);
            const metode = labelMetode(tx.payment_type) || (tx.order_id ? "" : "Bayar di Kasir");
            const bisaLanjut =
              tx.status === "pending" && !outdated &&
              !!tx.expired_at && new Date(tx.expired_at).getTime() > Date.now();

            return (
              <AccordionItem
                key={tx.key}
                value={tx.order_id || tx.key}
                className={cn(
                  "overflow-hidden rounded-[1.125rem] border bg-card shadow-sm",
                  isHighlighted && "ring-2 ring-emerald-500",
                )}
              >
                <AccordionTrigger className="gap-3 px-4 py-3.5 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span aria-hidden="true" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", status.tint)}>
                      <StatusIcon className="h-[22px] w-[22px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-lg font-extrabold leading-tight tabular-nums">
                          {formatRupiah(tx.total_amount)}
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", status.tint)}>
                          {status.label}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {tx.tanggal && format(new Date(tx.tanggal), "dd MMM yyyy · HH.mm", { locale: idLocale })}
                        {metode && ` · ${metode}`}
                      </span>
                      <span className="sr-only">{tx.order_id || "Bayar di Kasir"}</span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3 border-t pt-3">
                    {tx.order_id && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Nomor pesanan</span>
                        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                          {tx.order_id}
                        </span>
                        <button
                          type="button"
                          aria-label="Salin nomor pesanan"
                          onClick={() => copyOrderId(tx.order_id!)}
                          className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {outdated && (
                      <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        Nominal transaksi lama ini sudah tidak sesuai dengan sisa tagihan atau tagihannya tidak dapat dibayar.
                        Jangan membayar melalui transaksi ini. Buka menu Biaya untuk melihat sisa terbaru.
                        Status pembayaran di Midtrans masih perlu dikonfirmasi.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {items.map((item) => (
                        <li key={item.id} className="rounded-xl border bg-muted/40 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm font-semibold leading-snug">{item.nama_item}</span>
                            <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                              {formatRupiah(item.jumlah)}
                            </span>
                          </div>
                          {item.balance && (
                            <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                              <p>Total tagihan: {formatRupiah(item.balance.nominal)}</p>
                              <p>Sudah dibayar: {formatRupiah(item.balance.paid)}</p>
                              <p className="font-medium text-foreground">
                                {item.balance.remaining === 0
                                  ? "Tagihan lunas"
                                  : `Sisa tagihan: ${formatRupiah(item.balance.remaining)}`}
                              </p>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {items.some((item) => item.balance) && (
                      <p className="text-xs text-muted-foreground">
                        Sisa tagihan di atas adalah kondisi saat ini, termasuk pembayaran setelah transaksi ini.
                      </p>
                    )}
                    {bisaLanjut && (
                      <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] leading-snug text-amber-900">
                        {`Selesaikan sebelum ${format(new Date(tx.expired_at!), "dd MMM yyyy · HH.mm", { locale: idLocale })}.`}
                      </p>
                    )}
                    {tx.order_id && !tx.gateway_closed_at && tx.status !== "paid" && tx.has_snap_token && (
                      <div className="flex flex-col gap-2">
                        {bisaLanjut && (
                          <Button className="min-h-12 w-full rounded-xl bg-emerald-700 text-[15px] font-bold hover:bg-emerald-800" disabled={!!paymentAction} onClick={() => void lanjutkanPembayaran(tx)}>
                            {paymentAction === tx.order_id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> :
                              <CreditCard className="mr-1.5 h-4 w-4" />}
                            Lanjutkan Pembayaran
                          </Button>
                        )}
                        <Button variant="outline" className="min-h-12 w-full rounded-xl text-[15px] font-semibold" disabled={!!paymentAction} onClick={() => setCancelTarget(tx)}>
                          <XCircle className="mr-1.5 h-4 w-4" />
                          Batalkan Pembayaran
                        </Button>
                      </div>
                    )}
                    {canDownloadReceipt(tx.status) && (
                      <Button
                        variant="outline"
                        className="min-h-12 w-full rounded-xl text-[15px] font-semibold"
                        disabled={!!downloadTarget}
                        onClick={() => downloadKwitansi(tx)}
                      >
                        {downloadTarget?.key === tx.key
                          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          : <Download className="mr-1.5 h-4 w-4" />}
                        {downloadTarget?.key === tx.key ? "Menyiapkan PDF..." : "Download kwitansi"}
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open && !paymentAction) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan sesi pembayaran ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Pembatalan akan diperiksa dan dikirim ke Midtrans. Tagihan sekolah tidak dihapus.
              Setelah sesi benar-benar ditutup, Anda dapat membuat transaksi pembayaran baru.
              Jika pembayaran ternyata sudah diterima Midtrans, pembatalan akan ditolak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!paymentAction}>Kembali</AlertDialogCancel>
            <AlertDialogAction disabled={!!paymentAction} onClick={(event) => { event.preventDefault(); void batalkanPembayaran(); }}>
              {paymentAction ? "Memeriksa Midtrans..." : "Ya, Batalkan Pembayaran"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
