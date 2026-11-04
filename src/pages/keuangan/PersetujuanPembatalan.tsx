import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { formatRupiah } from "@/hooks/useKeuangan";
import Unauthorized from "@/pages/Unauthorized";
import {
  batalkanPengajuanPembatalan,
  listPengajuanPembatalan,
  putuskanPengajuanPembatalan,
  type PengajuanPembatalan,
  type PengajuanStatus,
} from "@/server/pembatalanPembayaran";

const STATUS_LABEL: Record<PengajuanStatus, string> = {
  menunggu: "Menunggu",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibatalkan: "Dibatalkan pengaju",
};
const STATUS_CLASS: Record<PengajuanStatus, string> = {
  menunggu: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  disetujui: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
  ditolak: "bg-red-100 text-red-900 hover:bg-red-100",
  dibatalkan: "bg-muted text-muted-foreground hover:bg-muted",
};
const MIN_REASON = 5;

const formatWaktu = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");

export default function PersetujuanPembatalan() {
  const { role, can, permissionsLoading } = useAuth();
  if (permissionsLoading) return null;
  if (!role || !(can("keuangan.pembatalan.setujui") || can("keuangan.pembatalan.ajukan"))) return <Unauthorized />;
  return <PersetujuanPembatalanContent />;
}

type Decision = { item: PengajuanPembatalan; keputusan: "setujui" | "tolak" } | null;

function PersetujuanPembatalanContent() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"menunggu" | "semua">("menunggu");
  const [decision, setDecision] = useState<Decision>(null);
  const [catatan, setCatatan] = useState("");

  const query = useQuery({
    queryKey: ["pengajuan_pembatalan", filter],
    queryFn: () => listPengajuanPembatalan({ data: { status: filter } }),
  });
  const canDecide = query.data?.canDecide ?? false;
  const items = query.data?.items ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pengajuan_pembatalan"] });
    // Pembatalan yang disetujui mengubah pembayaran, tagihan, dan jurnal.
    for (const key of ["pembayaran", "pembayaran_siswa", "tagihan", "open_bills_payment_ui", "jurnal", "tunggakan"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const decide = useMutation({
    mutationFn: (variables: { id: string; keputusan: "setujui" | "tolak"; catatan: string }) =>
      putuskanPengajuanPembatalan({ data: variables }),
    onSuccess: async (_result, variables) => {
      toast.success(variables.keputusan === "setujui" ? "Pembayaran dibatalkan" : "Pengajuan ditolak");
      setDecision(null);
      setCatatan("");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => batalkanPengajuanPembatalan({ data: { id } }),
    onSuccess: async () => {
      toast.success("Pengajuan dibatalkan");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeDecision = () => { setDecision(null); setCatatan(""); };
  const trimmed = catatan.trim();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">{canDecide ? "Persetujuan Pembatalan Pembayaran" : "Pengajuan Pembatalan Saya"}</h1>
        <p className="text-sm text-muted-foreground">
          {canDecide
            ? "Setujui atau tolak pengajuan pembatalan dari kasir dan bagian keuangan. Satu persetujuan sudah cukup; pengaju tidak dapat menyetujui pengajuannya sendiri."
            : "Pantau status pengajuan pembatalan yang Anda kirim. Pembatalan baru berlaku setelah disetujui."}
        </p>
      </div>

      <div role="tablist" className="inline-flex rounded-md border bg-muted p-1 text-sm">
        {(["menunggu", "semua"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded px-3 py-1 font-medium ${filter === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {value === "menunggu" ? "Menunggu" : "Semua"}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">{(query.error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {filter === "menunggu" ? "Tidak ada pengajuan yang menunggu." : "Belum ada pengajuan."}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <PengajuanCard
              key={item.id}
              item={item}
              busy={withdraw.isPending}
              onApprove={() => setDecision({ item, keputusan: "setujui" })}
              onReject={() => setDecision({ item, keputusan: "tolak" })}
              onWithdraw={() => withdraw.mutate(item.id)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!decision} onOpenChange={(open) => { if (!open) closeDecision(); }}>
        <DialogContent className="max-w-md">
          {decision && (
            <>
              <DialogHeader>
                <DialogTitle>{decision.keputusan === "setujui" ? "Setujui pembatalan?" : "Tolak pengajuan?"}</DialogTitle>
                <DialogDescription>
                  {decision.item.snapshot.siswa_nama ?? "-"} · {decision.item.snapshot.jenis_nama ?? "Pembayaran"} ·{" "}
                  {formatRupiah(Number(decision.item.snapshot.jumlah ?? 0))}
                </DialogDescription>
              </DialogHeader>
              {decision.keputusan === "setujui" ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                    Pembayaran akan <strong>dibatalkan sekarang</strong>: jurnal pembalik dibuat, tagihan terkait dikembalikan ke belum
                    bayar, dan kuitansi ditandai batal. Tidak dapat dilakukan pada periode yang sudah tutup buku.
                  </div>
                  <div>
                    <Label htmlFor="catatan-setuju">Catatan (opsional)</Label>
                    <Textarea id="catatan-setuju" rows={2} value={catatan} onChange={(event) => setCatatan(event.target.value)} />
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="catatan-tolak">Alasan penolakan *</Label>
                  <Textarea id="catatan-tolak" rows={3} value={catatan} onChange={(event) => setCatatan(event.target.value)} />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeDecision}>Kembali</Button>
                {decision.keputusan === "setujui" ? (
                  <Button
                    variant="destructive"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: decision.item.id, keputusan: "setujui", catatan: trimmed })}
                  >
                    {decide.isPending ? "Memproses..." : "Setujui & batalkan pembayaran"}
                  </Button>
                ) : (
                  <Button
                    disabled={trimmed.length < MIN_REASON || decide.isPending}
                    onClick={() => decide.mutate({ id: decision.item.id, keputusan: "tolak", catatan: trimmed })}
                  >
                    {decide.isPending ? "Memproses..." : "Tolak pengajuan"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PengajuanCard({
  item, busy, onApprove, onReject, onWithdraw,
}: {
  item: PengajuanPembatalan;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
}) {
  const s = item.snapshot;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{s.siswa_nama ?? "-"}</p>
            <p className="text-xs text-muted-foreground">
              {[s.siswa_nis && `NIS ${s.siswa_nis}`, s.nomor_kuitansi && `Kuitansi ${s.nomor_kuitansi}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Badge className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        </div>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p>{s.jenis_nama ?? "Pembayaran"}{s.tanggal_bayar ? ` · ${s.tanggal_bayar}` : ""}</p>
          <p className="font-semibold sm:text-right">{formatRupiah(Number(s.jumlah ?? 0))}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2 text-sm">
          <p className="text-xs text-muted-foreground">Alasan pengajuan</p>
          <p>{item.alasan}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Diajukan oleh {item.diajukan_nama} · {formatWaktu(item.diajukan_at)}
        </p>
        {item.status !== "menunggu" && (
          <p className="text-xs text-muted-foreground">
            {STATUS_LABEL[item.status]}{item.diputuskan_nama ? ` oleh ${item.diputuskan_nama}` : ""} · {formatWaktu(item.diputuskan_at)}
            {item.catatan_keputusan ? ` — ${item.catatan_keputusan}` : ""}
          </p>
        )}
        {item.status === "menunggu" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {item.dapat_diputuskan && (
              <>
                <Button size="sm" variant="destructive" onClick={onApprove}>Setujui</Button>
                <Button size="sm" variant="outline" onClick={onReject}>Tolak</Button>
              </>
            )}
            {item.milik_sendiri && (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>Batalkan pengajuan</Button>
                <span className="text-xs text-muted-foreground">Anda tidak dapat menyetujui pengajuan sendiri.</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
