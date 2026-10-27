import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Link2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createPaymentLink, type CreatePaymentLinkResult } from "@/server/paymentLink";
import { buildWhatsappShareUrl, formatLinkDeadline, normalizeWhatsappPhone, PAYMENT_LINK_TTL_DAYS } from "@/lib/paymentLink";
import { formatRupiah } from "@/hooks/useKeuangan";

export interface LinkPembayaranBill {
  id: string;
  label: string;
  sisa: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siswaId: string;
  siswaNama: string;
  bills: LinkPembayaranBill[];
}

/**
 * Kasir/admin membuat link pembayaran Midtrans untuk orang tua yang tidak memakai
 * aplikasi portal. Token hanya ditampilkan sekali di dialog ini.
 */
export function DialogLinkPembayaran({ open, onOpenChange, siswaId, siswaNama, bills }: Props) {
  const [result, setResult] = useState<CreatePaymentLinkResult | null>(null);
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setPhone("");
      setCopied(false);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => createPaymentLink({ data: { siswa_id: siswaId, tagihan_ids: bills.map((b) => b.id) } }),
    onSuccess: (data) => {
      setResult(data);
      setPhone(data.telepon ?? "");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const total = bills.reduce((sum, b) => sum + b.sisa, 0);
  const normalizedPhone = normalizeWhatsappPhone(phone);

  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.message);
      setCopied(true);
      toast.success("Pesan dan link disalin");
    } catch {
      toast.error("Tidak dapat menyalin otomatis. Salin link secara manual.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Link Pembayaran Orang Tua</DialogTitle>
          <DialogDescription>
            Orang tua dapat membayar lewat QRIS, Virtual Account, e-wallet, atau minimarket tanpa aplikasi portal.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium">{siswaNama}</p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {bills.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3">
                    <span>{b.label}</span>
                    <span className="tabular-nums">{formatRupiah(b.sisa)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatRupiah(total)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Orang tua boleh membayar sebagian dari daftar ini (bulan terlama lebih dulu). Link berlaku {PAYMENT_LINK_TTL_DAYS} hari
              dan dapat dibatalkan dari menu Link Pembayaran.
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label>Link pembayaran</Label>
              <Input readOnly value={result.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                Berlaku sampai {formatLinkDeadline(result.expires_at)}. Demi keamanan link hanya ditampilkan sekali;
                bila hilang, buat link baru dan batalkan yang lama.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-wa-phone">Nomor WhatsApp orang tua</Label>
              <Input
                id="link-wa-phone"
                inputMode="tel"
                placeholder="08xxxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {phone && !normalizedPhone && <p className="text-xs text-destructive">Nomor tidak valid.</p>}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending || bills.length === 0}>
                {create.isPending ? "Membuat link..." : "Buat Link"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={copyLink}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                Salin Pesan
              </Button>
              <Button asChild>
                <a
                  href={buildWhatsappShareUrl(normalizedPhone, result.message)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />Kirim via WhatsApp
                </a>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
