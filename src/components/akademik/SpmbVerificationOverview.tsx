import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type VerificationSummary = {
  status: "belum_verifikasi" | "terverifikasi" | "perlu_verifikasi_ulang";
  verified_at?: string | null;
  verified_by_name?: string | null;
  last_reason?: string | null;
};

type Row = {
  id: string;
  nama: string;
  status: string;
  verification: VerificationSummary;
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

function label(status: VerificationSummary["status"]) {
  if (status === "terverifikasi") return "Terverifikasi";
  if (status === "perlu_verifikasi_ulang") return "Perlu Verifikasi Ulang";
  return "Belum Diverifikasi";
}

export function SpmbVerificationOverview() {
  const navigate = useNavigate();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["spmb_verification_overview"],
    queryFn: async () => {
      const students = await fetchAllPages<any>((from, to) => supabase
        .from("siswa")
        .select("id,nama,status,created_at")
        .in("status", ["calon", "diterima"])
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to));
      if (!students.length) return [] as Row[];

      const { data: summaries, error: summaryError } = await (supabase as any).rpc("spmb_verification_state_list", {
        p_ids: students.map((student: any) => student.id),
      });
      if (summaryError) throw summaryError;
      const byId = new Map<string, VerificationSummary>((summaries || []).map((item: any) => [item.siswa_id, item.verification]));
      return students.map((student: any) => ({
        id: student.id,
        nama: student.nama,
        status: student.status,
        verification: byId.get(student.id) || { status: "belum_verifikasi" },
      })) as Row[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" />Status Verifikasi Data SPMB</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pemeriksaan dan eksekusi verifikasi dilakukan melalui Edit Siswa. Ringkasan ini hanya menampilkan status, petugas, dan waktu verifikasi.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat status verifikasi…</div>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">Status verifikasi tidak dapat dimuat: {error instanceof Error ? error.message : "Terjadi kesalahan."}</p>
        ) : data.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Belum ada calon murid pada daftar SPMB.</p>
        ) : (
          <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {data.map((row) => {
              const state = row.verification;
              const verified = state.status === "terverifikasi";
              const review = state.status === "perlu_verifikasi_ulang";
              return (
                <div key={row.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{row.nama}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${verified ? "border-success/30 bg-success/10 text-success" : review ? "border-warning/30 bg-warning/10 text-warning" : "text-muted-foreground"}`}>
                        {verified ? <CheckCircle2 className="h-3 w-3" /> : review ? <AlertTriangle className="h-3 w-3" /> : null}
                        {label(state.status)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Petugas: {state.verified_by_name || (verified ? "Riwayat lama/tidak tersedia" : "-")}</span>
                      <span>Waktu: {formatDateTime(state.verified_at)}</span>
                    </div>
                    {review && state.last_reason && <p className="mt-1 text-xs text-warning">{state.last_reason}</p>}
                  </div>
                  <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => navigate(`/akademik/siswa/${row.id}/edit`)}>
                    Periksa di Edit Siswa
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
