import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router-compat";
import { pmbCreateDocumentUpload, pmbDaftar, pmbOptions } from "@/server/pmb";
import {
  pmbCreatePayment,
  pmbGetStatus,
  type PmbPaymentResult,
  type PmbRegistrationStatusResult,
} from "@/server/pmbPayment";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection } from "@/components/shared/FormSection";
import { AlertCircle, CheckCircle2, Clock3, CreditCard, FileCheck2, RefreshCw, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Departemen { id: string; nama: string; kode: string | null }
interface Angkatan { id: string; nama: string; departemen_id: string | null }
interface TahunAjaran { id: string; nama: string; aktif: boolean | null }

type PmbDocumentKind = "kk" | "akta" | "rapor" | "ijazah";
type PmbDocuments = Record<PmbDocumentKind, File | null>;

const PEKERJAAN_OPTIONS = ["PNS", "TNI/Polri", "Wiraswasta", "Karyawan Swasta", "Petani", "Nelayan", "Buruh", "Guru/Dosen", "Dokter", "Lainnya"];
const STORAGE_KEY = "hat_pmb_registration_token";
const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

const initialForm = {
  nama: "", jenis_kelamin: "L", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "",
  departemen_id: "", angkatan_id: "", tahun_ajaran_id: "", jenis_pendaftaran: "baru", kelas_terakhir: "", alasan_pindah: "",
  nik: "", no_kk: "", kategori: "", anak_ke: "", jumlah_bersaudara: "", tinggi_badan_cm: "", berat_badan_kg: "",
  lingkar_kepala_cm: "", ukuran_baju: "", penyakit_pernah_diderita: "", jarak_rumah_km: "", waktu_perjalanan_menit: "", transportasi: "",
  nama_ayah: "", nik_ayah: "", tempat_lahir_ayah: "", tanggal_lahir_ayah: "", pendidikan_ayah: "", pekerjaan_ayah: "", penghasilan_ayah: "", telepon_ayah: "", alamat_ayah: "",
  nama_ibu: "", nik_ibu: "", tempat_lahir_ibu: "", tanggal_lahir_ibu: "", pendidikan_ibu: "", pekerjaan_ibu: "", penghasilan_ibu: "", telepon_ibu: "", alamat_ibu: "",
  asal_sekolah: "", alamat_sekolah_asal: "", kabupaten_sekolah_asal: "", kecamatan_sekolah_asal: "", kelurahan_sekolah_asal: "",
  kemampuan_iqro: "", membaca_latin: "", menulis_latin: "", hafalan_quran: "",
};

function emptyDocuments(): PmbDocuments {
  return { kk: null, akta: null, rapor: null, ijazah: null };
}

function labelStatusPendaftaran(status: string): string {
  if (status === "calon") return "Menunggu verifikasi sekolah";
  if (status === "diterima") return "Diterima";
  if (status === "aktif") return "Aktif sebagai siswa";
  return status || "Terdaftar";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function DocumentPicker({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const handleFile = (file: File | null) => {
    if (!file) {
      onChange(null);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) {
      toast.error(`${label}: file harus PDF, JPG, JPEG, atau PNG`);
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      toast.error(`${label}: ukuran file maksimal 10 MB`);
      return;
    }
    onChange(file);
  };

  return (
    <div className="rounded-lg border bg-white/70 p-4 space-y-3">
      <div>
        <Label>{label}{required ? " *" : ""}</Label>
        <p className="text-xs text-muted-foreground mt-1">PDF/JPG/PNG, maksimal 10 MB{required ? " · wajib" : " · opsional"}</p>
      </div>
      <Input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        required={required && !value}
        onChange={(e) => handleFile(e.target.files?.[0] || null)}
      />
      {value && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <FileCheck2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{value.name}</span>
          <span className="ml-auto shrink-0 text-xs">{(value.size / 1024 / 1024).toFixed(1)} MB</span>
        </div>
      )}
    </div>
  );
}

export default function PMBDaftarOnline() {
  const [departemenList, setDepartemenList] = useState<Departemen[]>([]);
  const [allAngkatan, setAllAngkatan] = useState<Angkatan[]>([]);
  const [tahunAjaranList, setTahunAjaranList] = useState<TahunAjaran[]>([]);
  const [form, setForm] = useState({ ...initialForm });
  const [documents, setDocuments] = useState<PmbDocuments>(() => emptyDocuments());
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [registration, setRegistration] = useState<{ siswa_id: string; payment_token: string } | null>(null);
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<PmbRegistrationStatusResult | null>(null);
  const [payment, setPayment] = useState<PmbPaymentResult | null>(null);

  useEffect(() => {
    pmbOptions()
      .then((d) => {
        setDepartemenList(d.departemen || []);
        setAllAngkatan(d.angkatan || []);
        setTahunAjaranList(d.tahun_ajaran || []);
        const aktif = (d.tahun_ajaran || []).find((t) => t.aktif);
        if (aktif) setForm((f) => ({ ...f, tahun_ajaran_id: f.tahun_ajaran_id || aktif.id }));
      })
      .catch(() => undefined);
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

  const angkatanList = useMemo(
    () => allAngkatan.filter((a) => !form.departemen_id || a.departemen_id === form.departemen_id),
    [allAngkatan, form.departemen_id],
  );
  const set = (key: keyof typeof initialForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

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

  async function uploadDocument(kind: PmbDocumentKind, file: File | null): Promise<string | undefined> {
    if (!file) return undefined;
    const signed = await pmbCreateDocumentUpload({ data: { kind, file_name: file.name } });
    const { error } = await supabase.storage
      .from(PMB_DOCUMENT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Gagal mengunggah ${file.name}: ${error.message}`);
    return signed.path;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nama.trim() || !form.departemen_id) {
      toast.error("Nama dan lembaga wajib diisi");
      return;
    }
    if (!documents.kk || !documents.akta) {
      toast.error("Kartu Keluarga dan Akta Kelahiran wajib diupload");
      return;
    }

    setLoading(true);
    try {
      const [dokumenKk, dokumenAkta, dokumenRapor, dokumenIjazah] = await Promise.all([
        uploadDocument("kk", documents.kk),
        uploadDocument("akta", documents.akta),
        uploadDocument("rapor", documents.rapor),
        uploadDocument("ijazah", documents.ijazah),
      ]);

      const r = await pmbDaftar({
        data: {
          ...form,
          telepon_ortu: form.telepon_ayah || form.telepon_ibu,
          alamat_ortu: form.alamat_ayah || form.alamat_ibu,
          dokumen_kk_path: dokumenKk,
          dokumen_akta_path: dokumenAkta,
          dokumen_rapor_path: dokumenRapor,
          dokumen_ijazah_path: dokumenIjazah,
        },
      });
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
    setDocuments(emptyDocuments());
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

  const showAsalTambahan = form.jenis_pendaftaran !== "baru";

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 font-bold text-white text-xl shadow-lg">J</div>
          <h1 className="text-2xl font-bold text-emerald-800">Pendaftaran Siswa Baru</h1>
          <p className="mt-1 text-sm text-emerald-600/80">Hijrah At-Tauhid — Sistem Manajemen Sekolah Islam</p>
        </div>

        <Card className="shadow-lg border-emerald-200">
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">Lengkapi data calon siswa dan unggah dokumen persyaratan. Setelah pendaftaran berhasil, uang pendaftaran dapat dibayar online.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-6">
              <FormSection title="Jenis Pendaftaran" description="Pilih lembaga, periode, dan jenis pendaftaran siswa">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Jenis Pendaftaran *</Label>
                    <Select value={form.jenis_pendaftaran} onValueChange={(v) => setForm((f) => ({ ...f, jenis_pendaftaran: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="baru">Siswa Baru</SelectItem>
                        <SelectItem value="pindahan">Siswa Pindahan</SelectItem>
                        <SelectItem value="alumni_internal">Alumni Internal (Naik Jenjang)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Lembaga/Sekolah *</Label>
                    <Select value={form.departemen_id} onValueChange={(v) => setForm((f) => ({ ...f, departemen_id: v, angkatan_id: "" }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger>
                      <SelectContent>{departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Periode Tahun Ajaran</Label>
                    <Select value={form.tahun_ajaran_id} onValueChange={(v) => setForm((f) => ({ ...f, tahun_ajaran_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                      <SelectContent>{tahunAjaranList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}{t.aktif ? " (Aktif)" : ""}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Angkatan</Label>
                    <Select disabled={!form.departemen_id} value={form.angkatan_id} onValueChange={(v) => setForm((f) => ({ ...f, angkatan_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger>
                      <SelectContent>{angkatanList.map((a) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </FormSection>

              <FormSection title="Data Diri Siswa" description="Informasi identitas dan kondisi calon siswa">
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>NIK</Label><Input value={form.nik} onChange={set("nik")} inputMode="numeric" maxLength={32} /></div>
                  <div><Label>No. KK</Label><Input value={form.no_kk} onChange={set("no_kk")} inputMode="numeric" maxLength={32} /></div>
                  <div><Label>Kategori</Label><Input value={form.kategori} onChange={set("kategori")} placeholder="Isi kategori bila ada" /></div>
                </div>
                <div><Label>Nama Lengkap *</Label><Input required value={form.nama} onChange={set("nama")} /></div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Jenis Kelamin</Label>
                    <Select value={form.jenis_kelamin} onValueChange={(v) => setForm((f) => ({ ...f, jenis_kelamin: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="L">Laki-laki</SelectItem><SelectItem value="P">Perempuan</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div><Label>No. HP Pendaftar</Label><Input value={form.telepon} onChange={set("telepon")} placeholder="08xxxxxxxxxx" inputMode="tel" /></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Anak ke</Label><Input type="number" min="0" value={form.anak_ke} onChange={set("anak_ke")} /></div>
                  <div><Label>Dari Bersaudara</Label><Input type="number" min="0" value={form.jumlah_bersaudara} onChange={set("jumlah_bersaudara")} /></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><Label>Tinggi Badan (cm)</Label><Input type="number" min="0" step="0.1" value={form.tinggi_badan_cm} onChange={set("tinggi_badan_cm")} /></div>
                  <div><Label>Berat Badan (kg)</Label><Input type="number" min="0" step="0.1" value={form.berat_badan_kg} onChange={set("berat_badan_kg")} /></div>
                  <div><Label>Lingkar Kepala (cm)</Label><Input type="number" min="0" step="0.1" value={form.lingkar_kepala_cm} onChange={set("lingkar_kepala_cm")} /></div>
                  <div><Label>Ukuran Baju</Label><Input value={form.ukuran_baju} onChange={set("ukuran_baju")} /></div>
                </div>
                <div><Label>Penyakit yang Pernah Diderita</Label><Textarea value={form.penyakit_pernah_diderita} onChange={set("penyakit_pernah_diderita")} placeholder="Kosongkan jika tidak ada" /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Jarak Rumah ke Sekolah (km)</Label><Input type="number" min="0" step="0.1" value={form.jarak_rumah_km} onChange={set("jarak_rumah_km")} /></div>
                  <div><Label>Waktu Perjalanan (menit)</Label><Input type="number" min="0" value={form.waktu_perjalanan_menit} onChange={set("waktu_perjalanan_menit")} /></div>
                  <div><Label>Transportasi yang Digunakan</Label><Input value={form.transportasi} onChange={set("transportasi")} /></div>
                </div>
                <div><Label>Alamat Rumah</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
              </FormSection>

              <FormSection title="Data Ayah" description="Informasi ayah calon siswa">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ayah</Label><Input value={form.nik_ayah} onChange={set("nik_ayah")} inputMode="numeric" /></div>
                  <div><Label>Nama Ayah</Label><Input value={form.nama_ayah} onChange={set("nama_ayah")} /></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir_ayah} onChange={set("tempat_lahir_ayah")} /></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir_ayah} onChange={set("tanggal_lahir_ayah")} /></div>
                  <div><Label>Pendidikan Terakhir</Label><Input value={form.pendidikan_ayah} onChange={set("pendidikan_ayah")} /></div>
                  <div>
                    <Label>Pekerjaan</Label>
                    <Select value={form.pekerjaan_ayah} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ayah: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger>
                      <SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Penghasilan (Rp)</Label><Input type="number" min="0" value={form.penghasilan_ayah} onChange={set("penghasilan_ayah")} /></div>
                  <div><Label>No. HP / WA</Label><Input value={form.telepon_ayah} onChange={set("telepon_ayah")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat</Label><Textarea value={form.alamat_ayah} onChange={set("alamat_ayah")} /></div>
              </FormSection>

              <FormSection title="Data Ibu" description="Informasi ibu calon siswa">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ibu</Label><Input value={form.nik_ibu} onChange={set("nik_ibu")} inputMode="numeric" /></div>
                  <div><Label>Nama Ibu</Label><Input value={form.nama_ibu} onChange={set("nama_ibu")} /></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir_ibu} onChange={set("tempat_lahir_ibu")} /></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir_ibu} onChange={set("tanggal_lahir_ibu")} /></div>
                  <div><Label>Pendidikan Terakhir</Label><Input value={form.pendidikan_ibu} onChange={set("pendidikan_ibu")} /></div>
                  <div>
                    <Label>Pekerjaan</Label>
                    <Select value={form.pekerjaan_ibu} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ibu: v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih pekerjaan" /></SelectTrigger>
                      <SelectContent>{PEKERJAAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Penghasilan (Rp)</Label><Input type="number" min="0" value={form.penghasilan_ibu} onChange={set("penghasilan_ibu")} /></div>
                  <div><Label>No. HP / WA</Label><Input value={form.telepon_ibu} onChange={set("telepon_ibu")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat</Label><Textarea value={form.alamat_ibu} onChange={set("alamat_ibu")} /></div>
              </FormSection>

              <FormSection title="Data Sekolah Asal" description="Diisi bila calon siswa pernah bersekolah sebelumnya">
                <div><Label>Nama Sekolah Asal</Label><Input value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div>
                <div><Label>Alamat Sekolah</Label><Textarea value={form.alamat_sekolah_asal} onChange={set("alamat_sekolah_asal")} /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Kabupaten/Kota</Label><Input value={form.kabupaten_sekolah_asal} onChange={set("kabupaten_sekolah_asal")} /></div>
                  <div><Label>Kecamatan</Label><Input value={form.kecamatan_sekolah_asal} onChange={set("kecamatan_sekolah_asal")} /></div>
                  <div><Label>Desa/Kelurahan</Label><Input value={form.kelurahan_sekolah_asal} onChange={set("kelurahan_sekolah_asal")} /></div>
                </div>
                {showAsalTambahan && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><Label>Kelas Terakhir</Label><Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} /></div>
                    {form.jenis_pendaftaran === "pindahan" && <div><Label>Alasan Pindah</Label><Textarea value={form.alasan_pindah} onChange={set("alasan_pindah")} /></div>}
                  </div>
                )}
              </FormSection>

              <FormSection title="Data Kemampuan Dasar Siswa" description="Isi sesuai kemampuan calon siswa saat ini">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Kemampuan Dasar (Iqro)</Label><Input value={form.kemampuan_iqro} onChange={set("kemampuan_iqro")} /></div>
                  <div><Label>Membaca Latin</Label><Input value={form.membaca_latin} onChange={set("membaca_latin")} /></div>
                  <div><Label>Menulis Latin</Label><Input value={form.menulis_latin} onChange={set("menulis_latin")} /></div>
                  <div><Label>Hafalan Qur&apos;an</Label><Input value={form.hafalan_quran} onChange={set("hafalan_quran")} /></div>
                </div>
              </FormSection>

              <FormSection title="Dokumen Persyaratan" description="Dokumen disimpan secara privat dan digunakan untuk verifikasi pendaftaran">
                <div className="grid gap-4 md:grid-cols-2">
                  <DocumentPicker label="Kartu Keluarga" required value={documents.kk} onChange={(file) => setDocuments((d) => ({ ...d, kk: file }))} />
                  <DocumentPicker label="Akta Kelahiran" required value={documents.akta} onChange={(file) => setDocuments((d) => ({ ...d, akta: file }))} />
                  <DocumentPicker label="Rapor" value={documents.rapor} onChange={(file) => setDocuments((d) => ({ ...d, rapor: file }))} />
                  <DocumentPicker label="Ijazah / SKHUN (bila sudah ada)" value={documents.ijazah} onChange={(file) => setDocuments((d) => ({ ...d, ijazah: file }))} />
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  <Upload className="mt-0.5 h-4 w-4 shrink-0" />
                  Kartu Keluarga dan Akta Kelahiran wajib dilampirkan. Rapor serta Ijazah/SKHUN dapat dikosongkan bila belum tersedia.
                </div>
              </FormSection>

              <Button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                <UserPlus className="h-4 w-4 mr-2" />
                {loading ? "Mengunggah dokumen & mendaftarkan..." : "Daftarkan Calon Siswa"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Sudah memiliki akun Portal Orang Tua? <Link to="/portal/login" className="text-emerald-700 underline font-medium">Login Portal Orang Tua</Link></p>
      </div>
    </div>
  );
}
