import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildSpmbWithdrawalNotices } from "@/lib/spmbWithdrawalNotices";
import { spmbWithdrawRegistration } from "@/server/spmbWithdrawal";

interface SpmbWithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detailId: string;
  nama: string;
  /** Pendaftar internal: murid aktif lembaga asal yang mendaftar ke jenjang berikutnya. */
  internal: boolean;
  onWithdrawn?: () => void;
}

const MIN_REASON = 5;

function todayLocalISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function SpmbWithdrawDialog({ open, onOpenChange, detailId, nama, internal, onWithdrawn }: SpmbWithdrawDialogProps) {
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(todayLocalISO);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) return;
    setAlasan("");
    setTanggal(todayLocalISO());
  }, [open]);

  const reasonValid = alasan.trim().length >= MIN_REASON;
  const canSubmit = reasonValid && Boolean(tanggal) && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const result = await spmbWithdrawRegistration({
        data: { detail_id: detailId, alasan: alasan.trim(), tanggal_efektif: tanggal },
      });
      const notices = buildSpmbWithdrawalNotices(nama, result);
      toast.success(notices.success.title, { description: notices.success.description });
      if (notices.followUp) {
        toast.warning(notices.followUp.title, { description: notices.followUp.description, duration: 20000 });
      }
      for (const warning of notices.warnings) toast.warning(warning);
      onOpenChange(false);
      onWithdrawn?.();
    } catch (error: unknown) {
      toast.error("Gagal menandai mengundurkan diri", {
        description: error instanceof Error ? error.message : "Terjadi kesalahan teknis",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!loading) onOpenChange(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tandai mengundurkan diri</DialogTitle>
          <DialogDescription>
            {nama} akan dikeluarkan dari antrean seleksi. Tindakan ini tidak bisa dibatalkan dari aplikasi.
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tautan pembayaran akan dimatikan.</li>
          {internal ? (
            <li>Murid ini masih aktif di lembaga asal: data, kelas, dan tagihan lembaga asal tidak diubah. Tagihan lembaga tujuan perlu ditinjau manual.</li>
          ) : (
            <li>Tagihan yang belum dibayar dibatalkan, rencana tagihan dinonaktifkan, dan kelas dilepas.</li>
          )}
          <li>NIS yang sudah terbit tidak dipakai ulang.</li>
          <li>Pembayaran yang sudah masuk tidak dikembalikan otomatis; keuangan menindaklanjuti secara manual.</li>
        </ul>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="spmb-withdraw-alasan">Alasan pengunduran diri *</Label>
            <Textarea
              id="spmb-withdraw-alasan"
              value={alasan}
              maxLength={500}
              rows={3}
              placeholder="Contoh: orang tua memilih sekolah lain"
              onChange={(event) => setAlasan(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="spmb-withdraw-tanggal">Tanggal efektif *</Label>
            <Input
              id="spmb-withdraw-tanggal"
              type="date"
              value={tanggal}
              onChange={(event) => setTanggal(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>Batal</Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => void submit()}>
            Tandai mengundurkan diri
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
