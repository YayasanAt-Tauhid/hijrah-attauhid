import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router-compat";
import { pmbCreateDocumentUpload, pmbDaftar, pmbOptions } from "@/server/pmb";
import {
  pmbCreatePayment,
  pmbGetStatus,
  type PmbPaymentResult,
  type PmbRegistrationStatusResult,
} from "@/server/pmbPayment";
import { spmbGetPolicyStatus, spmbGetPublicWave, type SpmbPolicyStatusResult, type SpmbPublicWaveResult, type SpmbWaveSummary } from "@/server/spmbPolicy";
import {
  SPMB_CATEGORY_LABEL,
  SPMB_CATEGORY_VALUE,
  SPMB_TRANSFER_CATEGORY_LABEL,
  SPMB_TRANSFER_CATEGORY_VALUE,
  SPMB_TARGET_ACADEMIC_YEAR,
  SPMB_TARGET_COHORT,
} from "@/lib/spmbPolicy";
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

const LEGACY_REGISTRATION_STORAGE_KEY = "hat_pmb_registration_token";
const REGISTRATION_STORAGE_KEY = "hat_spmb_registration_token";
const DRAFT_STORAGE_KEY = "hat_spmb_form_draft_v1";
const DRAFT_VERSION = 1;
const DRAFT_TTL_MS = 4 * 60 * 60 * 1000;
const PMB_DOCUMENT_BUCKET = "pmb-dokumen";
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

const TRANSPORTASI_OPTIONS = ["Mobil Pribadi", "Sepeda Motor", "Mobil/Bus Antar Jemput", "Sepeda", "Jalan Kaki", "Lainnya"];
const PENDIDIKAN_OPTIONS = [
  ["SD", "SD / Sederajat"], ["SMP", "SMP / Sederajat"], ["SMA", "SMA / Sederajat"],
  ["D3", "D3"], ["S1", "S1"], ["S2", "S2"], ["S3", "S3"],
] as const;
const PEKERJAAN_OPTIONS = ["PNS/TNI/POLRI", "KARYAWAN BUMN", "KARYAWAN SWASTA", "WIRASWASTA", "LAINNYA", "SUDAH MENINGGAL"];
const PENGHASILAN_OPTIONS = [
  ["1000000", "< Rp 1.000.000"],
  ["2000000", "Rp 1.000.000 s.d Rp 2.000.000"],
  ["5000000", "Rp 2.000.000 s.d Rp 5.000.000"],
  ["20000000", "Rp 5.000.000 s.d Rp 20.000.000"],
  ["30000000", "> Rp 20.000.000"],
] as const;
const PENGHASILAN_VALUES = new Set(PENGHASILAN_OPTIONS.map(([value]) => value));
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
  nama: "", jenis_kelamin: "", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "", nisn: "",
  departemen_id: "", angkatan_id: "", tahun_ajaran_id: "", jenis_pendaftaran: "baru", kelas_terakhir: "", alasan_pindah: "",
  nik: "", no_kk: "", kategori: SPMB_CATEGORY_VALUE, status_asrama: "", anak_ke: "", jumlah_bersaudara: "",
  penyakit_pernah_diderita: "", jarak_rumah_km: "", waktu_perjalanan_menit: "", transportasi: "",
  nama_ayah: "", nik_ayah: "", tempat_lahir_ayah: "", tanggal_lahir_ayah: "", pendidikan_ayah: "", pekerjaan_ayah: "", penghasilan_ayah: "", telepon_ayah: "", alamat_ayah: "",
  nama_ibu: "", nik_ibu: "", tempat_lahir_ibu: "", tanggal_lahir_ibu: "", pendidikan_ibu: "", pekerjaan_ibu: "", penghasilan_ibu: "", telepon_ibu: "", alamat_ibu: "",
  asal_sekolah: "", alamat_sekolah_asal: "", kabupaten_sekolah_asal: "", kecamatan_sekolah_asal: "", kelurahan_sekolah_asal: "",
  kemampuan_iqro: "", membaca_latin: "", menulis_latin: "", hafalan_quran: "",
};

type PmbForm = typeof initialForm;

function sanitizeDraftForm(value: unknown): PmbForm | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const restored: Record<string, string> = { ...initialForm };
  for (const key of Object.keys(initialForm)) {
    const candidate = source[key];
    if (typeof candidate === "string") restored[key] = candidate;
  }
  for (const key of ["penghasilan_ayah", "penghasilan_ibu"] as const) {
    if (restored[key] && !PENGHASILAN_VALUES.has(restored[key])) restored[key] = "";
  }
  return restored as PmbForm;
}

function hasMeaningfulDraft(form: PmbForm): boolean {
  const automaticFields = new Set(["tahun_ajaran_id", "angkatan_id", "jenis_pendaftaran", "kategori", "status_asrama"]);
  return Object.entries(form).some(([key, value]) => !automaticFields.has(key) && value.trim().length > 0);
}

function readFormDraft(): PmbForm | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; saved_at?: number; form?: unknown };
    if (
      parsed.version !== DRAFT_VERSION ||
      typeof parsed.saved_at !== "number" ||
      Date.now() - parsed.saved_at > DRAFT_TTL_MS
    ) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    const restored = sanitizeDraftForm(parsed.form);
    if (!restored || !hasMeaningfulDraft(restored)) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return restored;
  } catch {
    try { window.sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* storage tidak tersedia */ }
    return null;
  }
}

function saveFormDraft(form: PmbForm) {
  try {
    if (!hasMeaningfulDraft(form)) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      version: DRAFT_VERSION,
      saved_at: Date.now(),
      form,
    }));
  } catch {
    // Pendaftaran tetap dapat digunakan walaupun storage browser diblokir.
  }
}

function clearFormDraft() {
  try { window.sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* storage tidak tersedia */ }
}

function readRegistrationToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(REGISTRATION_STORAGE_KEY);
    if (token) {
      try { window.localStorage.removeItem(LEGACY_REGISTRATION_STORAGE_KEY); } catch { /* abaikan */ }
      return token;
    }
  } catch {
    // Lanjut ke migrasi token lama bila sessionStorage tidak tersedia.
  }

  try {
    const legacyToken = window.localStorage.getItem(LEGACY_REGISTRATION_STORAGE_KEY);
    if (!legacyToken) return null;
    try { window.sessionStorage.setItem(REGISTRATION_STORAGE_KEY, legacyToken); } catch { /* abaikan */ }
    window.localStorage.removeItem(LEGACY_REGISTRATION_STORAGE_KEY);
    return legacyToken;
  } catch {
    return null;
  }
}

function storeRegistrationToken(token: string) {
  try { window.sessionStorage.setItem(REGISTRATION_STORAGE_KEY, token); } catch { /* storage tidak tersedia */ }
  try { window.localStorage.removeItem(LEGACY_REGISTRATION_STORAGE_KEY); } catch { /* abaikan */ }
}

function clearRegistrationToken() {
  try { window.sessionStorage.removeItem(REGISTRATION_STORAGE_KEY); } catch { /* abaikan */ }
  try { window.localStorage.removeItem(LEGACY_REGISTRATION_STORAGE_KEY); } catch { /* abaikan */ }
}

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

function kodeDepartemen(dept?: Departemen): string {
  if (!dept) return "";
  const kode = (dept.kode || "").trim().toUpperCase();
  if (["TK", "SD", "SMP", "SMA", "MTA"].includes(kode)) return kode;
  const match = dept.nama.trim().toUpperCase().match(/(^|\s)(TK|SD|SMP|SMA|MTA)(\s|$)/);
  return match?.[2] || "";
}

function perluPilihanAsrama(dept?: Departemen): boolean {
  return ["SMP", "SMA", "MTA"].includes(kodeDepartemen(dept));
}

function perluNisn(dept?: Departemen): boolean {
  return ["SMP", "SMA", "MTA"].includes(kodeDepartemen(dept));
}

function namaLembagaPromo(dept?: Departemen, fallback?: string | null): string {
  const kode = (dept?.kode || dept?.nama || fallback || "").trim().toUpperCase();
  const namaPerJenjang: Record<string, string> = {
    TK: "TK At-Tauhid",
    SD: "SD At-Tauhid",
    SMP: "SMP At-Tauhid",
    SMA: "SMA At-Tauhid",
    MTA: "MTA At-Tauhid",
  };
  return namaPerJenjang[kode] || fallback || dept?.nama || "At-Tauhid";
}

function formatTanggalGelombang(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function rentangGelombang(wave?: Pick<SpmbWaveSummary, "tanggal_mulai" | "tanggal_selesai"> | null): string {
  if (!wave) return "";
  const mulai = formatTanggalGelombang(wave.tanggal_mulai);
  if (!wave.tanggal_selesai) return `mulai ${mulai}`;
  const akhirEksklusif = new Date(wave.tanggal_selesai);
  akhirEksklusif.setMilliseconds(akhirEksklusif.getMilliseconds() - 1);
  const selesai = akhirEksklusif.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  return `${mulai}–${selesai}`;
}

function OptionSelect({ value, placeholder, options, onValueChange, disabled }: {
  value: string;
  placeholder: string;
  options: readonly (string | readonly [string, string])[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="min-h-11"><SelectValue placeholder={placeholder} /></SelectTrigger>
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
    <div className="space-y-3 rounded-lg border bg-white/70 p-4">
      <div>
        <Label>{label}{required ? " *" : ""}</Label>
        <p className="mt-1 text-xs text-muted-foreground">PDF/JPG/PNG, maksimal 10 MB · {required ? "wajib" : "opsional"}</p>
      </div>
      <Input className="min-h-11" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => handleFile(event.target.files?.[0] || null)} />
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

export default function SPMBDaftarOnlineV2() {
  const [departemenList, setDepartemenList] = useState<Departemen[]>([]);
  const [allAngkatan, setAllAngkatan] = useState<Angkatan[]>([]);
  const [tahunAjaranList, setTahunAjaranList] = useState<TahunAjaran[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...initialForm });
  const [documents, setDocuments] = useState<PmbDocuments>(() => emptyDocuments());
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [registration, setRegistration] = useState<{ siswa_id: string; payment_token: string } | null>(null);
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<PmbRegistrationStatusResult | null>(null);
  const [policyStatus, setPolicyStatus] = useState<SpmbPolicyStatusResult | null>(null);
  const [publicWave, setPublicWave] = useState<SpmbPublicWaveResult | null>(null);
  const [payment, setPayment] = useState<PmbPaymentResult | null>(null);

  useEffect(() => {
    const draft = readFormDraft();
    if (draft) {
      setForm(draft);
      setDraftRestored(true);
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady || registration || statusToken || loading) return;
    const timer = window.setTimeout(() => saveFormDraft(form), 400);
    return () => window.clearTimeout(timer);
  }, [draftReady, form, registration, statusToken, loading]);

  useEffect(() => {
    setOptionsLoading(true);
    Promise.all([pmbOptions(), spmbGetPublicWave()]).then(([data, wave]) => {
      setPublicWave(wave);
      const targetYears = (data.tahun_ajaran || []).filter((tahun) => tahun.nama === SPMB_TARGET_ACADEMIC_YEAR);
      const targetAngkatan = (data.angkatan || []).filter((angkatan) => angkatan.nama === SPMB_TARGET_COHORT);
      setDepartemenList(data.departemen || []);
      setAllAngkatan(targetAngkatan);
      setTahunAjaranList(targetYears);
      if (!targetYears[0]) {
        setOptionsError("Konfigurasi Tahun Ajaran 2027–2028 belum tersedia. Silakan hubungi admin sekolah.");
        return;
      }
      setOptionsError(null);
      setForm((current) => ({
        ...current,
        tahun_ajaran_id: targetYears[0].id,
        kategori: current.kategori || SPMB_CATEGORY_VALUE,
        jenis_pendaftaran: current.kategori === SPMB_TRANSFER_CATEGORY_VALUE ? "pindahan" : "baru",
      }));
    }).catch(() => {
      setOptionsError("Gagal memuat pilihan SPMB. Periksa koneksi lalu muat ulang halaman.");
    }).finally(() => setOptionsLoading(false));
  }, []);

  useEffect(() => {
    if (!form.departemen_id) return;
    const angkatan2027 = allAngkatan.find((angkatan) => angkatan.departemen_id === form.departemen_id);
    const nextAngkatanId = angkatan2027?.id || "";
    setForm((current) => current.angkatan_id === nextAngkatanId
      ? current
      : { ...current, angkatan_id: nextAngkatanId });
  }, [allAngkatan, form.departemen_id]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/pmb") {
      window.history.replaceState({}, "", `/spmb${url.search}${url.hash}`);
      url.pathname = "/spmb";
    }
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const callbackToken = url.searchParams.get("registration") || hashParams.get("registration");
    const callbackPayment = url.searchParams.get("payment");
    const storedToken = readRegistrationToken();
    setPaymentReturn(callbackPayment);
    const token = callbackToken || storedToken;

    if (callbackToken) {
      storeRegistrationToken(callbackToken);
      url.searchParams.delete("registration");
      hashParams.delete("registration");
      const cleanHash = hashParams.toString();
      url.hash = cleanHash ? `#${cleanHash}` : "";
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!token) return;

    setStatusToken(token);
    setStatusLoading(true);
    Promise.all([
      pmbGetStatus({ data: { payment_token: token } }),
      spmbGetPolicyStatus({ data: { payment_token: token } }),
    ]).then(([status, policy]) => {
      setRegistrationStatus(status);
      setPolicyStatus(policy);
    }).catch(() => {
      clearRegistrationToken();
      setStatusToken(null);
    }).finally(() => setStatusLoading(false));
  }, []);

  const currentPaymentStatus = registrationStatus?.payment_status;
  useEffect(() => {
    if (!statusToken || !currentPaymentStatus || !["pending", "processing"].includes(currentPaymentStatus)) return;
    const timer = window.setInterval(() => {
      Promise.all([
        pmbGetStatus({ data: { payment_token: statusToken } }),
        spmbGetPolicyStatus({ data: { payment_token: statusToken } }),
      ]).then(([status, policy]) => {
        setRegistrationStatus(status);
        setPolicyStatus(policy);
      }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [statusToken, currentPaymentStatus]);

  const selectedDept = useMemo(() => departemenList.find((dept) => dept.id === form.departemen_id), [departemenList, form.departemen_id]);
  const deptCode = useMemo(() => kodeDepartemen(selectedDept), [selectedDept]);
  const wajibAsrama = useMemo(() => perluPilihanAsrama(selectedDept), [selectedDept]);
  const wajibNisn = useMemo(() => perluNisn(selectedDept), [selectedDept]);
  const mtaWajibAsrama = deptCode === "MTA";
  const siswaPindahan = form.kategori === SPMB_TRANSFER_CATEGORY_VALUE;
  const registrationOpen = publicWave?.registration_open === true;
  const currentWave = publicWave?.current_wave || null;
  const nextWave = publicWave?.next_wave || null;
  const angkatanList = useMemo(() => allAngkatan.filter((angkatan) => !form.departemen_id || angkatan.departemen_id === form.departemen_id), [allAngkatan, form.departemen_id]);

  useEffect(() => {
    if (mtaWajibAsrama && form.status_asrama !== "asrama") {
      setForm((current) => ({ ...current, status_asrama: "asrama" }));
    } else if (!wajibAsrama && form.status_asrama) {
      setForm((current) => ({ ...current, status_asrama: "" }));
    }
  }, [mtaWajibAsrama, wajibAsrama, form.status_asrama]);
  const set = (key: keyof typeof initialForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function refreshStatus(token = statusToken) {
    if (!token) return;
    setStatusLoading(true);
    try {
      const [status, policy] = await Promise.all([
        pmbGetStatus({ data: { payment_token: token } }),
        spmbGetPolicyStatus({ data: { payment_token: token } }),
      ]);
      setRegistrationStatus(status);
      setPolicyStatus(policy);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Gagal memuat status pendaftaran"));
    } finally {
      setStatusLoading(false);
    }
  }

  async function uploadDocument(kind: PmbDocumentKind, file: File | null): Promise<string | undefined> {
    if (!file) return undefined;
    const signed = await pmbCreateDocumentUpload({ data: { kind, file_name: file.name } });
    const { error } = await supabase.storage.from(PMB_DOCUMENT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Gagal mengunggah ${file.name}: ${error.message}`);
    return signed.path;
  }

  function focusField(id: string) {
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    if (!registrationOpen) {
      const message = nextWave
        ? `Pendaftaran SPMB sedang ditutup. ${nextWave.nama} dibuka ${rentangGelombang(nextWave)}.`
        : "Pendaftaran SPMB sedang ditutup.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    const requiredFields: Array<{ label: string; value: string; focusId?: string }> = [
      { label: "Lembaga/Sekolah", value: form.departemen_id, focusId: "spmb-public-departemen" },
      { label: "Periode Tahun Ajaran", value: form.tahun_ajaran_id },
      { label: "Angkatan", value: form.angkatan_id, focusId: "spmb-public-angkatan" },
      { label: "NIK Calon Murid", value: form.nik, focusId: "spmb-public-nik" },
      { label: "No. KK", value: form.no_kk },
      { label: "Kategori", value: form.kategori },
      { label: "Nama Lengkap", value: form.nama, focusId: "spmb-public-nama" },
      { label: "Jenis Kelamin", value: form.jenis_kelamin },
      { label: "Tempat Lahir Murid", value: form.tempat_lahir },
      { label: "Tanggal Lahir Murid", value: form.tanggal_lahir },
      { label: "Alamat Rumah", value: form.alamat },
      { label: "No. HP / WhatsApp", value: form.telepon },
      { label: "Anak ke", value: form.anak_ke },
      { label: "Dari Bersaudara", value: form.jumlah_bersaudara },
      { label: "Jarak Rumah ke Sekolah", value: form.jarak_rumah_km },
      { label: "Waktu Perjalanan", value: form.waktu_perjalanan_menit },
      { label: "Transportasi", value: form.transportasi },
      { label: "Kemampuan Dasar (Iqro)", value: form.kemampuan_iqro },
      { label: "Membaca Latin", value: form.membaca_latin },
      { label: "Menulis Latin", value: form.menulis_latin },
      { label: "Hafalan Qur'an", value: form.hafalan_quran },
      { label: "Nama Ayah", value: form.nama_ayah },
      { label: "NIK Ayah", value: form.nik_ayah },
      { label: "Tempat Lahir Ayah", value: form.tempat_lahir_ayah },
      { label: "Tanggal Lahir Ayah", value: form.tanggal_lahir_ayah },
      { label: "Pendidikan Ayah", value: form.pendidikan_ayah },
      { label: "Pekerjaan Ayah", value: form.pekerjaan_ayah },
      { label: "Penghasilan Ayah", value: form.penghasilan_ayah },
      { label: "No. HP / WA Ayah", value: form.telepon_ayah },
      { label: "Alamat Ayah", value: form.alamat_ayah },
      { label: "Nama Ibu", value: form.nama_ibu },
      { label: "NIK Ibu", value: form.nik_ibu },
      { label: "Tempat Lahir Ibu", value: form.tempat_lahir_ibu },
      { label: "Tanggal Lahir Ibu", value: form.tanggal_lahir_ibu },
      { label: "Pendidikan Ibu", value: form.pendidikan_ibu },
      { label: "Pekerjaan Ibu", value: form.pekerjaan_ibu },
      { label: "Penghasilan Ibu", value: form.penghasilan_ibu },
      { label: "No. HP / WA Ibu", value: form.telepon_ibu },
      { label: "Alamat Ibu", value: form.alamat_ibu },
      ...(wajibNisn ? [{ label: "NISN", value: form.nisn, focusId: "spmb-public-nisn" }] : []),
    ];
    const missingRequiredFields = requiredFields.filter((field) => !String(field.value).trim());
    if (missingRequiredFields.length) {
      const shownFields = missingRequiredFields.slice(0, 5).map((field) => field.label).join(", ");
      const remaining = missingRequiredFields.length - 5;
      const message = `Lengkapi data wajib: ${shownFields}${remaining > 0 ? ` (dan ${remaining} data wajib lainnya)` : ""}.`;
      setSubmitError(message);
      toast.error(message);
      const focusId = missingRequiredFields.find((field) => field.focusId)?.focusId;
      if (focusId) focusField(focusId);
      else window.requestAnimationFrame(() => document.getElementById("spmb-submit-error")?.focus());
      return;
    }
    if (!/^\d{16}$/.test(form.nik)) {
      const message = "NIK Calon Murid harus terdiri dari tepat 16 digit.";
      setSubmitError(message);
      toast.error(message);
      focusField("spmb-public-nik");
      return;
    }
    if (wajibNisn && !/^\d{10}$/.test(form.nisn)) {
      const message = "NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA.";
      setSubmitError(message);
      toast.error(message);
      focusField("spmb-public-nisn");
      return;
    }
    if (!/^(?:\+62|62|0)[0-9]{7,16}$/.test(form.telepon.replace(/[\s-]/g, ""))) {
      const message = "Masukkan No. HP / WhatsApp yang aktif dan bisa dihubungi.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (!/^\d{16}$/.test(form.nik_ayah.replace(/\D/g, "")) || !/^\d{16}$/.test(form.nik_ibu.replace(/\D/g, ""))) {
      const message = "NIK Ayah dan NIK Ibu masing-masing harus 16 digit.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (!angkatanList.some((angkatan) => angkatan.id === form.angkatan_id)) {
      const message = "Konfigurasi Angkatan 2027 untuk lembaga yang dipilih belum tersedia. Silakan hubungi admin sekolah.";
      setSubmitError(message);
      toast.error(message);
      focusField("spmb-public-departemen");
      return;
    }
    if (wajibAsrama && !form.status_asrama) {
      const message = "Pilihan Asrama / Non Asrama wajib dipilih untuk SMP atau SMA. MTA otomatis Asrama.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (mtaWajibAsrama && form.status_asrama !== "asrama") {
      const message = "Pendaftar MTA wajib Asrama. Non Asrama hanya untuk murid lama.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (!documents.kk || !documents.akta) {
      const message = "Kartu Keluarga dan Akta Kelahiran wajib diunggah.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    if (siswaPindahan && (!documents.rapor || !documents.ijazah)) {
      const message = "Rapor dan Ijazah / SKHUN wajib diunggah untuk Siswa Pindahan.";
      setSubmitError(message);
      toast.error(message);
      return;
    }

    setLoading(true);
    try {
      const [dokumenKk, dokumenAkta, dokumenRapor, dokumenIjazah] = await Promise.all([
        uploadDocument("kk", documents.kk), uploadDocument("akta", documents.akta),
        uploadDocument("rapor", documents.rapor), uploadDocument("ijazah", documents.ijazah),
      ]);
      const result = await pmbDaftar({ data: {
        ...form,
        nama: form.nama.trim(),
        nik: form.nik,
        kategori: form.kategori,
        jenis_pendaftaran: siswaPindahan ? "pindahan" : "baru",
        status_asrama: mtaWajibAsrama ? "asrama" : wajibAsrama ? form.status_asrama : "",
        telepon_ortu: form.telepon_ayah || form.telepon_ibu,
        alamat_ortu: form.alamat_ayah || form.alamat_ibu,
        dokumen_kk_path: dokumenKk,
        dokumen_akta_path: dokumenAkta,
        dokumen_rapor_path: dokumenRapor,
        dokumen_ijazah_path: dokumenIjazah,
      } });
      clearFormDraft();
      setDraftRestored(false);
      storeRegistrationToken(result.payment_token);
      setRegistration({ siswa_id: result.siswa_id, payment_token: result.payment_token });
      setStatusToken(result.payment_token);
      try {
        const [status, policy] = await Promise.all([
          pmbGetStatus({ data: { payment_token: result.payment_token } }),
          spmbGetPolicyStatus({ data: { payment_token: result.payment_token } }),
        ]);
        setRegistrationStatus(status);
        setPolicyStatus(policy);
      } catch {
        // Pendaftaran sudah tersimpan; status dapat dimuat ulang dari token sesi.
      }
    } catch (error: unknown) {
      const message = errorMessage(error, "Gagal mendaftar");
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function mulaiBayar() {
    const token = registration?.payment_token || statusToken;
    if (!token) return;
    const promoFree = policyStatus?.gratis_pendaftaran ?? currentWave?.gratis_pendaftaran === true;
    const paymentVisible = policyStatus?.payment_visible ?? Boolean(currentWave && !currentWave.gratis_pendaftaran);
    if (promoFree) {
      toast.success("Calon murid ini berhak gratis biaya pendaftaran. Tidak ada transaksi yang perlu dibuat.");
      return;
    }
    if (!paymentVisible) {
      toast.info("Pembayaran tidak tersedia untuk gelombang pendaftaran ini.");
      return;
    }

    setCheckoutLoading(true);
    try {
      const result = await pmbCreatePayment({ data: {
        payment_token: token,
        siswa_id: registration?.siswa_id || registrationStatus?.siswa_id,
      } });
      setPayment(result);
      storeRegistrationToken(token);
      window.location.assign(result.redirect_url);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Gagal membuat pembayaran"));
      await refreshStatus(token);
    } finally {
      setCheckoutLoading(false);
    }
  }

  function clearRegistration() {
    clearRegistrationToken();
    clearFormDraft();
    setDraftRestored(false);
    setRegistration(null);
    setStatusToken(null);
    setRegistrationStatus(null);
    setPolicyStatus(null);
    setPaymentReturn(null);
    setPayment(null);
    setSubmitError(null);
    setForm({ ...initialForm, tahun_ajaran_id: tahunAjaranList[0]?.id || "" });
    setDocuments(emptyDocuments());
    window.history.replaceState({}, "", "/spmb");
  }

  if (statusLoading && statusToken && !registrationStatus && !registration) {
    return <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4"><RefreshCw className="h-10 w-10 animate-spin text-emerald-600" /></div>;
  }

  if (registrationStatus || registration) {
    const paymentVisible = policyStatus?.payment_visible ?? Boolean(currentWave && !currentWave.gratis_pendaftaran);
    const promoFree = policyStatus?.gratis_pendaftaran ?? currentWave?.gratis_pendaftaran === true;
    const status = registrationStatus?.payment_status || "unpaid";
    const isPaid = status === "paid";
    const returnedFinishPending = paymentReturn === "finish" && status === "pending";
    const isProcessing = status === "processing" || returnedFinishPending;
    const isPending = status === "pending" && !returnedFinishPending;
    const isFailed = status === "failed" || status === "expired";
    const canPay = paymentVisible && !promoFree && (registrationStatus ? registrationStatus.can_pay : true);
    const totalAmount = registrationStatus?.total_amount || payment?.total_amount || null;
    const nama = registrationStatus?.nama || form.nama;
    const lembagaPromo = namaLembagaPromo(selectedDept, registrationStatus?.departemen_nama);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
        <Card className="w-full max-w-md border-emerald-200 shadow-lg">
          <CardContent className="space-y-5 pb-8 pt-8 text-center">
            {promoFree || !paymentVisible || isPaid ? <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-600" /> : isFailed ? <AlertCircle className="mx-auto h-16 w-16 text-red-600" /> : <Clock3 className="mx-auto h-16 w-16 text-amber-600" />}
            <div>
              <h2 className="text-xl font-bold text-emerald-800">
                {promoFree || !paymentVisible
                  ? "Pendaftaran Penerimaan Murid Baru Berhasil"
                  : isPaid
                    ? "Pembayaran Berhasil"
                    : isProcessing
                      ? "Pembayaran Sedang Dikonfirmasi"
                      : isPending
                        ? "Menunggu Pembayaran"
                        : isFailed
                          ? "Pembayaran Belum Berhasil"
                          : "Pendaftaran Penerimaan Murid Baru Berhasil"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">Data calon murid <strong>{nama}</strong> sudah tersimpan sebagai calon murid dan belum menyatakan kelulusan.</p>
            </div>

            {promoFree ? (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left text-sm text-emerald-900">
                <p className="text-base font-bold">🎉 Selamat!</p>
                <p>Anda mendapatkan <strong>gratis biaya pendaftaran</strong> untuk <strong>{policyStatus?.gelombang_nama || currentWave?.nama || "gelombang pendaftaran ini"}</strong>.</p>
                {(policyStatus?.gelombang_mulai || currentWave) && (
                  <p className="font-medium">
                    📅 {policyStatus?.gelombang_mulai
                      ? rentangGelombang({
                          tanggal_mulai: policyStatus.gelombang_mulai,
                          tanggal_selesai: policyStatus.gelombang_selesai,
                        })
                      : rentangGelombang(currentWave)}
                  </p>
                )}
                <p>Tim kami akan menghubungi Anda untuk menginformasikan jadwal seleksi selanjutnya.</p>
                <p>Terima kasih telah memilih <strong>{lembagaPromo}</strong>.</p>
              </div>
            ) : !paymentVisible ? (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                <p className="font-medium">Pendaftaran berhasil tersimpan.</p>
                <p>Tim kami akan menghubungi Anda untuk menginformasikan jadwal seleksi selanjutnya.</p>
                <p>Terima kasih telah memilih <strong>{lembagaPromo}</strong>.</p>
              </div>
            ) : null}

            {registrationStatus && (
              <div className="space-y-2 rounded-lg border bg-white/70 p-4 text-left text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Calon murid</span><strong>{registrationStatus.nama}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lembaga</span><strong>{registrationStatus.departemen_nama || "-"}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Biaya Pendaftaran</span><strong>{promoFree ? "Gratis" : totalAmount !== null ? `Rp ${Number(totalAmount).toLocaleString("id-ID")}` : "Belum diatur"}</strong></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pendaftaran</span><strong>{labelStatusPendaftaran(registrationStatus.status_pendaftaran)}</strong></div>
                {paymentVisible && !promoFree && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Status pembayaran</span><strong>{isPaid ? "Lunas" : isProcessing ? "Sedang dikonfirmasi" : isPending ? "Pending" : isFailed ? "Gagal / kedaluwarsa" : "Belum dibayar"}</strong></div>}
              </div>
            )}

            {canPay && !isPaid && !isProcessing && (
              <Button onClick={mulaiBayar} disabled={checkoutLoading} className="min-h-11 w-full bg-emerald-600 hover:bg-emerald-700">
                <CreditCard className="mr-2 h-4 w-4" />{checkoutLoading ? "Menyiapkan pembayaran..." : isPending ? "Lanjutkan Pembayaran" : isFailed ? "Coba Bayar Lagi" : "Bayar Biaya Pendaftaran"}
              </Button>
            )}
            {paymentVisible && !promoFree && (registrationStatus || statusToken) && <Button variant="outline" className="min-h-11 w-full" onClick={() => refreshStatus()} disabled={statusLoading}><RefreshCw className={`mr-2 h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />Perbarui Status</Button>}
            {policyStatus?.group_calon_siswa_url && (
              <Button asChild className="min-h-11 w-full bg-emerald-700 hover:bg-emerald-800">
                <a href={policyStatus.group_calon_siswa_url} target="_blank" rel="noreferrer">Gabung Grup Calon Siswa {lembagaPromo}</a>
              </Button>
            )}
            {(promoFree || !paymentVisible || isPaid) && <Button variant="outline" className="min-h-11 w-full" onClick={clearRegistration}>Daftarkan Calon Murid Lain</Button>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 p-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg">S</div>
          <h1 className="text-2xl font-bold text-emerald-800">SPMB — Sistem Penerimaan Murid Baru</h1>
          <p className="mt-1 text-sm text-emerald-600/80">Hijrah At-Tauhid — Pendaftaran Murid Baru</p>
        </div>

        <Card className="border-emerald-200 shadow-lg">
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">Lengkapi data calon murid dan unggah dokumen persyaratan. Field bertanda * wajib diisi.</p>
            <p className="mt-1 text-xs text-muted-foreground">Isian teks disimpan sementara hanya di tab browser ini hingga 4 jam. Dokumen tidak disimpan di browser dan harus dipilih ulang setelah refresh.</p>
            <p className="mt-1 text-xs text-muted-foreground">Tinggi badan, berat badan, lingkar kepala, dan ukuran baju belum diminta pada tahap pendaftaran karena calon murid belum dinyatakan lulus.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-6" noValidate>
              {!registrationOpen && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <strong>Pendaftaran SPMB sedang ditutup.</strong>
                    {nextWave && <><br />{nextWave.nama} dibuka {rentangGelombang(nextWave)}.</>}
                  </div>
                </div>
              )}
              {registrationOpen && currentWave && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <strong>{currentWave.nama} sedang dibuka.</strong><br />
                    Periode {rentangGelombang(currentWave)} · {currentWave.gratis_pendaftaran ? "Gratis biaya pendaftaran" : "Biaya pendaftaran normal"}
                  </div>
                </div>
              )}
              {optionsError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{optionsError}</div>}
              {draftRestored && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Isian formulir sebelumnya berhasil dipulihkan. Demi keamanan, file KK, Akta, Rapor, atau Ijazah tidak disimpan di browser sehingga perlu dipilih ulang.</span>
                </div>
              )}
              {submitError && <div id="spmb-submit-error" tabIndex={-1} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 outline-none focus:ring-2 focus:ring-red-400" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{submitError}</div>}

              <fieldset disabled={loading || optionsLoading || Boolean(optionsError) || !registrationOpen} className="space-y-6 disabled:opacity-70">
                <FormSection title="Data Diri Murid" description="Informasi pendaftaran dan identitas calon murid">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="spmb-public-departemen">Lembaga/Sekolah *</Label>
                      <Select value={form.departemen_id} onValueChange={(value) => {
                        const angkatan2027 = allAngkatan.find((angkatan) => angkatan.departemen_id === value);
                        setForm((current) => ({
                          ...current,
                          departemen_id: value,
                          angkatan_id: angkatan2027?.id || "",
                          status_asrama: "",
                        }));
                      }}>
                        <SelectTrigger id="spmb-public-departemen" className="min-h-11"><SelectValue placeholder={optionsLoading ? "Memuat lembaga..." : "Pilih lembaga"} /></SelectTrigger>
                        <SelectContent>{departemenList.length ? departemenList.map((dept) => <SelectItem key={dept.id} value={dept.id}>{dept.nama}</SelectItem>) : <SelectItem value="__empty" disabled>Belum ada lembaga SPMB tersedia</SelectItem>}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Periode Tahun Ajaran *</Label><Input className="min-h-11" value={tahunAjaranList[0] ? "2027–2028" : "Belum dikonfigurasi"} disabled /></div>
                    <div>
                      <Label htmlFor="spmb-public-angkatan">Angkatan *</Label>
                      <Input
                        id="spmb-public-angkatan"
                        className="min-h-11"
                        disabled
                        value={!form.departemen_id
                          ? "Pilih lembaga terlebih dahulu"
                          : form.angkatan_id
                            ? "2027"
                            : angkatanList.length
                              ? "Menyiapkan Angkatan 2027..."
                              : "Belum dikonfigurasi untuk lembaga ini"}
                      />
                      {form.departemen_id && !angkatanList.length && <p className="mt-1 text-xs text-red-700">Angkatan 2027 untuk lembaga ini belum tersedia. Hubungi admin sekolah.</p>}
                      {form.departemen_id && angkatanList.length > 0 && !form.angkatan_id && <p className="mt-1 text-xs text-amber-700">Konfigurasi Angkatan sedang disiapkan. Tunggu sebentar sebelum mengirim formulir.</p>}
                    </div>
                    <div>
                      <Label>Kategori *</Label>
                      <OptionSelect
                        value={form.kategori}
                        placeholder="Pilih kategori"
                        options={[[SPMB_CATEGORY_VALUE, SPMB_CATEGORY_LABEL], [SPMB_TRANSFER_CATEGORY_VALUE, SPMB_TRANSFER_CATEGORY_LABEL]]}
                        onValueChange={(value) => {
                          const transfer = value === SPMB_TRANSFER_CATEGORY_VALUE;
                          setForm((current) => ({ ...current, kategori: value, jenis_pendaftaran: transfer ? "pindahan" : "baru" }));
                          if (!transfer) setDocuments((current) => ({ ...current, rapor: null, ijazah: null }));
                        }}
                      />
                    </div>
                    {wajibAsrama && (mtaWajibAsrama
                      ? <div><Label>Status Asrama *</Label><Input className="min-h-11" value="ASRAMA — wajib untuk pendaftar MTA" disabled /></div>
                      : <div><Label>Asrama / Non Asrama *</Label><OptionSelect value={form.status_asrama} placeholder="Pilih status" options={[["asrama", "ASRAMA"], ["non_asrama", "NON ASRAMA"]]} onValueChange={(value) => setForm((current) => ({ ...current, status_asrama: value }))} /></div>)}
                    <div>
                      <Label>No. HP / WhatsApp yang Bisa Dihubungi *</Label>
                      <Input className="min-h-11" value={form.telepon} onChange={set("telepon")} inputMode="tel" autoComplete="tel" placeholder="08xxxxxxxxxx" />
                      <p className="mt-1 text-xs text-muted-foreground">Gunakan nomor aktif yang dapat dihubungi panitia SPMB.</p>
                    </div>
                    <div><Label htmlFor="spmb-public-nik">NIK Calon Murid *</Label><Input id="spmb-public-nik" className="min-h-11" value={form.nik} onChange={(event) => setForm((current) => ({ ...current, nik: event.target.value.replace(/\D/g, "").slice(0, 16) }))} inputMode="numeric" maxLength={16} placeholder="16 digit NIK" /></div>
                    <div><Label>No. KK *</Label><Input className="min-h-11" value={form.no_kk} onChange={set("no_kk")} inputMode="numeric" minLength={10} maxLength={20} /></div>
                    {wajibNisn && <div><Label htmlFor="spmb-public-nisn">NISN *</Label><Input id="spmb-public-nisn" className="min-h-11" value={form.nisn} onChange={(event) => setForm((current) => ({ ...current, nisn: event.target.value.replace(/\D/g, "").slice(0, 10) }))} inputMode="numeric" maxLength={10} placeholder="10 digit NISN" /></div>}
                    <div className="md:col-span-2"><Label htmlFor="spmb-public-nama">Nama Lengkap *</Label><Input id="spmb-public-nama" className="min-h-11" value={form.nama} onChange={set("nama")} autoComplete="name" /></div>
                    <div><Label>Jenis Kelamin *</Label><OptionSelect value={form.jenis_kelamin} placeholder="Pilih jenis kelamin" options={[["L", "LAKI-LAKI"], ["P", "PEREMPUAN"]]} onValueChange={(value) => setForm((current) => ({ ...current, jenis_kelamin: value }))} /></div>
                    <div><Label>Tempat Lahir *</Label><Input className="min-h-11" value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div>
                    <div><Label>Tanggal Lahir *</Label><Input className="min-h-11" type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div>
                    <div><Label>Anak ke *</Label><Input className="min-h-11" type="number" min="1" max="99" value={form.anak_ke} onChange={set("anak_ke")} /></div>
                    <div><Label>Dari Bersaudara *</Label><Input className="min-h-11" type="number" min="1" max="99" value={form.jumlah_bersaudara} onChange={set("jumlah_bersaudara")} /></div>
                  </div>
                  <div><Label>Penyakit yang Pernah Diderita</Label><Input className="min-h-11" value={form.penyakit_pernah_diderita} onChange={set("penyakit_pernah_diderita")} placeholder="Kosongkan jika tidak ada" /></div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div><Label>Jarak Rumah ke Sekolah (km) *</Label><Input className="min-h-11" type="number" min="0" value={form.jarak_rumah_km} onChange={set("jarak_rumah_km")} /></div>
                    <div><Label>Waktu Perjalanan (menit) *</Label><Input className="min-h-11" type="number" min="0" value={form.waktu_perjalanan_menit} onChange={set("waktu_perjalanan_menit")} /></div>
                    <div><Label>Transportasi yang Digunakan *</Label><OptionSelect value={form.transportasi} placeholder="Pilih transportasi" options={TRANSPORTASI_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, transportasi: value }))} /></div>
                  </div>
                  <div><Label>Alamat Rumah *</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
                </FormSection>

                <FormSection title="Data Ayah" description="Informasi ayah calon murid">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><Label>NIK Ayah *</Label><Input className="min-h-11" value={form.nik_ayah} onChange={set("nik_ayah")} inputMode="numeric" /></div>
                    <div><Label>Nama Ayah *</Label><Input className="min-h-11" value={form.nama_ayah} onChange={set("nama_ayah")} /></div>
                    <div><Label>Tempat Lahir *</Label><Input className="min-h-11" value={form.tempat_lahir_ayah} onChange={set("tempat_lahir_ayah")} /></div>
                    <div><Label>Tanggal Lahir *</Label><Input className="min-h-11" type="date" value={form.tanggal_lahir_ayah} onChange={set("tanggal_lahir_ayah")} /></div>
                    <div><Label>Pendidikan Terakhir *</Label><OptionSelect value={form.pendidikan_ayah} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pendidikan_ayah: value }))} /></div>
                    <div><Label>Pekerjaan *</Label><OptionSelect value={form.pekerjaan_ayah} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pekerjaan_ayah: value }))} /></div>
                    <div><Label>Rentang Penghasilan *</Label><OptionSelect value={form.penghasilan_ayah} placeholder="Pilih rentang penghasilan" options={PENGHASILAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, penghasilan_ayah: value }))} /></div>
                    <div><Label>No. HP / WA *</Label><Input className="min-h-11" value={form.telepon_ayah} onChange={set("telepon_ayah")} inputMode="tel" /></div>
                  </div>
                  <div><Label>Alamat Ayah *</Label><Textarea value={form.alamat_ayah} onChange={set("alamat_ayah")} /></div>
                </FormSection>

                <FormSection title="Data Ibu" description="Informasi ibu calon murid">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><Label>NIK Ibu *</Label><Input className="min-h-11" value={form.nik_ibu} onChange={set("nik_ibu")} inputMode="numeric" /></div>
                    <div><Label>Nama Ibu *</Label><Input className="min-h-11" value={form.nama_ibu} onChange={set("nama_ibu")} /></div>
                    <div><Label>Tempat Lahir *</Label><Input className="min-h-11" value={form.tempat_lahir_ibu} onChange={set("tempat_lahir_ibu")} /></div>
                    <div><Label>Tanggal Lahir *</Label><Input className="min-h-11" type="date" value={form.tanggal_lahir_ibu} onChange={set("tanggal_lahir_ibu")} /></div>
                    <div><Label>Pendidikan Terakhir *</Label><OptionSelect value={form.pendidikan_ibu} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pendidikan_ibu: value }))} /></div>
                    <div><Label>Pekerjaan *</Label><OptionSelect value={form.pekerjaan_ibu} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pekerjaan_ibu: value }))} /></div>
                    <div><Label>Rentang Penghasilan *</Label><OptionSelect value={form.penghasilan_ibu} placeholder="Pilih rentang penghasilan" options={PENGHASILAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, penghasilan_ibu: value }))} /></div>
                    <div><Label>No. HP / WA *</Label><Input className="min-h-11" value={form.telepon_ibu} onChange={set("telepon_ibu")} inputMode="tel" /></div>
                  </div>
                  <div><Label>Alamat Ibu *</Label><Textarea value={form.alamat_ibu} onChange={set("alamat_ibu")} /></div>
                </FormSection>

                <FormSection title="Data Sekolah Asal" description="Diisi bila calon murid pernah bersekolah sebelumnya">
                  <div><Label>Nama Sekolah Asal</Label><Input className="min-h-11" value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div>
                  <div><Label>Alamat Sekolah</Label><Input className="min-h-11" value={form.alamat_sekolah_asal} onChange={set("alamat_sekolah_asal")} /></div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div><Label>Kabupaten/Kota</Label><Input className="min-h-11" value={form.kabupaten_sekolah_asal} onChange={set("kabupaten_sekolah_asal")} /></div>
                    <div><Label>Kecamatan</Label><Input className="min-h-11" value={form.kecamatan_sekolah_asal} onChange={set("kecamatan_sekolah_asal")} /></div>
                    <div><Label>Desa/Kelurahan</Label><Input className="min-h-11" value={form.kelurahan_sekolah_asal} onChange={set("kelurahan_sekolah_asal")} /></div>
                  </div>
                </FormSection>

                <FormSection title="Data Kemampuan Dasar Murid" description="Pilih sesuai kemampuan calon murid saat ini">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><Label>Kemampuan Dasar (Iqro) *</Label><OptionSelect value={form.kemampuan_iqro} placeholder="Pilih kemampuan" options={IQRO_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, kemampuan_iqro: value }))} /></div>
                    <div><Label>Membaca Latin *</Label><OptionSelect value={form.membaca_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, membaca_latin: value }))} /></div>
                    <div><Label>Menulis Latin *</Label><OptionSelect value={form.menulis_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, menulis_latin: value }))} /></div>
                    <div><Label>Hafalan Qur&apos;an *</Label><OptionSelect value={form.hafalan_quran} placeholder="Pilih hafalan" options={HAFALAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, hafalan_quran: value }))} /></div>
                  </div>
                </FormSection>

                <FormSection title="Dokumen Persyaratan" description="Dokumen disimpan privat untuk verifikasi SPMB">
                  <div className="grid gap-4 md:grid-cols-2">
                    <DocumentPicker label="Kartu Keluarga" required value={documents.kk} onChange={(file) => setDocuments((current) => ({ ...current, kk: file }))} />
                    <DocumentPicker label="Akta Kelahiran" required value={documents.akta} onChange={(file) => setDocuments((current) => ({ ...current, akta: file }))} />
                    {siswaPindahan && <DocumentPicker label="Rapor Siswa Pindahan" required value={documents.rapor} onChange={(file) => setDocuments((current) => ({ ...current, rapor: file }))} />}
                    {siswaPindahan && <DocumentPicker label="Ijazah / SKHUN Siswa Pindahan" required value={documents.ijazah} onChange={(file) => setDocuments((current) => ({ ...current, ijazah: file }))} />}
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><Upload className="mt-0.5 h-4 w-4 shrink-0" />Kartu Keluarga dan Akta Kelahiran wajib untuk semua pendaftar. Rapor dan Ijazah/SKHUN hanya ditampilkan dan wajib untuk kategori Siswa Pindahan.</div>
                </FormSection>
              </fieldset>

              <Button type="submit" disabled={loading || optionsLoading || Boolean(optionsError) || !registrationOpen || !form.tahun_ajaran_id || !form.angkatan_id} className="min-h-11 w-full bg-emerald-600 hover:bg-emerald-700">
                <UserPlus className="mr-2 h-4 w-4" />{loading
                  ? "Mengunggah dokumen & mendaftarkan..."
                  : !optionsLoading && form.departemen_id && (!form.tahun_ajaran_id || !form.angkatan_id)
                    ? "Menyiapkan konfigurasi pendaftaran..."
                    : "Daftarkan Calon Murid"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Sudah memiliki akun Portal Orang Tua? <Link to="/portal/login" className="font-medium text-emerald-700 underline">Login Portal Orang Tua</Link></p>
      </div>
    </div>
  );
}
