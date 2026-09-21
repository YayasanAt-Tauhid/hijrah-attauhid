import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router-compat";
import { AlertTriangle, CheckCircle2, Eye, FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTahunAjaran } from "@/hooks/useAkademikData";
import { spmbGetDocumentUrl } from "@/server/spmbDocuments";
import { supabase } from "@/integrations/supabase/client";

type Detail = Record<string, any>;
type VerificationSummary = {
  status: "belum_verifikasi" | "terverifikasi" | "perlu_verifikasi_ulang";
  verified_at?: string | null;
  verified_by_name?: string | null;
  last_reason?: string | null;
  can_verify?: boolean;
};

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-sm">{display(value)}</span>
    </div>
  );
}

function DocumentRow({ label, path }: { label: string; path?: string | null }) {
  const [loading, setLoading] = useState(false);

  const openDocument = async () => {
    if (!path) return;
    setLoading(true);
    try {
      const { url } = await spmbGetDocumentUrl({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast.error("Dokumen tidak dapat dibuka", { description: error?.message || "Terjadi kesalahan saat membuat tautan dokumen." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{path ? "Dokumen tersedia" : "Belum diunggah"}</p>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={!path || loading} onClick={openDocument}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Buka Dokumen
      </Button>
    </div>
  );
}

function verificationLabel(status?: VerificationSummary["status"]) {
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "perlu_verifikasi_ulang") return "Perlu Verifikasi Ulang";
  return "Belum Diverifikasi";
}

export function SiswaSpmbDetail({ detail }: { detail: Detail | null | undefined }) {
  const navigate = useNavigate();
  const { data: tahunAjaranList = [] } = useTahunAjaran();
  const siswaId = detail?.siswa_id as string | undefined;

  const { data: verification, isLoading: verificationLoading } = useQuery({
    queryKey: ["spmb_verification_state", siswaId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("spmb_verification_state", { p_siswa_id: siswaId });
      if (error) throw error;
      return data as VerificationSummary;
    },
    enabled: Boolean(siswaId),
  });

  if (!detail || !siswaId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Belum ada data detail SPMB untuk siswa ini.</CardContent>
      </Card>
    );
  }

  const tahunAjaran = tahunAjaranList.find((item: any) => item.id === detail.tahun_ajaran_id)?.nama;
  const statusAsrama = detail.status_asrama === "asrama" ? "Asrama" : detail.status_asrama === "non_asrama" ? "Non Asrama" : "-";
  const verified = verification?.status === "terverifikasi";
  const needsReview = verification?.status === "perlu_verifikasi_ulang";

  return (
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
            <p className="mt-2 text-xs text-muted-foreground">Halaman detail hanya menampilkan hasil pemeriksaan. Checklist dan eksekusi verifikasi dilakukan dari Edit Siswa.</p>
          </div>
          {verification?.can_verify && (
            <Button type="button" className="min-h-11 shrink-0" onClick={() => navigate(`/akademik/siswa/${siswaId}/edit`)}>
              <ShieldCheck className="mr-2 h-4 w-4" />Periksa dan Verifikasi Data
            </Button>
          )}
        </CardContent>
      </Card>

      <Section title="Data Pendaftaran SPMB">
        <InfoRow label="Periode Tahun Ajaran" value={tahunAjaran || detail.tahun_ajaran_id} />
        <InfoRow label="Jenis Pendaftaran" value={detail.jenis_pendaftaran} />
        <InfoRow label="Kategori" value={detail.kategori} />
        <InfoRow label="NIK Hijrah" value={detail.nik} />
        <InfoRow label="NIK Dapodik" value={detail.nik_dapodik} />
        <InfoRow label="No. KK" value={detail.no_kk} />
        <InfoRow label="Asrama / Non Asrama" value={statusAsrama} />
        <InfoRow label="Anak ke" value={detail.anak_ke} />
        <InfoRow label="Dari Bersaudara" value={detail.jumlah_bersaudara} />
        <InfoRow label="Tinggi Badan" value={detail.tinggi_badan_cm ? `${detail.tinggi_badan_cm} cm` : null} />
        <InfoRow label="Berat Badan" value={detail.berat_badan_kg ? `${detail.berat_badan_kg} kg` : null} />
        <InfoRow label="Lingkar Kepala" value={detail.lingkar_kepala_cm ? `${detail.lingkar_kepala_cm} cm` : null} />
        <InfoRow label="Ukuran Baju" value={detail.ukuran_baju} />
        <InfoRow label="Penyakit yang Pernah Diderita" value={detail.penyakit_pernah_diderita} />
        <InfoRow label="Jarak Rumah ke Sekolah" value={detail.jarak_rumah_km !== null && detail.jarak_rumah_km !== undefined ? `${detail.jarak_rumah_km} km` : null} />
        <InfoRow label="Waktu Perjalanan" value={detail.waktu_perjalanan_menit !== null && detail.waktu_perjalanan_menit !== undefined ? `${detail.waktu_perjalanan_menit} menit` : null} />
        <InfoRow label="Transportasi" value={detail.transportasi} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Data Ayah">
          <InfoRow label="NIK Ayah" value={detail.nik_ayah} />
          <InfoRow label="Nama Ayah" value={detail.nama_ayah} />
          <InfoRow label="Tempat Lahir" value={detail.tempat_lahir_ayah} />
          <InfoRow label="Tanggal Lahir" value={detail.tanggal_lahir_ayah} />
          <InfoRow label="Pendidikan Terakhir" value={detail.pendidikan_ayah} />
          <InfoRow label="Pekerjaan" value={detail.pekerjaan_ayah} />
          <InfoRow label="Penghasilan" value={formatRupiah(detail.penghasilan_ayah)} />
          <InfoRow label="No. HP / WA" value={detail.telepon_ayah} />
          <InfoRow label="Alamat" value={detail.alamat_ayah} />
        </Section>

        <Section title="Data Ibu">
          <InfoRow label="NIK Ibu" value={detail.nik_ibu} />
          <InfoRow label="Nama Ibu" value={detail.nama_ibu} />
          <InfoRow label="Tempat Lahir" value={detail.tempat_lahir_ibu} />
          <InfoRow label="Tanggal Lahir" value={detail.tanggal_lahir_ibu} />
          <InfoRow label="Pendidikan Terakhir" value={detail.pendidikan_ibu} />
          <InfoRow label="Pekerjaan" value={detail.pekerjaan_ibu} />
          <InfoRow label="Penghasilan" value={formatRupiah(detail.penghasilan_ibu)} />
          <InfoRow label="No. HP / WA" value={detail.telepon_ibu} />
          <InfoRow label="Alamat" value={detail.alamat_ibu} />
        </Section>
      </div>

      <Section title="Data Sekolah Asal">
        <InfoRow label="Nama Sekolah Asal" value={detail.asal_sekolah} />
        <InfoRow label="Alamat Sekolah" value={detail.alamat_sekolah_asal} />
        <InfoRow label="Kabupaten/Kota" value={detail.kabupaten_sekolah_asal} />
        <InfoRow label="Kecamatan" value={detail.kecamatan_sekolah_asal} />
        <InfoRow label="Desa/Kelurahan" value={detail.kelurahan_sekolah_asal} />
        <InfoRow label="Kelas Terakhir" value={detail.kelas_terakhir} />
        <InfoRow label="Alasan Pindah" value={detail.alasan_pindah} />
      </Section>

      <Section title="Kemampuan Dasar Siswa">
        <InfoRow label="Kemampuan Dasar (Iqro)" value={IQRO_LABELS[String(detail.kemampuan_iqro)] || detail.kemampuan_iqro} />
        <InfoRow label="Membaca Latin" value={detail.membaca_latin} />
        <InfoRow label="Menulis Latin" value={detail.menulis_latin} />
        <InfoRow label="Hafalan Qur'an" value={HAFALAN_LABELS[String(detail.hafalan_quran)] || detail.hafalan_quran} />
      </Section>

      <Section title="Dokumen SPMB">
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FileText className="h-4 w-4" />Dokumen dapat dilihat dari halaman detail tanpa mengubah status pemeriksaan.</div>
        <DocumentRow label="Kartu Keluarga (wajib)" path={detail.dokumen_kk_path} />
        <DocumentRow label="Akta Kelahiran (wajib)" path={detail.dokumen_akta_path} />
        {(detail.kategori === "MURID PINDAHAN" || detail.jenis_pendaftaran === "pindahan") && (
          <>
            <DocumentRow label="Rapor Siswa Pindahan (wajib)" path={detail.dokumen_rapor_path} />
            <DocumentRow label="Ijazah/SKHUN Siswa Pindahan (wajib)" path={detail.dokumen_ijazah_path} />
          </>
        )}
      </Section>
    </div>
  );
}
