import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelPublicPaymentLinkSession,
  checkoutPublicPaymentLink,
  getPublicPaymentLink,
  resumePublicPaymentLinkSession,
} from "@/server/paymentLink";
import { formatLinkDeadline, readPaymentLinkTokenFromHash, toggleLinkBillSelection } from "@/lib/paymentLink";

// Disimpan per-tab agar orang tua kembali ke tagihannya setelah halaman Midtrans,
// tanpa menyertakan token di URL callback yang tersimpan di Midtrans.
const TOKEN_STORAGE_KEY = "hat_payment_link_token";

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);

function readStoredToken(): string | null {
  try {
    return readPaymentLinkTokenFromHash(sessionStorage.getItem(TOKEN_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Mode privat / storage diblokir: halaman tetap berfungsi dari link asli.
  }
}

const RETURN_MESSAGES: Record<string, { title: string; body: string; tone: "ok" | "wait" | "fail" }> = {
  selesai: {
    title: "Terima kasih, pembayaran sedang dikonfirmasi",
    body: "Status tagihan diperbarui otomatis setelah Midtrans mengonfirmasi pembayaran, biasanya dalam beberapa menit. Bukti pembayaran juga dapat diminta ke kasir sekolah.",
    tone: "ok",
  },
  tertunda: {
    title: "Pembayaran belum diselesaikan",
    body: "Jika sudah mendapat nomor Virtual Account atau kode bayar, selesaikan sebelum batas waktunya. Anda juga dapat melanjutkan pembayaran dari halaman ini.",
    tone: "wait",
  },
  gagal: {
    title: "Pembayaran gagal",
    body: "Tidak ada dana yang ditagihkan. Silakan coba lagi atau gunakan metode pembayaran lain.",
    tone: "fail",
  },
};

export default function BayarLink() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [returnStatus, setReturnStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Token hanya dibaca di browser (fragment URL tidak pernah sampai ke server).
  useEffect(() => {
    const fromHash = readPaymentLinkTokenFromHash(window.location.hash);
    const resolved = fromHash ?? readStoredToken();
    if (fromHash) storeToken(fromHash);
    setToken(resolved);
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status && RETURN_MESSAGES[status]) setReturnStatus(status);
    setReady(true);
  }, []);

  const linkQuery = useQuery({
    queryKey: ["public_payment_link", token],
    enabled: !!token,
    retry: false,
    // Saat kembali dari Midtrans, muat ulang berkala agar status lunas terlihat.
    refetchInterval: returnStatus === "selesai" ? 15_000 : false,
    queryFn: () => getPublicPaymentLink({ data: { token: token! } }),
  });
  const view = linkQuery.data;

  // Default: semua tagihan dicentang.
  useEffect(() => {
    if (view?.bills) setSelected(new Set(view.bills.map((b) => b.id)));
  }, [view?.bills]);

  const total = useMemo(
    () => (view?.bills ?? []).filter((b) => selected.has(b.id)).reduce((sum, b) => sum + b.sisa, 0),
    [view?.bills, selected],
  );

  const redirectTo = (url: string) => window.location.assign(url);

  const pay = useMutation({
    mutationFn: () => checkoutPublicPaymentLink({ data: { token: token!, tagihan_ids: [...selected] } }),
    onSuccess: (r) => redirectTo(r.redirect_url),
    onError: (e: Error) => setError(e.message),
  });
  const resume = useMutation({
    mutationFn: (orderId: string) => resumePublicPaymentLinkSession({ data: { token: token!, order_id: orderId } }),
    onSuccess: (r) => redirectTo(r.redirect_url),
    onError: (e: Error) => setError(e.message),
  });
  const cancel = useMutation({
    mutationFn: (orderId: string) => cancelPublicPaymentLinkSession({ data: { token: token!, order_id: orderId } }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["public_payment_link", token] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const busy = pay.isPending || resume.isPending || cancel.isPending;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <img src="/branding/yayasan-at-tauhid.png" alt="" className="h-10 w-10 object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">Yayasan At-Tauhid</p>
            <h1 className="text-lg font-semibold leading-tight">Pembayaran Tagihan Sekolah</h1>
          </div>
        </div>

        {returnStatus && (
          <ReturnBanner status={returnStatus} />
        )}

        {!ready || (token && linkQuery.isLoading) ? (
          <Card><CardContent className="space-y-3 p-6"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>
        ) : !token || linkQuery.isError ? (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Link tidak dapat dibuka</AlertTitle>
            <AlertDescription>
              {linkQuery.error instanceof Error
                ? linkQuery.error.message
                : "Buka kembali link pembayaran dari pesan WhatsApp sekolah, atau minta link baru ke kasir."}
            </AlertDescription>
          </Alert>
        ) : view && view.state !== "aktif" ? (
          <StateCard state={view.state} nama={view.nama_siswa} />
        ) : view ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tagihan ananda {view.nama_siswa}</CardTitle>
              <p className="text-xs text-muted-foreground">Link berlaku sampai {formatLinkDeadline(view.expires_at)}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {view.pending ? (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertTitle>Ada pembayaran yang belum diselesaikan</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>Sebesar {formatRupiah(view.pending.total_amount)}. Lanjutkan pembayaran tersebut, atau batalkan untuk memilih tagihan lain.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => resume.mutate(view.pending!.order_id)}>
                        {resume.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Lanjutkan Pembayaran
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => cancel.mutate(view.pending!.order_id)}>
                        {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Batalkan &amp; Pilih Ulang
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <ul className="divide-y rounded-lg border">
                    {view.bills.map((bill) => (
                      <li key={bill.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected.has(bill.id)}
                            onChange={(e) => setSelected(toggleLinkBillSelection(view.bills, selected, bill.id, e.target.checked))}
                          />
                          <span className="flex-1 text-sm">
                            <span className="font-medium">{bill.jenis_nama}</span>
                            {bill.periode && <span className="block text-xs text-muted-foreground">{bill.periode}</span>}
                          </span>
                          <span className="text-sm tabular-nums">{formatRupiah(bill.sisa)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">Tagihan bulanan dibayar berurutan mulai dari bulan terlama.</p>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">Total dibayar</span>
                    <span className="text-lg font-semibold tabular-nums">{formatRupiah(total)}</span>
                  </div>
                  <Button className="w-full" size="lg" disabled={busy || selected.size === 0} onClick={() => { setError(null); pay.mutate(); }}>
                    {pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Bayar Sekarang
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Biaya layanan (bila ada) ditampilkan oleh Midtrans sesuai metode pembayaran.
                  </p>
                </>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ) : null}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Pembayaran diproses oleh Midtrans. Pastikan alamat halaman ini adalah domain resmi sekolah, dan jangan bagikan
          link ini kepada orang lain.
        </p>
      </div>
    </div>
  );
}

function ReturnBanner({ status }: { status: string }) {
  const msg = RETURN_MESSAGES[status];
  const Icon = msg.tone === "ok" ? CheckCircle2 : msg.tone === "wait" ? Clock : XCircle;
  return (
    <Alert variant={msg.tone === "fail" ? "destructive" : "default"}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{msg.title}</AlertTitle>
      <AlertDescription>{msg.body}</AlertDescription>
    </Alert>
  );
}

function StateCard({ state, nama }: { state: "lunas" | "dibatalkan" | "kedaluwarsa"; nama: string }) {
  const content = {
    lunas: { icon: CheckCircle2, title: "Tagihan sudah lunas", body: `Semua tagihan ananda ${nama} pada link ini sudah lunas. Jazakumullahu khairan.` },
    dibatalkan: { icon: XCircle, title: "Link sudah dibatalkan", body: "Link ini dibatalkan oleh sekolah. Silakan minta link pembayaran baru ke kasir." },
    kedaluwarsa: { icon: Clock, title: "Link sudah kedaluwarsa", body: "Masa berlaku link ini sudah habis. Silakan minta link pembayaran baru ke kasir." },
  }[state];
  const Icon = content.icon;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
        <Icon className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold">{content.title}</p>
        <p className="text-sm text-muted-foreground">{content.body}</p>
      </CardContent>
    </Card>
  );
}
