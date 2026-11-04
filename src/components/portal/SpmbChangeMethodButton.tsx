import { useState } from "react";
import { toast } from "sonner";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pmbChangePaymentMethod } from "@/server/pmbChangeMethod";

interface SpmbChangeMethodButtonProps {
  paymentToken: string;
  /** Diganti saat pengujian; bawaan: pindah ke halaman pembayaran Midtrans. */
  onRedirect?: (url: string) => void;
}

const MAX_CHANGES = 3;

export function SpmbChangeMethodButton({ paymentToken, onRedirect }: SpmbChangeMethodButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await pmbChangePaymentMethod({ data: { payment_token: paymentToken } });
      if (result.perubahan_tersisa === 0) {
        toast.warning("Ini penggantian metode terakhir untuk pendaftaran ini.");
      }
      (onRedirect ?? ((url: string) => window.location.assign(url)))(result.redirect_url);
    } catch (error: unknown) {
      toast.error("Gagal mengganti metode pembayaran", {
        description: error instanceof Error ? error.message : "Terjadi kesalahan teknis",
      });
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="min-h-11 w-full" onClick={() => setOpen(true)}>
        <Repeat className="mr-2 h-4 w-4" />Ganti Metode Pembayaran
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!loading) setOpen(next); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ganti metode pembayaran?</DialogTitle>
            <DialogDescription>
              Nomor Virtual Account atau kode QR yang sudah muncul akan dimatikan, lalu Anda memilih metode baru.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li><strong>Jangan transfer ke nomor atau kode lama</strong> setelah ini.</li>
            <li>Jika Anda sudah terlanjur membayar, jangan ganti metode. Tunggu beberapa menit lalu tekan Perbarui Status.</li>
            <li>Penggantian dibatasi maksimal {MAX_CHANGES} kali per pendaftaran.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Batal</Button>
            <Button disabled={loading} onClick={() => void confirm()} className="bg-emerald-600 hover:bg-emerald-700">
              {loading ? "Memproses..." : "Ya, ganti metode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
