import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LaporanOnlinePaymentJenis from "@/pages/keuangan/LaporanOnlinePaymentJenis";
import { StatsCard } from "@/components/shared/StatsCard";
import { DataTable, DataTableColumn } from "@/components/shared/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  CreditCard, Clock, CheckCircle2, XCircle, AlertTriangle,
  Search, Eye, Globe, Banknote, TrendingUp,
} from "lucide-react";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
  pending: { label: "Pending", variant: "outline", icon: Clock },
  paid: { label: "Lunas", variant: "default", icon: CheckCircle2 },
  failed: { label: "Gagal", variant: "destructive", icon: XCircle },
  expired: { label: "Kadaluarsa", variant: "secondary", icon: AlertTriangle },
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  bank_transfer: "Transfer Bank",
  credit_card: "Kartu Kredit",
  gopay: "GoPay",
  shopeepay: "ShopeePay",
  qris: "QRIS",
  echannel: "Mandiri Bill",
  cstore: "Minimarket",
};

const NAMA_BULAN = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default function OnlinePayment() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  // Fetch all transactions
  const { data: transaksiList, isLoading } = useQuery({
    queryKey: ["transaksi_midtrans_admin", filterStatus, searchTerm, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from("transaksi_midtrans")
        .select("*")
        .order("created_at", { ascending: false });

      if (filterStatus !== "all") q = q.eq("status", filterStatus);
      if (searchTerm) q = q.ilike("order_id", `%${searchTerm}%`);
      if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);

      const { data, error } = await q.limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["transaksi_midtrans_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaksi_midtrans")
        .select("status, total_amount");
      if (error) throw error;

      const rows = data || [];
      const total = rows.length;
      const paid = rows.filter(r => r.status === "paid");
      const pending = rows.filter(r => r.status === "pending");
      const failed = rows.filter(r => r.status === "failed" || r.status === "expired");
      const totalPaid = paid.reduce((s, r) => s + Number(r.total_amount), 0);
      const totalPending = pending.reduce((s, r) => s + Number(r.total_amount), 0);

      return { total, paidCount: paid.length, pendingCount: pending.length, failedCount: failed.length, totalPaid, totalPending };
    },
  });

  // Detail dialog data
  const { data: detailData } = useQuery({
    queryKey: ["transaksi_midtrans_detail", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data: tx } = await supabase
        .from("transaksi_midtrans")
        .select("*")
        .eq("id", detailId!)
        .single();

      const { data: items } = await supabase
        .from("transaksi_midtrans_item")
        .select("*, pembayaran:pembayaran_id(id, tanggal_bayar)")
        .eq("transaksi_id", detailId!);

      return { tx, items: items || [] };
    },
  });

  const columns: DataTableColumn<any>[] = [
    {
      key: "order_id", label: "Order ID", sortable: true,
      render: (v) => <span className="font-mono text-xs">{v as string}</span>,
    },
    {
      key: "created_at", label: "Tanggal", sortable: true,
      render: (v) => v ? format(new Date(v as string), "dd MMM yyyy HH:mm", { locale: idLocale }) : "-",
    },
    {
      key: "total_amount", label: "Jumlah", sortable: true,
      render: (v) => <span className="font-semibold">{formatRupiah(Number(v))}</span>,
    },
    {
      key: "payment_type", label: "Metode",
      render: (v) => v ? <Badge variant="secondary">{PAYMENT_TYPE_LABELS[v as string] || (v as string)}</Badge> : <span className="text-muted-foreground">-</span>,
    },
    {
      key: "status", label: "Status",
      render: (v) => {
        const s = STATUS_MAP[v as string] || STATUS_MAP.pending;
        const Icon = s.icon;
        return (
          <Badge variant={s.variant} className="gap-1">
            <Icon className="h-3 w-3" />
            {s.label}
          </Badge>
        );
      },
    },
    {
      key: "paid_at", label: "Dibayar",
      render: (v) => v ? format(new Date(v as string), "dd MMM yyyy HH:mm", { locale: idLocale }) : "-",
    },
    {
      key: "_aksi", label: "",
      render: (_, r) => (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailId(r.id)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Online Payment</h1>
        <p className="text-sm text-muted-foreground">Monitor transaksi pembayaran online via Midtrans</p>
      </div>

      <Tabs defaultValue="transaksi" className="space-y-6">
        <TabsList>
          <TabsTrigger value="transaksi">Transaksi</TabsTrigger>
          <TabsTrigger value="laporan">Laporan per Jenis</TabsTrigger>
        </TabsList>
        <TabsContent value="laporan">
          <LaporanOnlinePaymentJenis />
        </TabsContent>
        <TabsContent value="transaksi" className="space-y-6">
      {/* Stats Cards */}
      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Transaksi" value={String(stats.total)} icon={Globe} />
          <StatsCard title="Berhasil Dibayar" value={formatRupiah(stats.totalPaid)} icon={CheckCircle2} color="success" />
          <StatsCard title="Menunggu Bayar" value={formatRupiah(stats.totalPending)} icon={Clock} color="warning" />
          <StatsCard title="Gagal / Expired" value={String(stats.failedCount)} icon={XCircle} color="destructive" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Cari Order ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="paid">Lunas</SelectItem>
              <SelectItem value="failed">Gagal</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Dari</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Sampai</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={transaksiList || []}
            loading={isLoading}
            searchable={false}
            exportable
            exportFilename="online-payment"
            pageSize={20}
          />
        </CardContent>
      </Card>

        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={() => setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Detail Transaksi
            </DialogTitle>
          </DialogHeader>
          {detailData?.tx && (
            <div className="space-y-5">
              {/* Transaction Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Order ID</p>
                  <p className="font-mono font-medium">{detailData.tx.order_id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <div className="mt-0.5">
                    {(() => {
                      const s = STATUS_MAP[detailData.tx.status] || STATUS_MAP.pending;
                      const Icon = s.icon;
                      return <Badge variant={s.variant} className="gap-1"><Icon className="h-3 w-3" />{s.label}</Badge>;
                    })()}
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Jumlah</p>
                  <p className="font-bold text-lg">{formatRupiah(Number(detailData.tx.total_amount))}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Metode Bayar</p>
                  <p className="font-medium">{PAYMENT_TYPE_LABELS[detailData.tx.payment_type] || detailData.tx.payment_type || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dibuat</p>
                  <p>{format(new Date(detailData.tx.created_at), "dd MMMM yyyy HH:mm:ss", { locale: idLocale })}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dibayar</p>
                  <p>{detailData.tx.paid_at ? format(new Date(detailData.tx.paid_at), "dd MMMM yyyy HH:mm:ss", { locale: idLocale }) : "-"}</p>
                </div>
                {detailData.tx.midtrans_transaction_id && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Midtrans Transaction ID</p>
                    <p className="font-mono text-xs">{detailData.tx.midtrans_transaction_id}</p>
                  </div>
                )}
                {detailData.tx.expired_at && (
                  <div>
                    <p className="text-muted-foreground">Kadaluarsa</p>
                    <p>{format(new Date(detailData.tx.expired_at), "dd MMM yyyy HH:mm", { locale: idLocale })}</p>
                  </div>
                )}
                {detailData.tx.fraud_status && (
                  <div>
                    <p className="text-muted-foreground">Fraud Status</p>
                    <Badge variant={detailData.tx.fraud_status === "accept" ? "default" : "destructive"}>{detailData.tx.fraud_status}</Badge>
                  </div>
                )}
              </div>

              {/* Jurnal info from metadata */}
              {detailData.tx.metadata && typeof detailData.tx.metadata === "object" && !Array.isArray(detailData.tx.metadata) && (detailData.tx.metadata as any).jurnal_nomor && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Banknote className="h-5 w-5 text-primary shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Auto-Jurnal: {(detailData.tx.metadata as any).jurnal_nomor}</p>
                      <p className="text-muted-foreground text-xs">Jurnal akuntansi otomatis telah dibuat untuk transaksi ini</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Item Details */}
              <div>
                <h4 className="font-semibold text-sm mb-2">Detail Item ({detailData.items.length})</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Bulan</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Pembayaran</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailData.items.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">{item.nama_item}</TableCell>
                        <TableCell>{NAMA_BULAN[item.bulan] || item.bulan}</TableCell>
                        <TableCell className="text-right font-medium">{formatRupiah(Number(item.jumlah))}</TableCell>
                        <TableCell>
                          {item.pembayaran ? (
                            <Badge variant="default" className="gap-1 text-xs">
                              <CheckCircle2 className="h-3 w-3" />Tercatat
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
