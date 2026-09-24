import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type SpmbVerificationState,
  useRefreshSpmbVerification,
  useSpmbVerificationState,
} from "@/hooks/useSpmbVerification";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function statusLabel(status: SpmbVerificationState["status"]) {
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "perlu_verifikasi_ulang") return "Perlu Verifikasi Ulang";
  return "Belum Diverifikasi";
}

function statusClass(status: SpmbVerificationState["status"]) {
  if (status === "terverifikasi") return "border-success/30 bg-success/5";
  if (status === "perlu_verifikasi_ulang") return "border-warning/40 bg-warning/5";
  return "border-muted bg-muted/20";
}

export function SpmbVerificationPanel({ siswaId, isDirty = false }: { siswaId: string; isDirty?: boolean }) {
  const [verifying, setVerifying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stateQuery = useSpmbVerificationState(siswaId);
  const refresh = useRefreshSpmbVerification(siswaId);
  const state = stateQuery.data;
  const alreadyVerifiedCurrent = state?.status === "terverifikasi" && state.data_current;

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
  if (isDirty) blockedReasons.push("Simpan perubahan data dan checklist terlebih dahulu.");
  if (state.invalid_required.length) blockedReasons.push(`${state.invalid_required.length} data/dokumen wajib masih kosong atau tidak valid.`);
  if (state.required_checked < state.required_total) blockedReasons.push(`${state.required_total - state.required_checked} pemeriksaan wajib belum dicentang.`);
  if (!["calon", "diterima", "aktif"].includes(state.student_status)) blockedReasons.push("Status siswa saat ini tidak dapat menjalankan verifikasi SPMB.");

  return (
    <Card className={statusClass(state.status)}>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5" />Pemeriksaan Data SPMB
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Checklist wajib hanya untuk data inti yang dapat dicocokkan dengan Kartu Keluarga. Data dan dokumen lainnya tetap dapat diperiksa sebagai informasi opsional.
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Progres pemeriksaan tersimpan</p>
              <p className="text-sm text-muted-foreground">
                {state.required_checked} dari {state.required_total} pemeriksaan wajib selesai
              </p>
            </div>
            <span className="w-fit rounded-full border px-2.5 py-1 text-xs">Versi data: {state.version.slice(0, 8)}</span>
          </div>
        </div>

        {blockedReasons.length > 0 && !alreadyVerifiedCurrent && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Verifikasi belum dapat dilakukan</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Aksi ini memverifikasi kesesuaian data inti dengan Kartu Keluarga, bukan menyatakan lulus, membuktikan pembayaran, atau mengaktifkan siswa.
          </p>
          <Button
            type="button"
            disabled={isDirty || !state.can_submit || verifying || alreadyVerifiedCurrent}
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
              Pastikan semua perubahan sudah disimpan dan seluruh checklist wajib berdasarkan Kartu Keluarga sudah selesai. Data lain boleh dilengkapi kemudian dan tidak menghalangi verifikasi.
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
