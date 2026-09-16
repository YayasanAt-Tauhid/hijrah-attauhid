import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, CheckCircle2, FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useTahunAjaran } from "@/hooks/useAkademikData";
import { spmbGetDocumentUrl } from "@/server/spmbDocuments";
import { supabase } from "@/integrations/supabase/client";

type Detail = Record<string, any>;

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

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function formatRupiah(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return display(value);
  return `Rp ${number.toLocaleString("id-ID")}`;
}

function ChecklistButton({ checked, disabled, busy, onClick }: {
  checked: boolean;
  disabled?: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={checked ? "default" : "outline"}
      className="h-8 w-8 shrink-0"
      disabled={disabled || busy}
      onClick={onClick}
      title={disabled ? "Belum ada nilai yang dapat diverifikasi" : checked ? "Batalkan checklist verifikasi" : "Tandai nilai sudah diperiksa"}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : checked ? <CheckCircle2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
    </Button>
  );
}

function InfoRow({ fieldKey, label, value, checked, busy, onToggle }: {
  fieldKey: string;
  label: string;
  value: unknown;
  checked: boolean;
  busy: boolean;
  onToggle: (fieldKey: string, checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm sm:col-auto">{display(value)}</span>
      <ChecklistButton checked={checked} disabled={!hasValue(value)} busy={busy} onClick={() => onToggle(fieldKey, !checked)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DocumentButton({ fieldKey, label, path, checked, verifyBusy, onToggle }: {
  fieldKey: string;
  label: string;
  path: string | null | undefined;
  checked: boolean;
  verifyBusy: boolean;
  onToggle: (fieldKey: string, checked: boolean) => void;
}) {
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
    <div className="flex items-center justify-between gap-3 border-b py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{path ? "Dokumen tersedia" : "Belum diunggah"}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!path || loading} onClick={openDocument}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          Buka
        </Button>
        <ChecklistButton checked={checked} disabled={!path} busy={verifyBusy} onClick={() => onToggle(fieldKey, !checked)} />
      </div>
    </div>
  );
}

export function SiswaSpmbDetail({ detail }: { detail: Detail | null | undefined }) {
  const { data: tahunAjaranList = [] } = useTahunAjaran();
  const qc = useQueryClient();
  const [busyField, setBusyField] = useState<string | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const siswaId = detail?.siswa_id as string | undefined;
  const { data: verificationStatus } = useQuery({
    queryKey: ["siswa_spmb_verification", siswaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("siswa").select("terverifikasi").eq("id", siswaId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!siswaId,
  });

  if (!detail || !siswaId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Belum ada data detail SPMB untuk siswa ini.</CardContent>
      </Card>
    );
  }

  const verified = !!verificationStatus?.terverifikasi;
  const verificationMap = detail.spmb_verifikasi_fields && typeof detail.spmb_verifikasi_fields === "object"
    ? detail.spmb_verifikasi_fields as Record<string, boolean>
    : {};

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["siswa_detail", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa_spmb_verification", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
    ]);
  };

  const toggleVerification = async (fieldKey: string, checked: boolean) => {
    setBusyField(fieldKey);
    try {
      const { error } = await (supabase as any).rpc("spmb_set_field_verification", {
        p_siswa_id: siswaId,
        p_field: fieldKey,
        p_checked: checked,
      });
      if (error) throw error;
      await refresh();
    } catch (error: any) {
      toast.error("Checklist tidak dapat disimpan", { description: error?.message || "Terjadi kesalahan." });
    } finally {
      setBusyField(null);
    }
  };

  const verifyRegistration = async () => {
    setVerifyingAll(true);
    try {
      const { error } = await supabase.from("siswa").update({ terverifikasi: true } as any).eq("id", siswaId);
      if (error) throw error;
      await refresh();
      toast.success("Data SPMB berhasil diverifikasi");
    } catch (error: any) {
      toast.error("Gagal memverifikasi data SPMB", { description: error?.message || "Terjadi kesalahan." });
    } finally {
      setVerifyingAll(false);
    }
  };

  const row = (fieldKey: string, label: string, value: unknown) => (
    <InfoRow fieldKey={fieldKey} label={label} value={value} checked={verificationMap[fieldKey] === true} busy={busyField === fieldKey} onToggle={toggleVerification} />
  );

  const tahunAjaran = tahunAjaranList.find((item: any) => item.id === detail.tahun_ajaran_id)?.nama;
  const statusAsrama = detail.status_asrama === "asrama" ? "Asrama" : detail.status_asrama === "non_asrama" ? "Non Asrama" : "-";

  return (
    <div className="space-y-4">
      <Card className={verified ? "border-emerald-200 bg-emerald-50/40" : undefined}>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Verifikasi Data SPMB</p>
            <p className="text-sm text-muted-foreground">Gunakan tombol checklist di setiap nilai setelah dicocokkan dengan dokumen atau data pendaftar.</p>
          </div>
          <Button type="button" onClick={verifyRegistration} disabled={verified || verifyingAll} className="shrink-0">
            {verifyingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : verified ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {verified ? "Sudah Terverifikasi" : "Verifikasi Data SPMB"}
          </Button>
        </CardContent>
      </Card>

      <Section title="Data Pendaftaran SPMB">
        {row("tahun_ajaran_id", "Periode Tahun Ajaran", tahunAjaran || detail.tahun_ajaran_id)}
        {row("jenis_pendaftaran", "Jenis Pendaftaran", detail.jenis_pendaftaran)}
        {row("kategori", "Kategori", detail.kategori)}
        {row("nik", "NIK", detail.nik)}
        {row("no_kk", "No. KK", detail.no_kk)}
        {row("status_asrama", "Asrama / Non Asrama", statusAsrama)}
        {row("anak_ke", "Anak ke", detail.anak_ke)}
        {row("jumlah_bersaudara", "Dari Bersaudara", detail.jumlah_bersaudara)}
        {row("tinggi_badan_cm", "Tinggi Badan", detail.tinggi_badan_cm ? `${detail.tinggi_badan_cm} cm` : null)}
        {row("berat_badan_kg", "Berat Badan", detail.berat_badan_kg ? `${detail.berat_badan_kg} kg` : null)}
        {row("lingkar_kepala_cm", "Lingkar Kepala", detail.lingkar_kepala_cm ? `${detail.lingkar_kepala_cm} cm` : null)}
        {row("ukuran_baju", "Ukuran Baju", detail.ukuran_baju)}
        {row("penyakit_pernah_diderita", "Penyakit yang Pernah Diderita", detail.penyakit_pernah_diderita)}
        {row("jarak_rumah_km", "Jarak Rumah ke Sekolah", detail.jarak_rumah_km !== null && detail.jarak_rumah_km !== undefined ? `${detail.jarak_rumah_km} km` : null)}
        {row("waktu_perjalanan_menit", "Waktu Perjalanan", detail.waktu_perjalanan_menit !== null && detail.waktu_perjalanan_menit !== undefined ? `${detail.waktu_perjalanan_menit} menit` : null)}
        {row("transportasi", "Transportasi", detail.transportasi)}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Data Ayah">
          {row("nik_ayah", "NIK Ayah", detail.nik_ayah)}
          {row("nama_ayah", "Nama Ayah", detail.nama_ayah)}
          {row("tempat_lahir_ayah", "Tempat Lahir", detail.tempat_lahir_ayah)}
          {row("tanggal_lahir_ayah", "Tanggal Lahir", detail.tanggal_lahir_ayah)}
          {row("pendidikan_ayah", "Pendidikan Terakhir", detail.pendidikan_ayah)}
          {row("pekerjaan_ayah", "Pekerjaan", detail.pekerjaan_ayah)}
          {row("penghasilan_ayah", "Penghasilan", formatRupiah(detail.penghasilan_ayah))}
          {row("telepon_ayah", "No. HP / WA", detail.telepon_ayah)}
          {row("alamat_ayah", "Alamat", detail.alamat_ayah)}
        </Section>

        <Section title="Data Ibu">
          {row("nik_ibu", "NIK Ibu", detail.nik_ibu)}
          {row("nama_ibu", "Nama Ibu", detail.nama_ibu)}
          {row("tempat_lahir_ibu", "Tempat Lahir", detail.tempat_lahir_ibu)}
          {row("tanggal_lahir_ibu", "Tanggal Lahir", detail.tanggal_lahir_ibu)}
          {row("pendidikan_ibu", "Pendidikan Terakhir", detail.pendidikan_ibu)}
          {row("pekerjaan_ibu", "Pekerjaan", detail.pekerjaan_ibu)}
          {row("penghasilan_ibu", "Penghasilan", formatRupiah(detail.penghasilan_ibu))}
          {row("telepon_ibu", "No. HP / WA", detail.telepon_ibu)}
          {row("alamat_ibu", "Alamat", detail.alamat_ibu)}
        </Section>
      </div>

      <Section title="Data Sekolah Asal">
        {row("asal_sekolah", "Nama Sekolah Asal", detail.asal_sekolah)}
        {row("alamat_sekolah_asal", "Alamat Sekolah", detail.alamat_sekolah_asal)}
        {row("kabupaten_sekolah_asal", "Kabupaten/Kota", detail.kabupaten_sekolah_asal)}
        {row("kecamatan_sekolah_asal", "Kecamatan", detail.kecamatan_sekolah_asal)}
        {row("kelurahan_sekolah_asal", "Desa/Kelurahan", detail.kelurahan_sekolah_asal)}
        {row("kelas_terakhir", "Kelas Terakhir", detail.kelas_terakhir)}
        {row("alasan_pindah", "Alasan Pindah", detail.alasan_pindah)}
      </Section>

      <Section title="Kemampuan Dasar Siswa">
        {row("kemampuan_iqro", "Kemampuan Dasar (Iqro)", IQRO_LABELS[String(detail.kemampuan_iqro)] || detail.kemampuan_iqro)}
        {row("membaca_latin", "Membaca Latin", detail.membaca_latin)}
        {row("menulis_latin", "Menulis Latin", detail.menulis_latin)}
        {row("hafalan_quran", "Hafalan Qur'an", HAFALAN_LABELS[String(detail.hafalan_quran)] || detail.hafalan_quran)}
      </Section>

      <Section title="Dokumen Persyaratan SPMB">
        <DocumentButton fieldKey="dokumen_kk_path" label="Kartu Keluarga" path={detail.dokumen_kk_path} checked={verificationMap.dokumen_kk_path === true} verifyBusy={busyField === "dokumen_kk_path"} onToggle={toggleVerification} />
        <DocumentButton fieldKey="dokumen_akta_path" label="Akta Kelahiran" path={detail.dokumen_akta_path} checked={verificationMap.dokumen_akta_path === true} verifyBusy={busyField === "dokumen_akta_path"} onToggle={toggleVerification} />
        <DocumentButton fieldKey="dokumen_rapor_path" label="Rapor" path={detail.dokumen_rapor_path} checked={verificationMap.dokumen_rapor_path === true} verifyBusy={busyField === "dokumen_rapor_path"} onToggle={toggleVerification} />
        <DocumentButton fieldKey="dokumen_ijazah_path" label="Ijazah / SKHUN" path={detail.dokumen_ijazah_path} checked={verificationMap.dokumen_ijazah_path === true} verifyBusy={busyField === "dokumen_ijazah_path"} onToggle={toggleVerification} />
      </Section>
    </div>
  );
}
