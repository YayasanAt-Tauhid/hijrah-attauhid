import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/hooks/useKeuangan";
import { ajukanPembatalanPembayaran } from "@/server/pembatalanPembayaran";

export interface PembatalanTarget {
  id: string;
  label: string;
  jumlah: number;
  tanggal: string | null;
}

const MIN_REASON = 5;

/** Kasir/keuangan mengajukan pembatalan; pembayaran baru berubah setelah disetujui. */
export function DialogAjukanPembatalan({ target, onClose }: { target: PembatalanTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [alasan, setAlasan] = useState("");
  const trimmed = alasan.trim();

  const submit = useMutation({
    mutationFn: () => ajukanPembatalanPembayaran({ data: { pembayaran_id: target.id, alasan: trimmed } }),
    onSuccess: async () => {
      toast.success("Pengajuan pembatalan terkirim", { description: "Menunggu persetujuan bendahara, sekretaris, atau admin." });
      await queryClient.invalidateQueries({ queryKey: ["pengajuan_pembatalan"] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajukan pembatalan pembayaran</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            Pembayaran <strong>belum dibatalkan</strong>. Pembatalan baru berlaku setelah disetujui, dan hanya untuk koreksi
            salah input pada periode yang belum tutup buku.
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
            <p>Pembayaran: <span className="font-medium">{target.label}</span></p>
            <p>Jumlah: <span className="font-semibold">{formatRupiah(target.jumlah)}</span></p>
            {target.tanggal && <p>Tanggal: <span className="font-medium">{target.tanggal}</span></p>}
          </div>
          <div>
            <Label htmlFor="alasan-pembatalan">Alasan pembatalan *</Label>
            <Textarea
              id="alasan-pembatalan"
              rows={3}
              placeholder="mis. Salah pilih siswa / salah bulan / dobel input..."
              value={alasan}
              onChange={(event) => setAlasan(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <Button disabled={trimmed.length < MIN_REASON || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Mengirim..." : "Kirim pengajuan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
