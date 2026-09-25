import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@/lib/router-compat";
import { ArrowLeft, CheckCircle2, ClipboardList, Pencil, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiswaSpmbDetail } from "@/components/akademik/SiswaSpmbDetail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatDateTime(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function sourceLabel(detail: Record<string, any> | null | undefined): string {
  if (detail?.spmb_metode_pendaftaran === "online") return "Online";
  if (detail?.spmb_metode_pendaftaran === "offline") return "Offline";
  if (detail?.spmb_sumber_pendaftaran === "publik") return "Online";
  if (detail?.spmb_sumber_pendaftaran === "admin") return "Offline";
  return "Belum diketahui";
}

function paymentLabel(readiness: Record<string, any> | null | undefined): string {
  if (!readiness) return "-";
  if (readiness.gratis_pendaftaran) return "Gratis";
  if (!readiness.configured) return "Belum diatur";
  if (readiness.lunas) return "Lunas";
  return "Belum bayar";
}

function graduationLabel(value: unknown): string {
  if (value === "lulus") return "Lulus";
  if (value === "tidak_lulus") return "Tidak Lulus";
  return "Belum ditentukan";
}

function registrationStatusLabel(value: unknown): string {
  if (value === "diterima") return "Diterima";
  if (value === "selesai") return "Selesai";
  return "Calon";
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{value || "-"}</div>
    </div>
  );
}

export default function DetailSPMB() {
  const { registrationId } = useParams<{ registrationId: string }>();
  const navigate = useNavigate();

  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ["spmb_registration_detail", registrationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("siswa_detail")
        .select("*")
        .eq("id", registrationId)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    },
    enabled: Boolean(registrationId),
  });

  const siswaId = detail?.siswa_id ? String(detail.siswa_id) : "";

  const { data: siswa, isLoading: siswaLoading } = useQuery({
    queryKey: ["siswa", "spmb-registration", siswaId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("siswa")
        .select("id,nama,nis,nisn,jenis_kelamin,telepon,email,status,created_at,departemen_id,angkatan_id,departemen:departemen_id(id,nama,kode),angkatan:angkatan_id(id,nama)")
        .eq("id", siswaId)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    },
    enabled: Boolean(siswaId),
  });

  const targetDeptId = detail?.spmb_departemen_tujuan_id || siswa?.departemen_id || "";
  const targetCohortId = detail?.spmb_angkatan_tujuan_id || siswa?.angkatan_id || "";

  const { data: target = {} } = useQuery({
    queryKey: ["spmb_registration_target", targetDeptId, targetCohortId],
    queryFn: async () => {
      const result: Record<string, any> = {};
      if (targetDeptId) {
        const { data, error } = await (supabase as any)
          .from("departemen")
          .select("id,nama,kode")
          .eq("id", targetDeptId)
          .maybeSingle();
        if (error) throw error;
        result.departemen = data;
      }
      if (targetCohortId) {
        const { data, error } = await (supabase as any)
          .from("angkatan")
          .select("id,nama")
          .eq("id", targetCohortId)
          .maybeSingle();
        if (error) throw error;
        result.angkatan = data;
      }
      return result;
    },
    enabled: Boolean(targetDeptId || targetCohortId),
  });

  const { data: readiness } = useQuery({
    queryKey: ["spmb_registration_readiness", siswaId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("spmb_readiness_list", { p_ids: [siswaId] });
      if (error) throw error;
      const row = (data || []).find((item: any) => String(item.siswa_id) === siswaId);
      return (row?.readiness || null) as Record<string, any> | null;
    },
    enabled: Boolean(siswaId),
  });

  if (detailLoading || (siswaId && siswaLoading)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (detailError || !detail || !siswa) {
    return (
      <div className="space-y-4 py-8">
        <Button variant="ghost" onClick={() => navigate("/akademik/spmb")}>
          <ArrowLeft className="mr-2 h-4 w-4" />Kembali ke SPMB
        </Button>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Pendaftaran SPMB tidak ditemukan atau tidak dapat diakses.</p>
            <p className="mt-1 text-sm text-muted-foreground">Pastikan pendaftaran masih berada dalam cakupan lembaga yang dapat Anda akses.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = detail.spmb_status_pendaftaran || (["calon", "diterima", "selesai"].includes(siswa.status) ? siswa.status : "calon");
  const targetDept = target.departemen || siswa.departemen;
  const targetCohort = target.angkatan || siswa.angkatan;
  const missingCount = Array.isArray(readiness?.kekurangan) ? readiness.kekurangan.length : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/akademik/spmb")} title="Kembali ke daftar SPMB">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm font-medium text-primary">Detail Pendaftaran SPMB</p>
            </div>
            <h1 className="mt-1 truncate text-2xl font-bold text-foreground">{siswa.nama}</h1>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">ID Pendaftaran: {registrationId}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/akademik/siswa/" + siswa.id)}>
            <UserRound className="mr-2 h-4 w-4" />Buka Data Siswa
          </Button>
          <Button size="sm" onClick={() => navigate("/akademik/siswa/" + siswa.id + "/edit")}>
            <Pencil className="mr-2 h-4 w-4" />Edit & Verifikasi
          </Button>
        </div>
      </div>

      {detail.spmb_siswa_internal === true && (
        <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm">
          <p className="font-medium text-info">Pendaftaran siswa internal</p>
          <p className="mt-1 text-muted-foreground">
            Halaman ini menampilkan proses SPMB tujuan. Data akademik aktif siswa tetap terpisah sampai proses perpindahan jenjang diselesaikan.
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ringkasan Pendaftaran</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Lembaga Tujuan" value={targetDept?.nama || targetDept?.kode || "-"} />
            <SummaryItem label="Angkatan Tujuan" value={targetCohort?.nama || "-"} />
            <SummaryItem label="Status Pendaftaran" value={registrationStatusLabel(status)} />
            <SummaryItem label="Metode Pendaftaran" value={sourceLabel(detail)} />
            <SummaryItem label="Tanggal Pendaftaran" value={formatDateTime(detail.spmb_registered_at || siswa.created_at)} />
            <SummaryItem label="Status Tes" value={detail.spmb_tanggal_tes ? "Sudah Tes" : "Belum Tes"} />
            <SummaryItem label="Kelulusan" value={graduationLabel(detail.spmb_status_kelulusan)} />
            <SummaryItem label="Daftar Ulang" value={detail.spmb_tanggal_daftar_ulang ? "Sudah Daftar Ulang" : "Belum Daftar Ulang"} />
            <SummaryItem label="Biaya Pendaftaran" value={paymentLabel(readiness)} />
            <SummaryItem
              label="Kesiapan Penerimaan"
              value={
                readiness?.siap
                  ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />Siap diterima</span>
                  : readiness
                    ? String(missingCount) + " data belum lengkap"
                    : "-"
              }
            />
            <SummaryItem label="Nama Pendaftar" value={detail.spmb_inputer_nama || "-"} />
            <SummaryItem label="NIS / NISN" value={(siswa.nis || "-") + " / " + (siswa.nisn || "-")} />
          </div>
        </CardContent>
      </Card>

      <SiswaSpmbDetail detail={detail} />
    </div>
  );
}
