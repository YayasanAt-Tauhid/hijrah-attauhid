import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { spmbGetDocumentUrl } from "@/server/spmbDocuments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type VerificationRequirement = {
  key: string;
  label: string;
  kind: "field" | "document";
  required: boolean;
  valid: boolean;
  display_value?: string | null;
  path?: string | null;
};

type VerificationHistory = {
  status: "terverifikasi" | "perlu_verifikasi_ulang";
  created_at: string;
  petugas?: string | null;
  reason?: string | null;
};

type VerificationState = {
  siswa_id: string;
  student_status: string;
  status: "belum_verifikasi" | "terverifikasi" | "perlu_verifikasi_ulang";
  version: string;
  verified_version?: string | null;
  verified_at?: string | null;
  verified_by_name?: string | null;
  last_reason?: string | null;
  can_verify: boolean;
  can_submit: boolean;
  data_current: boolean;
  checklist: Record<string, boolean>;
  requirements: VerificationRequirement[];
  required_total: number;
  required_checked: number;
  invalid_required: string[];
  unchecked_required: string[];
  history: VerificationHistory[];
};

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

function statusLabel(status: VerificationState["status"]) {
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "perlu_verifikasi_ulang") return "Perlu Verifikasi Ulang";
  return "Belum Diverifikasi";
}

function statusClass(status: VerificationState["status"]) {
  if (status === "terverifikasi") return "border-success/30 bg-success/5";
  if (status === "perlu_verifikasi_ulang") return "border-warning/40 bg-warning/5";
  return "border-muted bg-muted/20";
}

export function SpmbVerificationPanel({ siswaId, isDirty = false }: { siswaId: string; isDirty?: boolean }) {
  const qc = useQueryClient();
  const [busyField, setBusyField] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openingDocument, setOpeningDocument] = useState<string | null>(null);

  const stateQuery = useQuery({
    queryKey: ["spmb_verification_state", siswaId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("spmb_verification_state", { p_siswa_id: siswaId });
      if (error) throw error;
      return data as VerificationState;
    },
    enabled: Boolean(siswaId),
  });

  const state = stateQuery.data;
  const requiredItems = (state?.requirements || []).filter((item) => item.required);
  const optionalDocuments = (state?.requirements || []).filter((item) => !item.required && item.kind === "document");
  const alreadyVerifiedCurrent = state?.status === "terverifikasi" && state.data_current;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["spmb_verification_state", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa_detail", siswaId] }),
      qc.invalidateQueries({ queryKey: ["siswa", "calon"] }),
    ]);
  };

  const openDocument = async (item: VerificationRequirement) => {
    if (!item.path) return;
    setOpeningDocument(item.key);
    try {
      const { url } = await spmbGetDocumentUrl({ data: { path: item.path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast.error("Dokumen tidak dapat dibuka", { description: error?.message || "Gagal membuat tautan dokumen." });
    } finally {
      setOpeningDocument(null);
    }
  };

  const toggleChecklist = async (item: VerificationRequirement, checked: boolean) => {
    if (!state || isDirty || !state.can_verify || busyField || verifying) return;
    setBusyField(item.key);
    try {
      const { error } = await (supabase as any).rpc("spmb_set_field_verification", {
        p_siswa_id: siswaId,
        p_field: item.key,
        p_checked: checked,
        p_version: state.version,
      });
      if (error) throw error;
      await refresh();
    } catch (error: any) {
      toast.error("Checklist tidak dapat disimpan", {
        description: error?.message || "Data mungkin telah berubah. Muat ulang dan periksa kembali.",
      });
      await refresh();
    } finally {
      setBusyField(null);
    }
  };

  const verify = async () => {
    if (!state || isDirty || verifying || !state.can_submit || alreadyVerifiedCurrent) return;
    setConfirmOpen(false);
    setVerifying(true);
    try {
      const { error } = await (supabase as any).rpc("spmb_mark_verified", {
        p_siswa_id: siswaId,
        p_version: state.version,
      });
      if (error) throw error;
      await refresh();
      toast.success("Data SPMB berhasil diverifikasi", {
        description: "Verifikasi data tidak mengubah kelulusan, pembayaran, atau keaktifan siswa.",
      });
    } catch (error: any) {
      toast.error("Verifikasi Data SPMB gagal", {
        description: error?.message || "Periksa kembali data, dokumen, dan checklist lalu coba lagi.",
      });
      await refresh();
    } finally {
      setVerifying(false);
    }
  };

  if (stateQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Memuat pemeriksaan data SPMB…
        </CardContent>
      </Card>
    );
  }

  if (stateQuery.error || !state) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-6 text-sm text-destructive">
          Pemeriksaan Data SPMB tidak dapat dimuat. {stateQuery.error instanceof Error ? stateQuery.error.message : ""}
        </CardContent>
      </Card>
    );
  }

  if (!state.can_verify) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Pemeriksaan Data SPMB</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Akun ini tidak memiliki kewenangan untuk melakukan verifikasi data SPMB.
        </CardContent>
      </Card>
    );
  }

  const blockedReasons: string[] = [];
  if (isDirty) blockedReasons.push("Simpan perubahan terlebih dahulu sebelum memverifikasi data.");
  if (state.invalid_required.length) blockedReasons.push(`${state.invalid_required.length} data/dokumen wajib masih kosong atau tidak valid.`);
  if (state.required_checked < state.required_total) blockedReasons.push(`${state.required_total - state.required_checked} pemeriksaan wajib belum dicentang.`);
  if (!["calon", "diterima", "aktif"].includes(state.student_status)) blockedReasons.push("Status siswa saat ini tidak dapat menjalankan verifikasi SPMB.");

  return (
    <Card className={statusClass(state.status)}>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" />Pemeriksaan Data SPMB</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Checklist adalah konfirmasi bahwa petugas telah memeriksa data tersimpan dan dokumen terkait. Checklist tidak dicentang otomatis.
            </p>
          </div>
          <div className="shrink-0 rounded-md border bg-background/70 px-3 py-2 text-sm">
            <p className="font-medium">{statusLabel(state.status)}</p>
            {state.verified_at && <p className="text-xs text-muted-foreground">{formatDateTime(state.verified_at)}</p>}
            {state.verified_by_name && <p className="text-xs text-muted-foreground">Petugas: {state.verified_by_name}</p>}
          </div>
        </div>
        {state.status === "perlu_verifikasi_ulang" && state.last_reason && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.last_reason}</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-background/70 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Checklist wajib</p>
              <p className="text-sm text-muted-foreground">{state.required_checked} dari {state.required_total} pemeriksaan selesai</p>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-xs">Versi data: {state.version.slice(0, 8)}</span>
          </div>

          <div className="divide-y">
            {requiredItems.map((item) => {
              const checked = state.checklist?.[item.key] === true;
              const disabled = isDirty || Boolean(busyField) || verifying;
              return (
                <div key={item.key} className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <Checkbox
                    id={`spmb-check-${item.key}`}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) => toggleChecklist(item, value === true)}
                    aria-label={`Konfirmasi pemeriksaan ${item.label}`}
                  />
                  <label htmlFor={`spmb-check-${item.key}`} className={disabled ? "min-w-0 cursor-not-allowed" : "min-w-0 cursor-pointer"}>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block break-words text-xs text-muted-foreground">{item.display_value || "-"}</span>
                    {!item.valid && <span className="mt-1 block text-xs font-medium text-destructive">Data wajib belum tersedia atau tidak valid.</span>}
                  </label>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {item.kind === "document" && (
                      <Button type="button" size="sm" variant="outline" disabled={!item.path || openingDocument === item.key} onClick={() => openDocument(item)}>
                        {openingDocument === item.key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}Lihat
                      </Button>
                    )}
                    {busyField === item.key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {checked && !busyField && <CheckCircle2 className="h-4 w-4 text-success" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {optionalDocuments.length > 0 && (
          <div className="rounded-lg border bg-background/70 p-4">
            <div className="mb-2 flex items-center gap-2"><FileCheck2 className="h-4 w-4" /><p className="font-medium">Dokumen opsional</p></div>
            <p className="mb-3 text-xs text-muted-foreground">Rapor dan Ijazah/SKHUN tidak menghalangi verifikasi bila memang belum diwajibkan pada tahap pendaftaran.</p>
            <div className="divide-y">
              {optionalDocuments.map((item) => (
                <div key={item.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.display_value}</p></div>
                  <Button type="button" size="sm" variant="outline" disabled={!item.path || openingDocument === item.key} onClick={() => openDocument(item)}>
                    {openingDocument === item.key ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}Lihat
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {blockedReasons.length > 0 && !alreadyVerifiedCurrent && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Verifikasi belum dapat dilakukan</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Aksi ini hanya memverifikasi kesesuaian data/dokumen, bukan menyatakan lulus atau membuktikan pembayaran.</p>
          <Button
            type="button"
            disabled={isDirty || !state.can_submit || verifying || Boolean(busyField) || alreadyVerifiedCurrent}
            onClick={() => setConfirmOpen(true)}
            className="min-h-11 sm:shrink-0"
          >
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {alreadyVerifiedCurrent ? "Sudah Terverifikasi" : "Verifikasi Data SPMB"}
          </Button>
        </div>

        {state.history.length > 0 && (
          <details className="rounded-lg border bg-background/60 p-4">
            <summary className="cursor-pointer text-sm font-medium">Riwayat verifikasi ({state.history.length})</summary>
            <div className="mt-3 space-y-2">
              {state.history.map((entry, index) => (
                <div key={`${entry.created_at}-${index}`} className="rounded-md border p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{entry.status === "terverifikasi" ? "Terverifikasi" : "Perlu Verifikasi Ulang"}</strong>
                    <span className="text-muted-foreground">{formatDateTime(entry.created_at)}</span>
                  </div>
                  {entry.petugas && <p className="mt-1 text-muted-foreground">Petugas: {entry.petugas}</p>}
                  {entry.reason && <p className="mt-1 text-muted-foreground">{entry.reason}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verifikasi Data SPMB?</AlertDialogTitle>
            <AlertDialogDescription>
              Pastikan Anda telah memeriksa kelengkapan dan kesesuaian data tersimpan beserta dokumen wajib. Verifikasi ini tidak menyatakan kelulusan dan tidak menjadi bukti pembayaran.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={verifying}>Periksa Lagi</AlertDialogCancel>
            <AlertDialogAction disabled={verifying} onClick={(event) => { event.preventDefault(); void verify(); }}>
              Ya, Verifikasi Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
