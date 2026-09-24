import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { pmbCreateDocumentUpload, pmbCurrentRegistrant, spmbAdminDaftar } from "@/server/pmb";
import {
  SPMB_CATEGORY_LABEL,
  SPMB_CATEGORY_VALUE,
  SPMB_TRANSFER_CATEGORY_LABEL,
  SPMB_TRANSFER_CATEGORY_VALUE,
  SPMB_TARGET_ACADEMIC_YEAR,
  SPMB_TARGET_COHORT,
} from "@/lib/spmbPolicy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/shared/FormSection";
import { CheckCircle2, FileCheck2, RefreshCw, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";

type Department = { id: string; nama?: string | null; kode?: string | null; psb_dibuka?: boolean | null };
type Cohort = { id: string; nama?: string | null; departemen_id?: string | null; aktif?: boolean | null };
type AcademicYear = { id: string; nama?: string | null };
type DocKind = "kk" | "akta" | "rapor" | "ijazah";
type Documents = Record<DocKind, File | null>;

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
const IQRO_OPTIONS = [
  ["0", "BELUM PERNAH BELAJAR IQRO"], ["1", "1"], ["2", "2"], ["3", "3"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["7", "SUDAH MENAMATKAN IQRO"],
] as const;
const LATIN_OPTIONS = ["BAIK", "CUKUP", "KURANG"];
const HAFALAN_OPTIONS = [
  ["0", "BELUM PUNYA HAFALAN"], ["1", "KURANG DARI 1/2 JUZ"],
  ["2", "1/2 - 1 JUZ"], ["3", "> 1 JUZ"],
] as const;

const emptyForm = {
  nama: "", jenis_kelamin: "", tempat_lahir: "", tanggal_lahir: "", alamat: "", telepon: "", email: "", nisn: "",
  departemen_id: "", angkatan_id: "", tahun_ajaran_id: "", jenis_pendaftaran: "baru", kelas_terakhir: "", alasan_pindah: "",
  nik: "", no_kk: "", kategori: SPMB_CATEGORY_VALUE, status_asrama: "", anak_ke: "", jumlah_bersaudara: "",
  penyakit_pernah_diderita: "", jarak_rumah_km: "", waktu_perjalanan_menit: "", transportasi: "",
  nama_ayah: "", nik_ayah: "", tempat_lahir_ayah: "", tanggal_lahir_ayah: "", pendidikan_ayah: "", pekerjaan_ayah: "", penghasilan_ayah: "", telepon_ayah: "", alamat_ayah: "",
  nama_ibu: "", nik_ibu: "", tempat_lahir_ibu: "", tanggal_lahir_ibu: "", pendidikan_ibu: "", pekerjaan_ibu: "", penghasilan_ibu: "", telepon_ibu: "", alamat_ibu: "",
  asal_sekolah: "", alamat_sekolah_asal: "", kabupaten_sekolah_asal: "", kecamatan_sekolah_asal: "", kelurahan_sekolah_asal: "",
  kemampuan_iqro: "", membaca_latin: "", menulis_latin: "", hafalan_quran: "",
};

function OptionSelect({ value, placeholder, options, onValueChange }: {
  value: string;
  placeholder: string;
  options: readonly (string | readonly [string, string])[];
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="min-h-11"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option[0];
          const label = typeof option === "string" ? option : option[1];
          return <SelectItem key={optionValue} value={optionValue}>{label}</SelectItem>;
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
  const handle = (file: File | null) => {
    if (!file) return onChange(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) return toast.error(`${label}: file harus PDF, JPG, JPEG, atau PNG`);
    if (file.size > MAX_DOCUMENT_SIZE) return toast.error(`${label}: ukuran file maksimal 10 MB`);
    onChange(file);
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div>
        <Label>{label}{required ? " *" : ""}</Label>
        <p className="mt-1 text-xs text-muted-foreground">PDF/JPG/PNG, maksimal 10 MB · {required ? "wajib" : "opsional"}</p>
      </div>
      <Input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => handle(e.target.files?.[0] || null)} />
      {value && <div className="flex items-center gap-2 text-sm text-success"><FileCheck2 className="h-4 w-4" /><span className="truncate">{value.name}</span></div>}
    </div>
  );
}

function departmentCode(dept?: Department): string {
  const code = String(dept?.kode || "").trim().toUpperCase();
  if (["TK", "SD", "SMP", "SMA", "MTA"].includes(code)) return code;
  return String(dept?.nama || "").trim().toUpperCase().match(/(^|\s)(TK|SD|SMP|SMA|MTA)(\s|$)/)?.[2] || "";
}

export function AdminSpmbRegistrationDialog({
  departments,
  cohorts,
  academicYears,
  disabled,
  onRegistered,
}: {
  departments: Department[];
  cohorts: Cohort[];
  academicYears: AcademicYear[];
  disabled?: boolean;
  onRegistered: (studentId: string) => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [documents, setDocuments] = useState<Documents>({ kk: null, akta: null, rapor: null, ijazah: null });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<{ id: string; nama: string; inputer?: string | null } | null>(null);
  const [inputerName, setInputerName] = useState("Petugas");

  const targetYear = useMemo(
    () => academicYears.find((item) => String(item.nama || "").trim() === SPMB_TARGET_ACADEMIC_YEAR),
    [academicYears],
  );
  const selectedDept = useMemo(() => departments.find((d) => d.id === form.departemen_id), [departments, form.departemen_id]);
  const code = departmentCode(selectedDept);
  const targetCohort = useMemo(
    () => cohorts.find((item) => item.departemen_id === form.departemen_id && String(item.nama || "").trim() === SPMB_TARGET_COHORT && item.aktif !== false),
    [cohorts, form.departemen_id],
  );
  const needsNisn = ["SMP", "SMA", "MTA"].includes(code);
  const mtaBoarding = code === "MTA";
  const akhwatNonBoarding = ["SMP", "SMA"].includes(code) && form.jenis_kelamin === "P";
  const ikhwanBoardingChoice = ["SMP", "SMA"].includes(code) && form.jenis_kelamin === "L";
  const isTransfer = form.kategori === SPMB_TRANSFER_CATEGORY_VALUE;
  const inputer = inputerName;

  useEffect(() => {
    let active = true;
    const resolveName = async () => {
      if (!user) {
        setInputerName("Petugas");
        return;
      }

      const googleIdentity = user.identities?.find((identity) => identity.provider === "google");
      const identityData = (googleIdentity?.identity_data || {}) as Record<string, unknown>;
      const fallbackName = String(
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        identityData.full_name ||
        identityData.name ||
        [identityData.given_name, identityData.family_name].filter(Boolean).join(" ") ||
        "Petugas"
      ).trim();

      try {
        const current = await pmbCurrentRegistrant();
        if (!active) return;
        setInputerName(current.nama?.trim() || fallbackName);
      } catch {
        if (active) setInputerName(fallbackName);
      }
    };
    void resolveName();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({ ...current, tahun_ajaran_id: targetYear?.id || "", angkatan_id: targetCohort?.id || "" }));
  }, [open, targetYear?.id, targetCohort?.id]);

  useEffect(() => {
    if (mtaBoarding) setForm((current) => current.status_asrama === "asrama" ? current : { ...current, status_asrama: "asrama" });
    else if (akhwatNonBoarding) setForm((current) => current.status_asrama === "non_asrama" ? current : { ...current, status_asrama: "non_asrama" });
    else if (!ikhwanBoardingChoice && form.status_asrama) setForm((current) => ({ ...current, status_asrama: "" }));
  }, [mtaBoarding, akhwatNonBoarding, ikhwanBoardingChoice, form.status_asrama]);

  const reset = () => {
    setForm({ ...emptyForm, tahun_ajaran_id: targetYear?.id || "" });
    setDocuments({ kk: null, akta: null, rapor: null, ijazah: null });
    setSuccess(null);
  };

  const set = (key: keyof typeof emptyForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function upload(kind: DocKind, file: File | null): Promise<string | undefined> {
    if (!file) return undefined;
    const signed = await pmbCreateDocumentUpload({ data: { kind, file_name: file.name } });
    const { error } = await supabase.storage.from(PMB_DOCUMENT_BUCKET)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Gagal mengunggah ${file.name}: ${error.message}`);
    return signed.path;
  }

  function validate(): string | null {
    const required: Array<[string, string]> = [
      ["Lembaga/Sekolah", form.departemen_id], ["Periode Tahun Ajaran", form.tahun_ajaran_id], ["Angkatan", form.angkatan_id],
      ["NIK Calon Murid", form.nik], ["No. KK", form.no_kk], ["Kategori", form.kategori], ["Nama Lengkap", form.nama],
      ["Jenis Kelamin", form.jenis_kelamin], ["Tempat Lahir Murid", form.tempat_lahir], ["Tanggal Lahir Murid", form.tanggal_lahir],
      ["Alamat Rumah", form.alamat], ["No. HP / WhatsApp", form.telepon], ["Anak ke", form.anak_ke], ["Dari Bersaudara", form.jumlah_bersaudara],
      ["Jarak Rumah ke Sekolah", form.jarak_rumah_km], ["Waktu Perjalanan", form.waktu_perjalanan_menit], ["Transportasi", form.transportasi],
      ["Kemampuan Dasar (Iqro)", form.kemampuan_iqro], ["Membaca Latin", form.membaca_latin], ["Menulis Latin", form.menulis_latin],
      ["Hafalan Qur'an", form.hafalan_quran], ["Nama Ayah", form.nama_ayah], ["NIK Ayah", form.nik_ayah],
      ["Tempat Lahir Ayah", form.tempat_lahir_ayah], ["Tanggal Lahir Ayah", form.tanggal_lahir_ayah], ["Pendidikan Ayah", form.pendidikan_ayah],
      ["Pekerjaan Ayah", form.pekerjaan_ayah], ["Penghasilan Ayah", form.penghasilan_ayah], ["No. HP / WA Ayah", form.telepon_ayah],
      ["Alamat Ayah", form.alamat_ayah], ["Nama Ibu", form.nama_ibu], ["NIK Ibu", form.nik_ibu], ["Tempat Lahir Ibu", form.tempat_lahir_ibu],
      ["Tanggal Lahir Ibu", form.tanggal_lahir_ibu], ["Pendidikan Ibu", form.pendidikan_ibu], ["Pekerjaan Ibu", form.pekerjaan_ibu],
      ["Penghasilan Ibu", form.penghasilan_ibu], ["No. HP / WA Ibu", form.telepon_ibu], ["Alamat Ibu", form.alamat_ibu],
      ...(needsNisn ? [["NISN", form.nisn] as [string, string]] : []),
    ];
    const missing = required.filter(([, value]) => !String(value).trim()).map(([label]) => label);
    if (missing.length) return `Lengkapi data wajib: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (dan ${missing.length - 5} lainnya)` : ""}.`;
    if (!/^\d{16}$/.test(form.nik)) return "NIK Calon Murid harus terdiri dari tepat 16 digit.";
    if (needsNisn && !/^\d{10}$/.test(form.nisn)) return "NISN wajib diisi 10 digit untuk SMP, SMA, dan MTA.";
    if (!/^\d{16}$/.test(form.nik_ayah.replace(/\D/g, "")) || !/^\d{16}$/.test(form.nik_ibu.replace(/\D/g, ""))) return "NIK Ayah dan NIK Ibu masing-masing harus 16 digit.";
    if (!/^(?:\+62|62|0)[0-9]{7,16}$/.test(form.telepon.replace(/[\s-]/g, ""))) return "Masukkan No. HP / WhatsApp yang aktif dan bisa dihubungi.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Format email tidak valid.";
    if (ikhwanBoardingChoice && !form.status_asrama) return "Pilih Asrama / Non Asrama untuk SMP/SMA Ikhwan.";
    if (!documents.kk || !documents.akta) return "Kartu Keluarga dan Akta Kelahiran wajib diunggah.";
    if (isTransfer && (!documents.rapor || !documents.ijazah)) return "Rapor dan Ijazah / SKHUN wajib diunggah untuk Siswa Pindahan.";
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validation = validate();
    if (validation) return toast.error(validation);
    setSaving(true);
    try {
      const [kk, akta, rapor, ijazah] = await Promise.all([
        upload("kk", documents.kk), upload("akta", documents.akta),
        upload("rapor", documents.rapor), upload("ijazah", documents.ijazah),
      ]);
      const result = await spmbAdminDaftar({ data: {
        ...form,
        nik: form.nik.replace(/\D/g, ""),
        nisn: form.nisn.replace(/\D/g, ""),
        nik_ayah: form.nik_ayah.replace(/\D/g, ""),
        nik_ibu: form.nik_ibu.replace(/\D/g, ""),
        jenis_pendaftaran: isTransfer ? "pindahan" : "baru",
        status_asrama: mtaBoarding ? "asrama" : akhwatNonBoarding ? "non_asrama" : form.status_asrama,
        telepon_ortu: form.telepon_ayah || form.telepon_ibu,
        alamat_ortu: form.alamat_ayah || form.alamat_ibu,
        dokumen_kk_path: kk,
        dokumen_akta_path: akta,
        dokumen_rapor_path: rapor,
        dokumen_ijazah_path: ijazah,
      } });
      await onRegistered(result.siswa_id);
      setSuccess({ id: result.siswa_id, nama: form.nama.trim(), inputer: result.inputer_nama || result.inputer_email });
      toast.success("Pendaftaran SPMB berhasil disimpan", { description: `Petugas: ${result.inputer_nama || result.inputer_email || inputer}` });
    } catch (error: any) {
      toast.error("Gagal menyimpan pendaftaran", { description: error?.message || "Terjadi kesalahan teknis" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (saving) return;
      setOpen(next);
      if (next) reset();
    }}>
      <DialogTrigger asChild>
        <Button className="min-h-11 px-4" disabled={disabled}><UserPlus className="mr-2 h-4 w-4" />Daftarkan Calon Murid</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94dvh] overflow-hidden p-0 sm:max-w-4xl">
        {success ? (
          <div className="p-7 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <DialogHeader className="mt-4"><DialogTitle>Pendaftaran SPMB Berhasil</DialogTitle></DialogHeader>
            <p className="mt-2 text-sm"><strong>{success.nama}</strong> sudah tercatat sebagai calon murid.</p>
            <p className="mt-2 text-sm text-muted-foreground">Nama Pendaftar: <strong>{success.inputer || inputer}</strong></p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Kembali</Button>
              <Button onClick={() => navigate(`/akademik/siswa/${success.id}`)}>Lihat Data SPMB</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex max-h-[94dvh] flex-col" noValidate>
            <div className="border-b px-6 py-5">
              <DialogHeader><DialogTitle>Daftarkan Calon Murid</DialogTitle></DialogHeader>
              <p className="mt-2 text-sm text-muted-foreground">Form ini mengikuti data dan aturan yang sama dengan halaman /spmb.</p>
            </div>

            <fieldset disabled={saving} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5 disabled:opacity-70">
              <FormSection title="Nama Pendaftar" description="Dicatat otomatis dari akun yang sedang login">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Petugas yang Menginput *</Label><Input value={inputer} disabled /></div>
                  <div><Label>Sumber Pendaftaran</Label><Input value="Admin / TU — /akademik/spmb" disabled /></div>
                </div>
              </FormSection>

              <FormSection title="Data Diri Murid" description="Informasi pendaftaran dan identitas calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Lembaga/Sekolah *</Label><Select value={form.departemen_id} onValueChange={(value) => setForm((current) => ({ ...current, departemen_id: value, angkatan_id: cohorts.find((a) => a.departemen_id === value && String(a.nama || "").trim() === SPMB_TARGET_COHORT && a.aktif !== false)?.id || "", status_asrama: "" }))}><SelectTrigger><SelectValue placeholder="Pilih lembaga" /></SelectTrigger><SelectContent>{departments.map((dept) => <SelectItem key={dept.id} value={dept.id}>{dept.nama || dept.kode}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Periode Tahun Ajaran *</Label><Input value={targetYear ? "2027–2028" : "Belum dikonfigurasi"} disabled /></div>
                  <div><Label>Angkatan *</Label><Input value={!form.departemen_id ? "Pilih lembaga terlebih dahulu" : targetCohort ? "2027" : "Belum dikonfigurasi"} disabled /></div>
                  <div><Label>Kategori *</Label><OptionSelect value={form.kategori} placeholder="Pilih kategori" options={[[SPMB_CATEGORY_VALUE, SPMB_CATEGORY_LABEL], [SPMB_TRANSFER_CATEGORY_VALUE, SPMB_TRANSFER_CATEGORY_LABEL]]} onValueChange={(value) => { const transfer = value === SPMB_TRANSFER_CATEGORY_VALUE; setForm((current) => ({ ...current, kategori: value, jenis_pendaftaran: transfer ? "pindahan" : "baru" })); if (!transfer) setDocuments((current) => ({ ...current, rapor: null, ijazah: null })); }} /></div>
                  {mtaBoarding ? <div><Label>Status Asrama *</Label><Input value="ASRAMA — wajib untuk pendaftar MTA" disabled /></div> : akhwatNonBoarding ? <div><Label>Status Asrama *</Label><Input value="NON ASRAMA — khusus Akhwat SMP/SMA" disabled /></div> : ikhwanBoardingChoice ? <div><Label>Asrama / Non Asrama *</Label><OptionSelect value={form.status_asrama} placeholder="Pilih status" options={[["asrama", "ASRAMA"], ["non_asrama", "NON ASRAMA"]]} onValueChange={(value) => setForm((current) => ({ ...current, status_asrama: value }))} /></div> : null}
                  <div><Label>No. HP / WhatsApp yang Bisa Dihubungi *</Label><Input value={form.telepon} onChange={set("telepon")} inputMode="tel" placeholder="08xxxxxxxxxx" /></div>
                  <div><Label>Email (opsional)</Label><Input type="email" value={form.email} onChange={set("email")} placeholder="nama@gmail.com" /></div>
                  <div><Label>NIK Calon Murid *</Label><Input value={form.nik} onChange={(e) => setForm((current) => ({ ...current, nik: e.target.value.replace(/\D/g, "").slice(0, 16) }))} inputMode="numeric" maxLength={16} /></div>
                  <div><Label>No. KK *</Label><Input value={form.no_kk} onChange={set("no_kk")} inputMode="numeric" /></div>
                  {needsNisn && <div><Label>NISN *</Label><Input value={form.nisn} onChange={(e) => setForm((current) => ({ ...current, nisn: e.target.value.replace(/\D/g, "").slice(0, 10) }))} inputMode="numeric" maxLength={10} /></div>}
                  <div className="md:col-span-2"><Label>Nama Lengkap *</Label><Input value={form.nama} onChange={set("nama")} /></div>
                  <div><Label>Jenis Kelamin *</Label><OptionSelect value={form.jenis_kelamin} placeholder="Pilih jenis kelamin" options={[["L", "LAKI-LAKI"], ["P", "PEREMPUAN"]]} onValueChange={(value) => setForm((current) => ({ ...current, jenis_kelamin: value, status_asrama: "" }))} /></div>
                  <div><Label>Tempat Lahir *</Label><Input value={form.tempat_lahir} onChange={set("tempat_lahir")} /></div>
                  <div><Label>Tanggal Lahir *</Label><Input type="date" value={form.tanggal_lahir} onChange={set("tanggal_lahir")} /></div>
                  <div><Label>Anak ke *</Label><Input type="number" min="1" value={form.anak_ke} onChange={set("anak_ke")} /></div>
                  <div><Label>Dari Bersaudara *</Label><Input type="number" min="1" value={form.jumlah_bersaudara} onChange={set("jumlah_bersaudara")} /></div>
                </div>
                <div><Label>Penyakit yang Pernah Diderita</Label><Input value={form.penyakit_pernah_diderita} onChange={set("penyakit_pernah_diderita")} placeholder="Kosongkan jika tidak ada" /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Jarak Rumah ke Sekolah (km) *</Label><Input type="number" min="0" value={form.jarak_rumah_km} onChange={set("jarak_rumah_km")} /></div>
                  <div><Label>Waktu Perjalanan (menit) *</Label><Input type="number" min="0" value={form.waktu_perjalanan_menit} onChange={set("waktu_perjalanan_menit")} /></div>
                  <div><Label>Transportasi yang Digunakan *</Label><OptionSelect value={form.transportasi} placeholder="Pilih transportasi" options={TRANSPORTASI_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, transportasi: value }))} /></div>
                </div>
                <div><Label>Alamat Rumah *</Label><Textarea value={form.alamat} onChange={set("alamat")} /></div>
              </FormSection>

              <FormSection title="Data Ayah" description="Informasi ayah calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ayah *</Label><Input value={form.nik_ayah} onChange={(e) => setForm((current) => ({ ...current, nik_ayah: e.target.value.replace(/\D/g, "").slice(0, 16) }))} inputMode="numeric" /></div>
                  <div><Label>Nama Ayah *</Label><Input value={form.nama_ayah} onChange={set("nama_ayah")} /></div>
                  <div><Label>Tempat Lahir *</Label><Input value={form.tempat_lahir_ayah} onChange={set("tempat_lahir_ayah")} /></div>
                  <div><Label>Tanggal Lahir *</Label><Input type="date" value={form.tanggal_lahir_ayah} onChange={set("tanggal_lahir_ayah")} /></div>
                  <div><Label>Pendidikan Terakhir *</Label><OptionSelect value={form.pendidikan_ayah} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pendidikan_ayah: value }))} /></div>
                  <div><Label>Pekerjaan *</Label><OptionSelect value={form.pekerjaan_ayah} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pekerjaan_ayah: value }))} /></div>
                  <div><Label>Rentang Penghasilan *</Label><OptionSelect value={form.penghasilan_ayah} placeholder="Pilih rentang penghasilan" options={PENGHASILAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, penghasilan_ayah: value }))} /></div>
                  <div><Label>No. HP / WA *</Label><Input value={form.telepon_ayah} onChange={set("telepon_ayah")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat Ayah *</Label><Textarea value={form.alamat_ayah} onChange={set("alamat_ayah")} /></div>
              </FormSection>

              <FormSection title="Data Ibu" description="Informasi ibu calon murid">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>NIK Ibu *</Label><Input value={form.nik_ibu} onChange={(e) => setForm((current) => ({ ...current, nik_ibu: e.target.value.replace(/\D/g, "").slice(0, 16) }))} inputMode="numeric" /></div>
                  <div><Label>Nama Ibu *</Label><Input value={form.nama_ibu} onChange={set("nama_ibu")} /></div>
                  <div><Label>Tempat Lahir *</Label><Input value={form.tempat_lahir_ibu} onChange={set("tempat_lahir_ibu")} /></div>
                  <div><Label>Tanggal Lahir *</Label><Input type="date" value={form.tanggal_lahir_ibu} onChange={set("tanggal_lahir_ibu")} /></div>
                  <div><Label>Pendidikan Terakhir *</Label><OptionSelect value={form.pendidikan_ibu} placeholder="Pilih pendidikan" options={PENDIDIKAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pendidikan_ibu: value }))} /></div>
                  <div><Label>Pekerjaan *</Label><OptionSelect value={form.pekerjaan_ibu} placeholder="Pilih pekerjaan" options={PEKERJAAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, pekerjaan_ibu: value }))} /></div>
                  <div><Label>Rentang Penghasilan *</Label><OptionSelect value={form.penghasilan_ibu} placeholder="Pilih rentang penghasilan" options={PENGHASILAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, penghasilan_ibu: value }))} /></div>
                  <div><Label>No. HP / WA *</Label><Input value={form.telepon_ibu} onChange={set("telepon_ibu")} inputMode="tel" /></div>
                </div>
                <div><Label>Alamat Ibu *</Label><Textarea value={form.alamat_ibu} onChange={set("alamat_ibu")} /></div>
              </FormSection>

              <FormSection title="Data Sekolah Asal" description="Diisi bila calon murid pernah bersekolah sebelumnya">
                <div><Label>Nama Sekolah Asal</Label><Input value={form.asal_sekolah} onChange={set("asal_sekolah")} /></div>
                <div><Label>Alamat Sekolah</Label><Input value={form.alamat_sekolah_asal} onChange={set("alamat_sekolah_asal")} /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Kabupaten/Kota</Label><Input value={form.kabupaten_sekolah_asal} onChange={set("kabupaten_sekolah_asal")} /></div>
                  <div><Label>Kecamatan</Label><Input value={form.kecamatan_sekolah_asal} onChange={set("kecamatan_sekolah_asal")} /></div>
                  <div><Label>Desa/Kelurahan</Label><Input value={form.kelurahan_sekolah_asal} onChange={set("kelurahan_sekolah_asal")} /></div>
                </div>
              </FormSection>

              <FormSection title="Data Kemampuan Dasar Murid" description="Pilih sesuai kemampuan calon murid saat ini">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><Label>Kemampuan Dasar (Iqro) *</Label><OptionSelect value={form.kemampuan_iqro} placeholder="Pilih kemampuan" options={IQRO_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, kemampuan_iqro: value }))} /></div>
                  <div><Label>Membaca Latin *</Label><OptionSelect value={form.membaca_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, membaca_latin: value }))} /></div>
                  <div><Label>Menulis Latin *</Label><OptionSelect value={form.menulis_latin} placeholder="Pilih kemampuan" options={LATIN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, menulis_latin: value }))} /></div>
                  <div><Label>Hafalan Qur'an *</Label><OptionSelect value={form.hafalan_quran} placeholder="Pilih hafalan" options={HAFALAN_OPTIONS} onValueChange={(value) => setForm((current) => ({ ...current, hafalan_quran: value }))} /></div>
                </div>
              </FormSection>

              <FormSection title="Dokumen Persyaratan" description="Sama dengan /spmb dan disimpan privat untuk verifikasi">
                <div className="grid gap-4 md:grid-cols-2">
                  <DocumentPicker label="Kartu Keluarga" required value={documents.kk} onChange={(file) => setDocuments((current) => ({ ...current, kk: file }))} />
                  <DocumentPicker label="Akta Kelahiran" required value={documents.akta} onChange={(file) => setDocuments((current) => ({ ...current, akta: file }))} />
                  {isTransfer && <DocumentPicker label="Rapor Siswa Pindahan" required value={documents.rapor} onChange={(file) => setDocuments((current) => ({ ...current, rapor: file }))} />}
                  {isTransfer && <DocumentPicker label="Ijazah / SKHUN Siswa Pindahan" required value={documents.ijazah} onChange={(file) => setDocuments((current) => ({ ...current, ijazah: file }))} />}
                </div>
                <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground"><Upload className="mt-0.5 h-4 w-4 shrink-0" />KK dan Akta wajib. Rapor dan Ijazah/SKHUN wajib hanya untuk Siswa Pindahan.</div>
              </FormSection>
            </fieldset>

            <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" disabled={saving || !targetYear || !targetCohort}>
                {saving ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Mengunggah & menyimpan…</> : <><UserPlus className="mr-2 h-4 w-4" />Simpan Pendaftaran</>}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
