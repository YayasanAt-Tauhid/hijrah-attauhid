import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import { Ban, Link2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { cancelPaymentLink, listPaymentLinks, type PaymentLinkListRow } from "@/server/paymentLink";
import type { PaymentLinkState } from "@/lib/paymentLink";
import { formatRupiah } from "@/hooks/useKeuangan";

const STATE_BADGE: Record<PaymentLinkState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aktif: { label: "Aktif", variant: "default" },
  lunas: { label: "Lunas", variant: "secondary" },
  kedaluwarsa: { label: "Kedaluwarsa", variant: "outline" },
  dibatalkan: { label: "Dibatalkan", variant: "destructive" },
};

const formatTanggal = (iso: string) => format(new Date(iso), "d MMM yyyy HH:mm", { locale: idLocale });

export default function LinkPembayaran() {
  const { role } = useAuth();
  if (!role || !["admin", "keuangan", "kasir"].includes(role)) {
    return <Unauthorized />;
  }
  return <LinkPembayaranContent isKasir={role === "kasir"} />;
}

function LinkPembayaranContent({ isKasir }: { isKasir: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"semua" | PaymentLinkState>("aktif");
  const [cancelTarget, setCancelTarget] = useState<PaymentLinkListRow | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["payment_links"],
    queryFn: () => listPaymentLinks(),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelPaymentLink({ data: { id } }),
    onSuccess: () => {
      toast.success("Link pembayaran dibatalkan");
      queryClient.invalidateQueries({ queryKey: ["payment_links"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["payment_links"] });
    },
    onSettled: () => setCancelTarget(null),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.filter((row) =>
      (stateFilter === "semua" || row.state === stateFilter) &&
      (!term || row.nama_siswa.toLowerCase().includes(term) || (row.nis ?? "").includes(term)));
  }, [data, search, stateFilter]);

  const columns: DataTableColumn<PaymentLinkListRow>[] = [
    {
      key: "nama_siswa",
      label: "Siswa",
      render: (_, row) => (
        <div>
          <p className="font-medium">{row.nama_siswa}</p>
          <p className="text-xs text-muted-foreground">{row.nis ?? "-"}</p>
        </div>
      ),
    },
    {
      key: "state",
      label: "Status",
      render: (_, row) => <Badge variant={STATE_BADGE[row.state].variant}>{STATE_BADGE[row.state].label}</Badge>,
    },
    {
      key: "sisa_tagihan",
      label: "Sisa Tagihan",
      render: (_, row) => (
        <div>
          <p className="tabular-nums">{formatRupiah(row.total_sisa)}</p>
          <p className="text-xs text-muted-foreground">{row.sisa_tagihan} dari {row.jumlah_tagihan} tagihan</p>
        </div>
      ),
    },
    { key: "created_at", label: "Dibuat", render: (_, row) => <span className="text-sm">{formatTanggal(row.created_at)}</span> },
    { key: "expires_at", label: "Berlaku Sampai", render: (_, row) => <span className="text-sm">{formatTanggal(row.expires_at)}</span> },
    ...(!isKasir ? [{ key: "pembuat" as const, label: "Dibuat Oleh" }] : []),
    {
      key: "id",
      label: "",
      render: (_, row) => row.state === "aktif" ? (
        <Button variant="outline" size="sm" onClick={() => setCancelTarget(row)}>
          <Ban className="mr-1.5 h-4 w-4" />Batalkan
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Link2 className="h-5 w-5" />Link Pembayaran Orang Tua</h1>
        <p className="text-sm text-muted-foreground">
          Link dibuat dari menu Input Pembayaran. {isKasir ? "Anda melihat link buatan Anda sendiri." : "Menampilkan link dari semua petugas."}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Cari nama atau NIS siswa" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="aktif">Aktif</SelectItem>
            <SelectItem value="lunas">Lunas</SelectItem>
            <SelectItem value="kedaluwarsa">Kedaluwarsa</SelectItem>
            <SelectItem value="dibatalkan">Dibatalkan</SelectItem>
            <SelectItem value="semua">Semua status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={rows} loading={isLoading} searchable={false} emptyMessage="Belum ada link pembayaran" />

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan link pembayaran?</AlertDialogTitle>
            <AlertDialogDescription>
              Link untuk {cancelTarget?.nama_siswa} tidak dapat dipakai lagi. Sesi Midtrans yang belum dibayar ikut ditutup.
              Pembayaran yang sudah berhasil tetap tercatat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Kembali</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={(e) => { e.preventDefault(); if (cancelTarget) cancel.mutate(cancelTarget.id); }}
            >
              {cancel.isPending ? "Membatalkan..." : "Batalkan Link"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
