import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { AlertTriangle, CheckCircle2, Eye, FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTahunAjaran } from "@/hooks/useAkademikData";
import { spmbGetDocumentUrl } from "@/server/spmbDocuments";
import { SpmbFieldVerification } from "@/components/akademik/SpmbFieldVerification";
import { saveSpmbVerificationFields, spmbVerificationQueryKey, useSpmbVerificationState, type SpmbVerificationState } from "@/hooks/useSpmbVerification";

type Detail = Record<string, unknown> & {
  siswa_id?: string;
  dokumen_kk_path?: string | null;
  dokumen_akta_path?: string | null;
  dokumen_rapor_path?: string | null;
  dokumen_ijazah_path?: string | null;
};
type ChecklistContextValue = {
  state?: SpmbVerificationState;
  saving: boolean;
  onChange: (key: string, checked: boolean) => void;
};
const ChecklistContext = createContext<ChecklistContextValue>({ saving: false, onChange: () => {} });

function hasValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "" && value !== "-"
    && value !== "Opsional — belum diisi";
}

function FieldChecklist({ fieldKey, value }: { fieldKey?: string; value: unknown }) {
  const { state, saving, onChange } = useContext(ChecklistContext);
  const requirement = state?.requirements.find((item) => item.key === fieldKey);
  if (!fieldKey || !requirement || !state) return null;
  const checked = state.checklist[fieldKey] === true;
  return (
    <SpmbFieldVerification
      fieldKey={fieldKey}
      checked={checked}
      disabled={!state.can_verify || saving || (!checked && !hasValue(value))}
      required={requirement.required}
      label={requirement.required ? "Sudah diperiksa" : "Sudah diperiksa (opsional)"}
      onCheckedChange={onChange}
    />
  );
}

const IQRO_LABELS: Record<string, string> = {
  "0": "Belum pernah belajar Iqro",
  "1": "Iqro 1",
  "2": "Iqro 2",
  "3": "Iqro 3",
  "4": "Iqro 4",
  "5": "Iqro 5",
  "6": "Iqro 6",
  "7": "Sudah menamatkan Iqro",
};

const HAFALAN_LABELS: Record<string, string> = {
  "0": "Belum punya hafalan",
  "1": "Kurang dari 1/2 juz",
  "2": "1/2 - 1 juz",
  "3": "> 1 juz",
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatRupiah(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return display(value);
  return `Rp ${number.toLocaleString("id-ID")}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoRow({ label, value, fieldKey }: { label: string; value: unknown; fieldKey?: string }) {
  const { state } = useContext(ChecklistContext);
  const required = state?.requirements.some((item) => item.key === fieldKey && item.required);
  return (
    <div className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
      <span className="text-sm text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</span>
      <div className="min-w-0 space-y-2 break-words text-sm">
        <p>{display(value)}</p>
        <FieldChecklist fieldKey={fieldKey} value={value} />
      </div>
    </div>
  );
}

function DocumentRow({ label, path, fieldKey }: { label: string; path?: string | null; fieldKey: string }) {
  const [loading, setLoading] = useState(false);

  const openDocument = async () => {
    if (!path) return;
    setLoading(true);
    try {
      const { url } = await spmbGetDocumentUrl({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast.error("Dokumen tidak dapat dibuka", { description: error && typeof error === "object" && "message" in error ? String(error.message) : "Terjadi kesalahan saat membuat tautan dokumen." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{path ? "Dokumen tersedia" : "Belum diunggah"}</p>
        <div className="mt-2"><FieldChecklist fieldKey={fieldKey} value={path} /></div>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={!path || loading} onClick={openDocument}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Buka Dokumen
      </Button>
    </div>
  );
}

function verificationLabel(status?: SpmbVerificationState["status"]) {
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "perlu_verifikasi_ulang") return "Perlu Verifikasi Ulang";
  return "Belum Diverifikasi";
}

export function SiswaSpmbDetail({ detail }: { detail: Detail | null | undefined }) {
  const navigate = useNavigate();
  const { data: tahunAjaranList = [] } = useTahunAjaran();
  const siswaId = detail?.siswa_id as string | undefined;

  const queryClient = useQueryClient();
  const verificationQuery = useSpmbVerificationState(siswaId || "");
  const { data: verification, isLoading: verificationLoading } = verificationQuery;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const setChecked = async (key: string, checked: boolean) => {
    if (!siswaId || !verification?.can_verify || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Submit the version actually reviewed; the server rejects changed data.
      const saved = await saveSpmbVerificationFields(siswaId, { [key]: checked }, verification.version);
      queryClient.setQueryData(spmbVerificationQueryKey(siswaId), saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["siswa_detail", siswaId] }),
        queryClient.invalidateQueries({ queryKey: ["spmb_registration_detail"] }),
        queryClient.invalidateQueries({ queryKey: ["siswa", "calon"] }),
        queryClient.invalidateQueries({ queryKey: ["spmb_verification_overview"] }),
      ]);
      toast.success("Checklist tersimpan");
    } catch (error: unknown) {
      toast.error("Gagal menyimpan checklist", {
        description: error && typeof error === "object" && "message" in error ? String(error.message) : "Silakan coba kembali.",
      });
      await verificationQuery.refetch();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!detail || !siswaId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Belum ada data detail SPMB untuk siswa ini.</CardContent>
      </Card>
    );
  }

  const tahunAjaran = tahunAjaranList.find((item) => item.id === detail.tahun_ajaran_id)?.nama;
  const statusAsrama = detail.status_asrama === "asrama" ? "Asrama" : detail.status_asrama === "non_asrama" ? "Non Asrama" : "-";
  const verified = verification?.status === "terverifikasi";
  const needsReview = verification?.status === "perlu_verifikasi_ulang";

  return (
    <ChecklistContext.Provider value={{ state: verification, saving, onChange: setChecked }}>
    <div className="space-y-4">
      <Card className={verified ? "border-success/30 bg-success/5" : needsReview ? "border-warning/40 bg-warning/5" : undefined}>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {verificationLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : verified ? <CheckCircle2 className="h-5 w-5 text-success" /> : needsReview ? <AlertTriangle className="h-5 w-5 text-warning" /> : <ShieldCheck className="h-5 w-5" />}
              <p className="font-medium">Status Verifikasi Data SPMB</p>
            </div>
            <p className="mt-1 text-sm font-medium">{verificationLoading ? "Memuat…" : verificationLabel(verification?.status)}</p>
            {verification?.verified_at && <p className="text-xs text-muted-foreground">Waktu verifikasi: {formatDateTime(verification.verified_at)}</p>}
            {verification?.verified_by_name && <p className="text-xs text-muted-foreground">Petugas: {verification.verified_by_name}</p>}
            {verified && !verification?.verified_at && <p className="text-xs text-muted-foreground">Verifikasi lama terdeteksi; waktu/petugas historis tidak tersedia.</p>}
            {needsReview && verification?.last_reason && <p className="mt-2 text-sm text-warning">{verification.last_reason}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Centang isian yang sudah diperiksa. Checklist tersimpan otomatis dan sama dengan Edit Siswa. Tanda * menunjukkan pemeriksaan wajib. Penyelesaian verifikasi dilakukan dari Edit Siswa.</p>
          </div>
          {verification?.can_verify && (
            <Button type="button" className="min-h-11 shrink-0" onClick={() => navigate(`/akademik/siswa/${siswaId}/edit`)}>
              <ShieldCheck className="mr-2 h-4 w-4" />Periksa dan Verifikasi Data
            </Button>
          )}
        </CardContent>
      </Card>

      {verificationQuery.isError && <p role="alert" className="text-sm text-destructive">Checklist tidak dapat dimuat. <Button variant="link" onClick={() => verificationQuery.refetch()}>Coba lagi</Button></p>}
      {saving && <p role="status" className="text-sm text-muted-foreground">Menyimpan checklist…</p>}
      {verification && (
        <Section title="Data Inti Siswa">
          {verification.requirements.filter((item) => ["nama", "nisn", "jenis_kelamin", "tempat_lahir", "tanggal_lahir", "alamat", "telepon", "departemen_id", "angkatan_id"].includes(item.key)).map((item) => (
            <InfoRow key={item.key} fieldKey={item.key} label={item.label} value={hasValue(item.display_value) ? item.display_value : null} />
          ))}
        </Section>
      )}

      <Section title="Data Pendaftaran SPMB">
        <InfoRow fieldKey="tahun_ajaran_id" label="Periode Tahun Ajaran" value={tahunAjaran || detail.tahun_ajaran_id} />
        <InfoRow fieldKey="jenis_pendaftaran" label="Jenis Pendaftaran" value={detail.jenis_pendaftaran} />
        <InfoRow fieldKey="kategori" label="Kategori" value={detail.kategori} />
        <InfoRow fieldKey="nik" label="NIK Hijrah" value={detail.nik} />
        <InfoRow fieldKey="nik_dapodik" label="NIK Dapodik" value={detail.nik_dapodik} />
        <InfoRow fieldKey="no_kk" label="No. KK" value={detail.no_kk} />
        <InfoRow fieldKey="status_asrama" label="Asrama / Non Asrama" value={statusAsrama} />
        <InfoRow fieldKey="anak_ke" label="Anak ke" value={detail.anak_ke} />
        <InfoRow fieldKey="jumlah_bersaudara" label="Dari Bersaudara" value={detail.jumlah_bersaudara} />
        <InfoRow fieldKey="tinggi_badan_cm" label="Tinggi Badan" value={detail.tinggi_badan_cm != null ? `${detail.tinggi_badan_cm} cm` : null} />
        <InfoRow fieldKey="berat_badan_kg" label="Berat Badan" value={detail.berat_badan_kg != null ? `${detail.berat_badan_kg} kg` : null} />
        <InfoRow fieldKey="lingkar_kepala_cm" label="Lingkar Kepala" value={detail.lingkar_kepala_cm != null ? `${detail.lingkar_kepala_cm} cm` : null} />
        <InfoRow fieldKey="ukuran_baju" label="Ukuran Baju" value={detail.ukuran_baju} />
        <InfoRow fieldKey="penyakit_pernah_diderita" label="Penyakit yang Pernah Diderita" value={detail.penyakit_pernah_diderita} />
        <InfoRow fieldKey="jarak_rumah_km" label="Jarak Rumah ke Sekolah" value={detail.jarak_rumah_km !== null && detail.jarak_rumah_km !== undefined ? `${detail.jarak_rumah_km} km` : null} />
        <InfoRow fieldKey="waktu_perjalanan_menit" label="Waktu Perjalanan" value={detail.waktu_perjalanan_menit !== null && detail.waktu_perjalanan_menit !== undefined ? `${detail.waktu_perjalanan_menit} menit` : null} />
        <InfoRow fieldKey="transportasi" label="Transportasi" value={detail.transportasi} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Data Ayah">
          <InfoRow fieldKey="nik_ayah" label="NIK Ayah" value={detail.nik_ayah} />
          <InfoRow fieldKey="nama_ayah" label="Nama Ayah" value={detail.nama_ayah} />
          <InfoRow fieldKey="tempat_lahir_ayah" label="Tempat Lahir" value={detail.tempat_lahir_ayah} />
          <InfoRow fieldKey="tanggal_lahir_ayah" label="Tanggal Lahir" value={detail.tanggal_lahir_ayah} />
          <InfoRow fieldKey="pendidikan_ayah" label="Pendidikan Terakhir" value={detail.pendidikan_ayah} />
          <InfoRow fieldKey="pekerjaan_ayah" label="Pekerjaan" value={detail.pekerjaan_ayah} />
          <InfoRow fieldKey="penghasilan_ayah" label="Penghasilan" value={formatRupiah(detail.penghasilan_ayah)} />
          <InfoRow fieldKey="telepon_ayah" label="No. HP / WA" value={detail.telepon_ayah} />
          <InfoRow fieldKey="alamat_ayah" label="Alamat" value={detail.alamat_ayah} />
        </Section>

        <Section title="Data Ibu">
          <InfoRow fieldKey="nik_ibu" label="NIK Ibu" value={detail.nik_ibu} />
          <InfoRow fieldKey="nama_ibu" label="Nama Ibu" value={detail.nama_ibu} />
          <InfoRow fieldKey="tempat_lahir_ibu" label="Tempat Lahir" value={detail.tempat_lahir_ibu} />
          <InfoRow fieldKey="tanggal_lahir_ibu" label="Tanggal Lahir" value={detail.tanggal_lahir_ibu} />
          <InfoRow fieldKey="pendidikan_ibu" label="Pendidikan Terakhir" value={detail.pendidikan_ibu} />
          <InfoRow fieldKey="pekerjaan_ibu" label="Pekerjaan" value={detail.pekerjaan_ibu} />
          <InfoRow fieldKey="penghasilan_ibu" label="Penghasilan" value={formatRupiah(detail.penghasilan_ibu)} />
          <InfoRow fieldKey="telepon_ibu" label="No. HP / WA" value={detail.telepon_ibu} />
          <InfoRow fieldKey="alamat_ibu" label="Alamat" value={detail.alamat_ibu} />
        </Section>
      </div>

      <Section title="Data Sekolah Asal">
        <InfoRow fieldKey="asal_sekolah" label="Nama Sekolah Asal" value={detail.asal_sekolah} />
        <InfoRow fieldKey="alamat_sekolah_asal" label="Alamat Sekolah" value={detail.alamat_sekolah_asal} />
        <InfoRow fieldKey="kabupaten_sekolah_asal" label="Kabupaten/Kota" value={detail.kabupaten_sekolah_asal} />
        <InfoRow fieldKey="kecamatan_sekolah_asal" label="Kecamatan" value={detail.kecamatan_sekolah_asal} />
        <InfoRow fieldKey="kelurahan_sekolah_asal" label="Desa/Kelurahan" value={detail.kelurahan_sekolah_asal} />
        <InfoRow fieldKey="kelas_terakhir" label="Kelas Terakhir" value={detail.kelas_terakhir} />
        <InfoRow fieldKey="alasan_pindah" label="Alasan Pindah" value={detail.alasan_pindah} />
      </Section>

      <Section title="Kemampuan Dasar Siswa">
        <InfoRow fieldKey="kemampuan_iqro" label="Kemampuan Dasar (Iqro)" value={IQRO_LABELS[String(detail.kemampuan_iqro)] || detail.kemampuan_iqro} />
        <InfoRow fieldKey="membaca_latin" label="Membaca Latin" value={detail.membaca_latin} />
        <InfoRow fieldKey="menulis_latin" label="Menulis Latin" value={detail.menulis_latin} />
        <InfoRow fieldKey="hafalan_quran" label="Hafalan Qur'an" value={HAFALAN_LABELS[String(detail.hafalan_quran)] || detail.hafalan_quran} />
      </Section>

      <Section title="Dokumen SPMB">
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FileText className="h-4 w-4" />Buka dokumen untuk memeriksa isinya, lalu centang checklist yang sesuai.</div>
        <DocumentRow fieldKey="dokumen_kk_path" label="Kartu Keluarga" path={detail.dokumen_kk_path} />
        <DocumentRow fieldKey="dokumen_akta_path" label="Akta Kelahiran" path={detail.dokumen_akta_path} />
        {verification?.requirements.some((item) => ["dokumen_rapor_path", "dokumen_ijazah_path"].includes(item.key)) && (
          <>
            <DocumentRow fieldKey="dokumen_rapor_path" label="Rapor Siswa Pindahan" path={detail.dokumen_rapor_path} />
            <DocumentRow fieldKey="dokumen_ijazah_path" label="Ijazah/SKHUN Siswa Pindahan" path={detail.dokumen_ijazah_path} />
          </>
        )}
      </Section>
    </div>
    </ChecklistContext.Provider>
  );
}
