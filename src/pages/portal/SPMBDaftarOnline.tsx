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

const STORAGE_KEY = "hat_pmb_registration_token";
const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

const KATEGORI_OPTIONS = ["MURID BARU", "MURID PINDAHAN"];
const UKURAN_BAJU_OPTIONS = ["S", "M", "L", "XL", "XXL", "X3L", "X4L", "X5L"];
const TRANSPORTASI_OPTIONS = ["Mobil Pribadi", "Sepeda Motor", "Mobil/Bus Antar Jemput", "Sepeda", "Jalan Kaki", "Lainnya"];
const PENDIDIKAN_OPTIONS = [
  ["SD", "SD / Sederajat"], ["SMP", "SMP / Sederajat"], ["SMA", "SMA / Sederajat"],
  ["D3", "D3"], ["S1", "S1"], ["S2", "S2"], ["S3", "S3"],
] as const;
const PEKERJAAN_OPTIONS = ["PNS/TNI/POLRI", "KARYAWAN BUMN", "KARYAWAN SWASTA", "WIRASWASTA", "LAINNYA", "SUDAH MENINGGAL"];
const IQRO_OPTIONS = [
  ["0", "BELUM PERNAH BELAJAR IQRO"], ["1", "1"], ["2", "2"], ["3", "3"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["7", "SUDAH MENAMATKAN IQRO"],
] as const;
const LATIN_OPTIONS = ["BAIK", "CUKUP", "KURANG"];
const HAFALAN_OPTIONS = [
  ["0", "BELUM PUNYA HAFALAN"], ["1", "KURANG DARI 1/2 JUZ"],
  ["2", "1/2 - 1 JUZ"], ["3", "> 1 JUZ"],
] as const;

const initialForm = {
  nama: "", jenis_kelamin: "", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "",
  departemen_id: "", angkatan_id: "", tahun_ajaran_id: "", jenis_pendaftaran: "baru", kelas_terakhir: "", alasan_pindah: "",
  nik: "", no_kk: "", kategori: "", status_asrama: "", anak_ke: "", jumlah_bersaudara: "", tinggi_badan_cm: "", berat_badan_kg: "",
  lingkar_kepala_cm: "", ukuran_baju: "", penyakit_pernah_diderita: "", jarak_rumah_km: "", waktu_perjalanan_menit: "", transportasi: "",
  nama_ayah: "", nik_ayah: "", tempat_lahir_ayah: "", tanggal_lahir_ayah: "", pendidikan_ayah: "", pekerjaan_ayah: "", penghasilan_ayah: "", telepon_ayah: "", alamat_ayah: "",
  nama_ibu: "", nik_ibu: "", tempat_lahir_ibu: "", tanggal_lahir_ibu: "", pendidikan_ibu: "", pekerjaan_ibu: "", penghasilan_ibu: "", telepon_ibu: "", alamat_ibu: "",
  asal_sekolah: "", alamat_sekolah_asal: "", kabupaten_sekolah_asal: "", kecamatan_sekolah_asal: "", kelurahan_sekolah_asal: "",
  kemampuan_iqro: "", membaca_latin: "", menulis_latin: "", hafalan_quran: "",
};

function emptyDocuments(): PmbDocuments {
  return { kk: null, akta: null, rapor: null, ijazah: null };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function labelStatusPendaftaran(status: string): string {
  if (status === "calon") return "Menunggu verifikasi sekolah";
  if (status === "diterima") return "Diterima";
  if (status === "aktif") return "Aktif sebagai siswa";
  return status || "Terdaftar";
}

function perluPilihanAsrama(dept?: Departemen): boolean {
  if (!dept) return false;
  const kode = (dept.kode || "").trim().toUpperCase();
  const nama = dept.nama.trim().toUpperCase();
  return ["SMP", "SMA", "MTA"].includes(kode) || /(^|\s)(SMP|SMA|MTA)(\s|$)/.test(nama);
}

function OptionSelect({
  value,
  placeholder,
  options,
  onValueChange,
}: {
  value: string;
  placeholder: string;
  options: readonly (string | readonly [string, string])[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const valueOption = typeof option === "string" ? option : option[0];
          const label = typeof option === "string" ? option : option[1];
          return <SelectItem key={valueOption} value={valueOption}>{label}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

function DocumentPicker({ label, required, value, onChange }: {
  label: string;
  required?: boolean;
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const handleFile = (file: File | null) => {
    if (!file) { onChange(null); return; }
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
        <p className="mt-1 text-xs text-muted-foreground">PDF/JPG/PNG, maksimal 10 MB · {required ? "wajib" : "opsional"}</p>
      </div>
      <Input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => handleFile(e.target.files?.[0] || null)} />
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

export default function SPMBDaftarOnline() {
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
    pmbOptions().then((d) => {
      setDepartemenList(d.departemen || []);
      setAllAngkatan(d.angkatan || []);
      setTahunAjaranList(d.tahun_ajaran || []);
      const aktif = (d.tahun_ajaran || []).find((t) => t.aktif);
      if (aktif) setForm((f) => ({ ...f, tahun_ajaran_id: f.tahun_ajaran_id || aktif.id }));
    }).catch(() => toast.error("Gagal memuat pilihan SPMB"));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/pmb") {
      window.history.replaceState({}, "", `/spmb${url.search}${url.hash}`);
      url.pathname = "/spmb";
    }
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
    if (!statusToken || !currentPaymentStatus || !["pending", "processing"].includes(currentPaymentStatus)) return;
    const timer = window.setInterval(() => {
      pmbGetStatus({ data: { payment_token: statusToken } }).then(setRegistrationStatus).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [statusToken, currentPaymentStatus]);

  const selectedDept = useMemo(() => departemenList.find((d) => d.id === form.departemen_id), [departemenList, form.departemen_id]);
  const wajibAsrama = useMemo(() => perluPilihanAsrama(selectedDept), [selectedDept]);
  const angkatanList = useMemo(
    () => allAngkatan.filter((a) => !form.departemen_id || a.departemen_id === form.departemen_id),
    [allAngkatan, form.departemen_id],
  );
  const set = (key: keyof typeof initialForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function refreshStatus(token = statusToken) {
    if (!token) return;
    setStatusLoading(true);
    try { setRegistrationStatus(await pmbGetStatus({ data: { payment_token: token } })); }
    catch (err: unknown) { toast.error(errorMessage(err, "Gagal memuat status pendaftaran")); }
    finally { setStatusLoading(false); }
  }

  async function uploadDocument(kind: PmbDocumentKind, file: File | null): Promise<string | undefined> {
    if (!file) return undefined;
    const signed = await pmbCreateDocumentUpload({ data: { kind, file_name: file.name } });
    const { error } = await supabase.storage.from(PMB_DOCUMENT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Gagal mengunggah ${file.name}: ${error.message}`);
    return signed.path;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const requiredValues = [
      form.departemen_id, form.tahun_ajaran_id, form.nik, form.no_kk, form.kategori, form.nama,
      form.jenis_kelamin, form.tempat_lahir, form.tanggal_lahir, form.anak_ke, form.jumlah_bersaudara,
      form.tinggi_badan_cm, form.berat_badan_kg, form.lingkar_kepala_cm, form.ukuran_baju,
      form.jarak_rumah_km, form.waktu_perjalanan_menit, form.transportasi,
      form.kemampuan_iqro, form.membaca_latin, form.menulis_latin, form.hafalan_quran,
    ];
    if (requiredValues.some((v) => !String(v).trim())) {
      toast.error("Lengkapi seluruh data wajib bertanda *");
      return;
    }
    if (wajibAsrama && !form.status_asrama) {
      toast.error("Pilihan Asrama / Non Asrama wajib dipilih untuk SMP, SMA, atau MTA");
      return;
    }
    if (!documents.kk || !documents.akta) {
      toast.error("Kartu Keluarga dan Akta Kelahiran wajib diupload");
      return;
    }

    setLoading(true);
    try {
      const [dokumenKk, dokumenAkta, dokumenRapor, dokumenIjazah] = await Promise.all([
        uploadDocument("kk", documents.kk), uploadDocument("akta", documents.akta),
        uploadDocument("rapor", documents.rapor), uploadDocument("ijazah", documents.ijazah),
      ]);
      const r = await pmbDaftar({ data: {
        ...form,
        status_asrama: wajibAsrama ? form.status_asrama : "",
        telepon_ortu: form.telepon_ayah || form.telepon_ibu,
        alamat_ortu: form.alamat_ayah || form.alamat_ibu,
        dokumen_kk_path: dokumenKk,
        dokumen_akta_path: dokumenAkta,
        dokumen_rapor_path: dokumenRapor,
        dokumen_ijazah_path: dokumenIjazah,
      } });
      setRegistration({ siswa_id: r.siswa_id, payment_token: r.payment_token });
      setStatusToken(r.payment_token);
      window.localStorage.setItem(STORAGE_KEY, r.payment_token);
      try { setRegistrationStatus(await pmbGetStatus({ data: { payment_token: r.payment_token } })); } catch { /* pendaftaran sudah tersimpan */ }
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
      const r = await pmbCreatePayment({ data: { payment_token: token, siswa_id: registration?.siswa_id || registrationStatus?.siswa_id } });
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
    setRegistration(null); setStatusToken(null); setRegistrationStatus(null); setPaymentReturn(null); setPayment(null);
    setForm({ ...initialForm }); setDocuments(emptyDocuments());
    window.history.replaceState({}, "", "/spmb");
  }

  if (statusLoading && statusToken && !registrationStatus && !registration) {
    return <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4"><RefreshCw className="h-10 w-10 animate-spin text-emerald-600" /></div>;
  }

  if (registrationStatus || registration) {
    const status = registrationStatus?.payment_status || "unpaid";
    const isPaid = status === "paid";
    const returnedFinishPending = paymentReturn === "finish" && status === "pending";
    const isProcessing = status === "processing" || returnedFinishPending;
    const isPending = status === "pending" && !returnedFinishPending;
    const isFailed = status === "failed" || status === "expired";
    const canPay = registrationStatus ? registrationStatus.can_pay : true;
    const totalAmount = registrationStatus?.total_amount || payment?.total_amount || null;
    const nama = registrationStatus?.nama || form.nama;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <Card className="w-full max-w-md border-emerald-200 shadow-lg">
          <CardContent className="space-y-5 pt-8 pb-8 text-center">
            {isPaid ? <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-600" /> : isFailed ? <AlertCircle className="mx-auto h-16 w-16 text-red-600" /> : <Clock3 className="mx-auto h-16 w-16 text-amber-600" />}
            <div>
              <h2 className="text-xl font-bold text-emerald-800">{isPaid ? "Pembayaran Berhasil" : isProcessing ? "Pembayaran Sedang Dikonfirmasi" : isPending ? "Menunggu Pembayaran" : isFailed ? "Pembayaran Belum Berhasil" : "Pendaftaran SPMB Berhasil"}</h2>
              <p className="mt-2 text-sm text-muted-foreground">Data calon murid <strong>{nama}</strong> sudah tersimpan.</p>
            </div>
            {registrationStatus && (
              <div className="space-y-2 rounded-lg border bg-white/70 p-4 text-left text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Calon murid</span><strong>{registrationStatus.nama}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lembaga</span><strong>{registrationStatus.departemen_nama || "-"}</strong></div>
                {totalAmount !== null && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Nominal</span><strong>Rp {Number(totalAmount).toLocaleString("id-ID")}</strong></div>}
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pendaftaran</span><strong>{labelStatusPendaftaran(registrationStatus.status_pendaftaran)}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pembayaran</span><strong>{isPaid ? "Lunas" : isProcessing ? "Sedang dikonfirmasi" : isPending ? "Pending" : isFailed ? "Gagal / kedaluwarsa" : "Belum dibayar"}</strong></div>
              </div>
            )}
            {canPay && !isPaid && !isProcessing && (
              <Button onClick={mulaiBayar} disabled={checkoutLoading} className="w-full bg-emerald-600 hover:bg-emerald-700"><CreditCard className="mr-2 h-4 w-4" />{checkoutLoading ? "Menyiapkan pembayaran..." : isPending ? "Lanjutkan Pembayaran" : isFailed ? "Coba Bayar Lagi" : "Bayar Uang Pendaftaran"}</Button>
            )}
            {(registrationStatus || statusToken) && <Button variant="outline" className="w-full" onClick={() => refreshStatus()} disabled={statusLoading}><RefreshCw className={`mr-2 h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />Perbarui Status</Button>}
            {isPaid && <Button variant="outline" className="w-full" onClick={clearRegistration}>Daftarkan Murid Lain</Button>}
          </CardContent>
        </Card>
      </div>
    );
  }

  const showPindahan = form.jenis_pendaftaran === "pindahan";

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg">S</div>
          <h1 className="text-2xl font-bold text-emerald-800">SPMB — Sistem Penerimaan Murid Baru</h1>
          <p className="mt-1 text-sm text-emerald-600/80">Hijrah At-Tauhid — Pendaftaran Murid Baru</p>
        </div>

        <Card className="border-emerald-200 shadow-lg">
          <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">Lengkapi data calon murid dan unggah dokumen persyaratan. Field bertanda * wajib diisi.</p></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-6">
              <FormSection title="Data Diri Murid" description="Informasi pendaftaran dan identitas calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Lembaga/Sekolah *</Label><Select value={form.departemen_id} onValueChange={(v) => setForm((f) => ({ ...f, departemen_id: v, angkatan_id: "", status_asrama: "" }))}><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger><SelectContent>{departemenList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Periode Tahun Ajaran *</Label><Select value={form.tahun_ajaran_id} onValueChange={(v) => setForm((f) => ({ ...f, tahun_ajaran_id: v }))}><SelectTrigger><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger><SelectContent>{tahunAjaranList.map((t) => <SelectItem key={t.id} value={t.id}>{t.nama}{t.aktif ? " (Aktif)" : ""}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Angkatan</Label><Select disabled={!form.departemen_id} value={form.angkatan_id} onValueChange={(v) => setForm((f) => ({ ...f, angkatan_id: v }))}><SelectTrigger><SelectValue placeholder="Pilih angkatan" /></SelectTrigger><SelectContent>{angkatanList.map((a) => <SelectItem key={a.id} value={a.id}>{a.nama}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Kategori *</Label><OptionSelect value={form.kategori} placeholder="Pilih kategori" options={KATEGORI_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, kategori: v, jenis_pendaftaran: v === "MURID PINDAHAN" ? "pindahan" : "baru" }))} /></div>
                  {wajibAsrama && <div><Label>Asrama / Non Asrama *</Label><OptionSelect value={form.status_asrama} placeholder="Pilih status" options={[["asrama", "ASRAMA"], ["non_asrama", "NON ASRAMA"]]} onValueChange={(v) => setForm((f) => ({ ...f, status_asrama: v }))} /></div>}
                  <div><Label>No. HP Pendaftar</Label><Input value={form.telepon} onChange={set("telepon")} inputMode="tel" placeholder="08xxxxxxxxxx" /></div>
                  <div><Label>NIK *</Label><Input value={form.nik} onChange={set("nik")} inputMode="numeric" minLength={10} maxLength={18} /></div>
                  <div><Label>No. KK *</Label><Input value={form.no_kk} onChange={set("no_kk")} inputMode="numeric" minLength={10} maxLength={20} /></div>
                  <div className="md:col-span-2"><Label>Nama Lengkap *</Label><Input value={form.nama} onChange={set("nama")} /></div>
                  <div><Label>Jenis Kelamin *</Label><OptionSelect value={form.jenis_kelamin} placeholder="Pilih jenis kelamin" options={[["L", "LAKI-LAKI"], ["P", "PEREMPUAN"]]} onValueChange={(v) => setForm((f) => ({ ...f, jenis_kelamin: v }))} /></div>
                  <div><Label>Tempat Lahir *</Label><Input value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div>
                  <div><Label>Tanggal Lahir *</Label><Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div>
                  <div><Label>Anak ke *</Label><Input type="number" min="1" max="99" value={form.anak_ke} onChange={set("anak_ke")} /></div>
                  <div><Label>Dari Bersaudara *</Label><Input type="number" min="1" max="99" value={form.jumlah_bersaudara} onChange={set("jumlah_bersaudara")} /></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><Label>Tinggi Badan (cm) *</Label><Input type="number" min="0" value={form.tinggi_badan_cm} onChange={set("tinggi_badan_cm")} /></div>
                  <div><Label>Berat Badan (kg) *</Label><Input type="number" min="0" value={form.berat_badan_kg} onChange={set("berat_badan_kg")} /></div>
                  <div><Label>Lingkar Kepala (cm) *</Label><Input type="number" min="0" value={form.lingkar_kepala_cm} onChange={set("lingkar_kepala_cm")} /></div>
                  <div><Label>Ukuran Baju *</Label><OptionSelect value={form.ukuran_baju} placeholder="Pilih ukuran" options={UKURAN_BAJU_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, ukuran_baju: v }))} /></div>
                </div>
                <div><Label>Penyakit yang Pernah Diderita</Label><Input value={form.penyakit_pernah_diderita} onChange={set("penyakit_pernah_diderita")} placeholder="Kosongkan jika tidak ada" /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Jarak Rumah ke Sekolah (km) *</Label><Input type="number" min="0" value={form.jarak_rumah_km} onChange={set("jarak_rumah_km")} /></div>
                  <div><Label>Waktu Perjalanan (menit) *</Label><Input type="number" min="0" value={form.waktu_perjalanan_menit} onChange={set("waktu_perjalanan_menit")} /></div>
                  <div><Label>Transportasi yang Digunakan *</Label><OptionSelect value={form.transportasi} placeholder="Pilih transportasi" options={TRANSPORTASI_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, transportasi: v }))} /></div>
                </div>
                <div><Label>Alamat Rumah</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
              </FormSection>

              <FormSection title="Data Ayah" description="Informasi ayah calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ayah</Label><Input value={form.nik_ayah} onChange={set("nik_ayah")} inputMode="numeric" /></div>
                  <div><Label>Nama Ayah</Label><Input value={form.nama_ayah} onChange={set("nama_ayah")} /></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir_ayah} onChange={set("tempat_lahir_ayah")} /></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir_ayah} onChange={set("tanggal_lahir_ayah")} /></div>
                  <div><Label>Pendidikan Terakhir</Label><OptionSelect value={form.pendidikan_ayah} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, pendidikan_ayah: v }))} /></div>
                  <div><Label>Pekerjaan</Label><OptionSelect value={form.pekerjaan_ayah} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ayah: v }))} /></div>
                  <div><Label>Penghasilan (Rp)</Label><Input type="number" min="0" value={form.penghasilan_ayah} onChange={set("penghasilan_ayah")} /></div>
                  <div><Label>No. HP / WA</Label><Input value={form.telepon_ayah} onChange={set("telepon_ayah")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat</Label><Textarea value={form.alamat_ayah} onChange={set("alamat_ayah")} /></div>
              </FormSection>

              <FormSection title="Data Ibu" description="Informasi ibu calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ibu</Label><Input value={form.nik_ibu} onChange={set("nik_ibu")} inputMode="numeric" /></div>
                  <div><Label>Nama Ibu</Label><Input value={form.nama_ibu} onChange={set("nama_ibu")} /></div>
                  <div><Label>Tempat Lahir</Label><Input value={form.tempat_lahir_ibu} onChange={set("tempat_lahir_ibu")} /></div>
                  <div><Label>Tanggal Lahir</Label><Input type="date" value={form.tanggal_lahir_ibu} onChange={set("tanggal_lahir_ibu")} /></div>
                  <div><Label>Pendidikan Terakhir</Label><OptionSelect value={form.pendidikan_ibu} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, pendidikan_ibu: v }))} /></div>
                  <div><Label>Pekerjaan</Label><OptionSelect value={form.pekerjaan_ibu} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, pekerjaan_ibu: v }))} /></div>
                  <div><Label>Penghasilan (Rp)</Label><Input type="number" min="0" value={form.penghasilan_ibu} onChange={set("penghasilan_ibu")} /></div>
                  <div><Label>No. HP / WA</Label><Input value={form.telepon_ibu} onChange={set("telepon_ibu")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat</Label><Textarea value={form.alamat_ibu} onChange={set("alamat_ibu")} /></div>
              </FormSection>

              <FormSection title="Data Sekolah Asal" description="Diisi bila calon murid pernah bersekolah sebelumnya">
                <div><Label>Nama Sekolah Asal</Label><Input value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div>
                <div><Label>Alamat Sekolah</Label><Input value={form.alamat_sekolah_asal} onChange={set("alamat_sekolah_asal")} /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Kabupaten/Kota</Label><Input value={form.kabupaten_sekolah_asal} onChange={set("kabupaten_sekolah_asal")} /></div>
                  <div><Label>Kecamatan</Label><Input value={form.kecamatan_sekolah_asal} onChange={set("kecamatan_sekolah_asal")} /></div>
                  <div><Label>Desa/Kelurahan</Label><Input value={form.kelurahan_sekolah_asal} onChange={set("kelurahan_sekolah_asal")} /></div>
                </div>
                {showPindahan && <div className="grid gap-4 md:grid-cols-2"><div><Label>Kelas Terakhir</Label><Input value={form.kelas_terakhir} onChange={set("kelas_terakhir")} /></div><div><Label>Alasan Pindah</Label><Textarea value={form.alasan_pindah} onChange={set("alasan_pindah")} /></div></div>}
              </FormSection>

              <FormSection title="Data Kemampuan Dasar Murid" description="Pilih sesuai kemampuan calon murid saat ini">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Kemampuan Dasar (Iqro) *</Label><OptionSelect value={form.kemampuan_iqro} placeholder="Pilih kemampuan" options={IQRO_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, kemampuan_iqro: v }))} /></div>
                  <div><Label>Membaca Latin *</Label><OptionSelect value={form.membaca_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, membaca_latin: v }))} /></div>
                  <div><Label>Menulis Latin *</Label><OptionSelect value={form.menulis_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, menulis_latin: v }))} /></div>
                  <div><Label>Hafalan Qur&apos;an *</Label><OptionSelect value={form.hafalan_quran} placeholder="Pilih hafalan" options={HAFALAN_OPTIONS} onValueChange={(v) => setForm((f) => ({ ...f, hafalan_quran: v }))} /></div>
                </div>
              </FormSection>

              <FormSection title="Dokumen Persyaratan" description="Dokumen disimpan privat untuk verifikasi SPMB">
                <div className="grid gap-4 md:grid-cols-2">
                  <DocumentPicker label="Kartu Keluarga" required value={documents.kk} onChange={(file) => setDocuments((d) => ({ ...d, kk: file }))} />
                  <DocumentPicker label="Akta Kelahiran" required value={documents.akta} onChange={(file) => setDocuments((d) => ({ ...d, akta: file }))} />
                  <DocumentPicker label="Rapor" value={documents.rapor} onChange={(file) => setDocuments((d) => ({ ...d, rapor: file }))} />
                  <DocumentPicker label="Ijazah / SKHUN (bila sudah ada)" value={documents.ijazah} onChange={(file) => setDocuments((d) => ({ ...d, ijazah: file }))} />
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><Upload className="mt-0.5 h-4 w-4 shrink-0" />Kartu Keluarga dan Akta Kelahiran wajib dilampirkan. Rapor dan Ijazah/SKHUN opsional.</div>
              </FormSection>

              <Button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700"><UserPlus className="mr-2 h-4 w-4" />{loading ? "Mengunggah dokumen & mendaftarkan..." : "Daftarkan Calon Murid"}</Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Sudah memiliki akun Portal Orang Tua? <Link to="/portal/login" className="font-medium text-emerald-700 underline">Login Portal Orang Tua</Link></p>
      </div>
    </div>
  );
}
