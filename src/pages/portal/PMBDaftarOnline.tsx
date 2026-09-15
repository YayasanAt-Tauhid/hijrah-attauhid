import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router-compat";
import { pmbDaftar, pmbOptions } from "@/server/pmb";
import {
  pmbCreatePayment,
  pmbGetStatus,
  type PmbPaymentResult,
  type PmbRegistrationStatusResult,
} from "@/server/pmbPayment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/FormSection";
import { AlertCircle, CheckCircle2, Clock3, CreditCard, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Departemen { id: string; nama: string; kode: string | null }
interface Angkatan { id: string; nama: string; departemen_id: string | null }
const PEKERJAAN_OPTIONS = ["PNS", "TNI/Polri", "Wiraswasta", "Karyawan Swasta", "Petani", "Nelayan", "Buruh", "Guru/Dosen", "Dokter", "Lainnya"];
const STORAGE_KEY = "hat_pmb_registration_token";
const initialForm = {
  nama: "", jenis_kelamin: "L", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "",
  departemen_id: "", angkatan_id: "", jenis_pendaftaran: "baru", asal_sekolah: "", kelas_terakhir: "", alasan_pindah: "",
  nama_ayah: "", nama_ibu: "", pekerjaan_ayah: "", pekerjaan_ibu: "", telepon_ortu: "", alamat_ortu: "",
};

function labelStatusPendaftaran(status: string): string {
  if (status === "calon") return "Menunggu verifikasi sekolah";
  if (status === "diterima") return "Diterima";
  if (status === "aktif") return "Aktif sebagai siswa";
  return status || "Terdaftar";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function PMBDaftarOnline() {
  const [departemenList, setDepartemenList] = useState<Departemen[]>([]);
  const [allAngkatan, setAllAngkatan] = useState<Angkatan[]>([]);
  const [form, setForm] = useState({ ...initialForm });
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [registration, setRegistration] = useState<{ siswa_id: string; payment_token: string } | null>(null);
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<PmbRegistrationStatusResult | null>(null);
  const [payment, setPayment] = useState<PmbPaymentResult | null>(null);

  useEffect(() => {
    pmbOptions().then((d) => { setDepartemenList(d.departemen || []); setAllAngkatan(d.angkatan || []); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callbackToken = url.searchParams.get("registration");
    const callbackPayment = url.searchParams.get("payment");
    const storedToken = window.localStorage.getItem(STORAGE_KEY);
    setPaymentReturn(callbackPayment);
    const token = callbackToken || storedToken;

    if (callbackToken) {
      window.localStorage.setItem(STORAGE_KEY, callbackToken);
      // Token callback cukup dipakai sekali. Hapus dari address bar agar tidak
      // mudah ikut tersalin ke screenshot, history sharing, atau referrer.
      url.searchParams.delete("registration");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    if (!token) return;
    setStatusToken(token);
    setStatusLoading(true);
    pmbGetStatus({ data: { payment_token: token } })
      .then(setRegistrationStatus)
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        setStatusToken(null);
      })
      .finally(() => setStatusLoading(false));
  }, []);

  const currentPaymentStatus = registrationStatus?.payment_status;
  useEffect(() => {
    if (!statusToken || !currentPaymentStatus) return;
    if (!["pending", "processing"].includes(currentPaymentStatus)) return;

    const timer = window.setInterval(() => {
      pmbGetStatus({ data: { payment_token: statusToken } })
        .then(setRegistrationStatus)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [statusToken, currentPaymentStatus]);

  const angkatanList = useMemo(() => allAngkatan.filter((a) => !form.departemen_id || a.departemen_id === form.departemen_id), [allAngkatan, form.departemen_id]);
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function refreshStatus(token = statusToken) {
    if (!token) return;
    setStatusLoading(true);
    try {
      const next = await pmbGetStatus({ data: { payment_token: token } });
      setRegistrationStatus(next);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Gagal memuat status pendaftaran"));
    } finally {
      setStatusLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nama.trim() || !form.departemen_id) { toast.error("Nama dan lembaga wajib diisi"); return; }
    setLoading(true);
    try {
      const r = await pmbDaftar({ data: form });
      const nextRegistration = { siswa_id: r.siswa_id, payment_token: r.payment_token };
      setRegistration(nextRegistration);
      setStatusToken(r.payment_token);
      window.localStorage.setItem(STORAGE_KEY, r.payment_token);
      try {
        const nextStatus = await pmbGetStatus({ data: { payment_token: r.payment_token } });
        setRegistrationStatus(nextStatus);
      } catch {
        // Pendaftaran sudah berhasil walaupun status gagal dimuat sesaat.
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Gagal mendaftar"));
    } finally {
      setLoading(false);
    }
  }

  async function mulaiBayar() {
    const token = registration?.payment_token || statusToken;
    if (!token) return;
    setCheckoutLoading(true);
    try {
      const r = await pmbCreatePayment({
        data: {
          payment_token: token,
          siswa_id: registration?.siswa_id || registrationStatus?.siswa_id,
        },
      });
      setPayment(r);
      window.localStorage.setItem(STORAGE_KEY, token);
      window.location.assign(r.redirect_url);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Gagal membuat pembayaran"));
      await refreshStatus(token);
    } finally {
      setCheckoutLoading(false);
    }
  }

  function clearRegistration() {
    window.localStorage.removeItem(STORAGE_KEY);
    setRegistration(null);
    setStatusToken(null);
    setRegistrationStatus(null);
    setPaymentReturn(null);
    setPayment(null);
    setForm({ ...initialForm });
    window.history.replaceState({}, "", "/pmb");
  }

  if (statusLoading && statusToken && !registrationStatus && !registration) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <Card className="w-full max-w-md border-emerald-200 shadow-lg">
          <CardContent className="py-10 text-center space-y-3">
            <RefreshCw className="h-10 w-10 animate-spin text-emerald-600 mx-auto" />
            <h2 className="font-semibold text-lg">Memuat status pendaftaran</h2>
            <p className="text-sm text-muted-foreground">Mohon jangan melakukan pendaftaran ulang.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (registrationStatus || registration) {
    const status = registrationStatus?.payment_status || "unpaid";
    const nama = registrationStatus?.nama || form.nama;
    const isPaid = status === "paid";
    const returnedFinishPending = paymentReturn === "finish" && status === "pending";
    const isProcessing = status === "processing" || returnedFinishPending;
    const isPending = status === "pending" && !returnedFinishPending;
    const isFailed = status === "failed" || status === "expired";
    const canPay = registrationStatus ? registrationStatus.can_pay : true;
    const totalAmount = registrationStatus?.total_amount || payment?.total_amount || null;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <Card className="w-full max-w-md border-emerald-200 shadow-lg">
          <CardContent className="pt-8 pb-8 space-y-5 text-center">
            {isPaid ? (
              <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />
            ) : isProcessing || isPending ? (
              <Clock3 className="h-16 w-16 text-amber-600 mx-auto" />
            ) : isFailed ? (
              <AlertCircle className="h-16 w-16 text-red-600 mx-auto" />
            ) : (
              <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />
            )}

            <div>
              <h2 className="text-xl font-bold text-emerald-800">
                {isPaid
                  ? "Pembayaran Berhasil"
                  : isProcessing
                    ? "Pembayaran Sedang Dikonfirmasi"
                    : isPending
                      ? "Menunggu Pembayaran"
                      : isFailed
                        ? "Pembayaran Belum Berhasil"
                        : "Pendaftaran Berhasil"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Data calon siswa <strong>{nama}</strong> sudah tersimpan.
                {isPaid && " Pembayaran sudah tercatat. Anda tidak perlu mendaftar ulang."}
                {isProcessing && " Midtrans sudah mengirim konfirmasi; sistem sedang menyelesaikan pencatatan pembayaran dan jurnal. Jangan membayar ulang."}
                {isPending && " Transaksi masih dapat dilanjutkan. Jangan membuat pendaftaran baru untuk siswa yang sama."}
                {isFailed && " Pendaftaran tetap tersimpan. Anda cukup mencoba pembayaran lagi, bukan mendaftar ulang."}
              </p>
            </div>

            {registrationStatus && (
              <div className="rounded-lg border bg-white/70 p-4 text-left text-sm space-y-2">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Calon siswa</span><strong className="text-right">{registrationStatus.nama}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lembaga</span><strong className="text-right">{registrationStatus.departemen_nama || "-"}</strong></div>
                {registrationStatus.jenis_nama && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pembayaran</span><strong className="text-right">{registrationStatus.jenis_nama}</strong></div>}
                {totalAmount !== null && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Nominal</span><strong>Rp {Number(totalAmount).toLocaleString("id-ID")}</strong></div>}
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pendaftaran</span><strong className="text-right">{labelStatusPendaftaran(registrationStatus.status_pendaftaran)}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pembayaran</span><strong className="text-right">{isPaid ? "Lunas" : isProcessing ? "Sedang dikonfirmasi" : isPending ? "Pending" : isFailed ? (status === "expired" ? "Kedaluwarsa" : "Gagal") : "Belum dibayar"}</strong></div>
              </div>
            )}

            {!registrationStatus && payment && (
              <div className="rounded-lg bg-muted p-3 text-sm">{payment.jenis_nama}: <strong>Rp {payment.total_amount.toLocaleString("id-ID")}</strong></div>
            )}

            {canPay && !isPaid && !isProcessing && (
              <Button onClick={mulaiBayar} disabled={checkoutLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                <CreditCard className="h-4 w-4 mr-2" />
                {checkoutLoading
                  ? "Menyiapkan pembayaran..."
                  : isPending
                    ? "Lanjutkan Pembayaran"
                    : isFailed
                      ? "Coba Bayar Lagi"
                      : "Bayar Uang Pendaftaran"}
              </Button>
            )}

            {!canPay && !isPaid && !isProcessing && !isPending && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                Pembayaran online belum dapat dilakukan. Pendaftaran tetap tersimpan; silakan hubungi sekolah jika kondisi ini berlanjut.
              </div>
            )}

            {(registrationStatus || statusToken) && (
              <Button variant="outline" className="w-full" onClick={() => refreshStatus()} disabled={statusLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${statusLoading ? "animate-spin" : ""}`} />
                Perbarui Status
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              Status "Lunas" hanya ditampilkan setelah pembayaran benar-benar tercatat di sistem sekolah. Konfirmasi gateway yang masih diproses tidak akan meminta Anda membayar ulang.
            </p>

            {isPaid && (
              <Button variant="outline" className="w-full" onClick={clearRegistration}>Daftarkan Siswa Lain</Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const showAsal = form.jenis_pendaftaran !== "baru";
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8"><div className="mx-auto max-w-2xl">
      <div className="mb-6 text-center"><div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 font-bold text-white text-xl shadow-lg">J</div><h1 className="text-2xl font-bold text-emerald-800">Pendaftaran Siswa Baru</h1><p className="mt-1 text-sm text-emerald-600/80">Hijrah At-Tauhid — Sistem Manajemen Sekolah Islam</p></div>
      <Card className="shadow-lg border-emerald-200"><CardHeader className="pb-2"><p className="text-sm text-muted-foreground">Lengkapi data calon siswa. Setelah pendaftaran berhasil, uang pendaftaran dapat dibayar online.</p></CardHeader><CardContent>
        <form onSubmit={submit} className="space-y-6">
          <FormSection title="Jenis Pendaftaran" description="Pilih jenis pendaftaran siswa">
            <div><Label>Jenis Pendaftaran *</Label><Select value={form.jenis_pendaftaran} onValueChange={(v) => setForm((f) => ({ ...f, jenis_pendaftaran: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="baru">Siswa Baru</SelectItem><SelectItem value="pindahan">Siswa Pindahan</SelectItem><SelectItem value="alumni_internal">Alumni Internal (Naik Jenjang)</SelectItem></SelectContent></Select></div>
            {showAsal && <><div><Label>Asal Sekolah / Jenjang</Label><Input value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div><div><Label>Kelas Terakhir</Label><Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} /></div>{form.jenis_pendaftaran === "pindahan" && <div><Label>Alasan Pindah</Label><Textarea value={form.alasan_pindah} onChange={set("alasan_pindah")} /></div>}</>}
          </FormSection>
          <FormSection title="Data Calon Siswa" description="Informasi identitas calon siswa">
            <div><Label>Nama Lengkap *</Label><Input required value={form.nama} onChange={set("nama")} /></div>
            <div className="grid grid-cols-2 gap-4"><div><Label>Jenis Kelamin</Label><Select value={form.jenis_kelamin} onValueChange={(v) => setForm((f) => ({ ...f, jenis_kelamin: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent></Select></div><div><Label>Lembaga/Sekolah *</Label><Select value={form.departemen_id} onValueChange={(v) => setForm((f) => ({ ...f, departemen_id: v, angkatan_id: "" }))}><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger><SelectContent>{departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent></Select></div></div>
            <div><Label>Angkatan</Label><Select disabled={!form.departemen_id} value={form.angkatan_id} onValueChange={(v) => setForm((f) => ({ ...f, angkatan_id: v }))}><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger><SelectContent>{angkatanList.map((a) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-4"><div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div><div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div></div>
            <div><Label>Telepon</Label><Input value={form.telepon} onChange={set("telepon")} placeholder="08xxxxxxxxxx" /></div><div><Label>Alamat</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
          </FormSection>
          <FormSection title="Data Orang Tua / Wali" description="Informasi orang tua atau wali siswa">
            <div className="grid grid-cols-2 gap-4"><div><Label>Nama Ayah</Label><Input value={form.nama_ayah} onChange={set("nama_ayah")} /></div><div><Label>Nama Ibu</Label><Input value={form.nama_ibu} onChange={set("nama_ibu")} /></div></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Pekerjaan Ayah</Label><Select value={form.pekerjaan_ayah} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ayah: v }))}><SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger><SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Pekerjaan Ibu</Label><Select value={form.pekerjaan_ibu} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ibu: v }))}><SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger><SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label>Telepon Orang Tua</Label><Input value={form.telepon_ortu} onChange={set("telepon_ortu")} placeholder="08xxxxxxxxxx" /></div><div><Label>Alamat Orang Tua</Label><Textarea value={form.alamat_ortu} onChange={set("alamat_ortu")} /></div>
          </FormSection>
          <Button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700"><UserPlus className="h-4 w-4 mr-2" />{loading ? "Mendaftarkan..." : "Daftarkan Calon Siswa"}</Button>
        </form>
      </CardContent></Card>
      <p className="mt-4 text-center text-xs text-muted-foreground">Sudah memiliki akun Portal Orang Tua? <Link to="/portal/login" className="text-emerald-700 underline font-medium">Login Portal Orang Tua</Link></p>
    </div></div>
  );
}
