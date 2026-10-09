import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { MONITOR_STATUS_LABELS, jakartaDate, type PaymentScheme } from "@/lib/spmbPaymentMonitor";
import { getSpmbPaymentMonitor, saveSpmbMonitorEvent, type PaymentMonitorRow } from "@/server/spmbPaymentMonitor";
import { formatRupiah } from "@/hooks/useKeuangan";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

function dateLabel(value: string | null) {
  return value ? new Date(jakartaDate(value) + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }) : "—";
}
export default function MonitoringPembayaranSPMB() {
  const { role } = useAuth();
  if (!role || !["admin","keuangan","kasir"].includes(role)) return <Unauthorized />;
  return <PaymentMonitorContent role={role} />;
}
export function PaymentMonitorContent({ role }: { role: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedStudent = params.get("siswa");
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["spmb_payment_monitor"], queryFn: () => getSpmbPaymentMonitor(),
    refetchOnWindowFocus: true, refetchInterval: 60_000,
  });
  const rows = useMemo(() => query.data?.items || [], [query.data]);
  const [search, setSearch] = useState(requestedStudent || "");
  const [department, setDepartment] = useState("all");
  const [year, setYear] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<"skema" | "tindak_lanjut" | "perpanjangan">("tindak_lanjut");
  const [scheme, setScheme] = useState<PaymentScheme | "">("");
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");
  const selected = rows.find(row => row.id === selectedId);
  const editable = role !== "kasir";
  const historyAvailable = query.data?.historyAvailable !== false;
  const departments = useMemo(() => [...new Map(rows.filter(r => r.departemen_id)
    .map(r => [r.departemen_id as string,r.departemen_nama])).entries()].sort((a,b) => a[1].localeCompare(b[1])), [rows]);
  const years = useMemo(() => [...new Map(rows.filter(r => r.tahun_ajaran_id)
    .map(r => [r.tahun_ajaran_id as string,r.tahun_ajaran_nama])).entries()].sort((a,b) => b[1].localeCompare(a[1])), [rows]);
  useEffect(() => {
    if (requestedStudent && rows.length) {
      const row = rows.find(r => r.siswa_id === requestedStudent);
      if (row) setSearch(row.nama);
    }
  }, [rows, requestedStudent]);
  const scoped = rows.filter(row => (department === "all" || row.departemen_id === department)
    && (year === "all" || row.tahun_ajaran_id === year)
    && [row.nama,row.nis,row.siswa_id].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));
  const filtered = scoped.filter(row => {
    const p = row.progress;
    if (status === "terlambat") return p.overdueDays > 0;
    if (status === "mendekati") return p.nearDue;
    return status === "all" || p.status === status;
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Calon siswa tidak ditemukan");
      const detail = selected.registration;
      if (!detail.tahun_ajaran_id || !detail.spmb_departemen_tujuan_id
        || !detail.spmb_gelombang_id || !detail.spmb_registered_at)
        throw new Error("Lengkapi data pendaftaran terlebih dahulu");
      return saveSpmbMonitorEvent({ data: {
        detail_id: selected.id, tahun_ajaran_id: detail.tahun_ajaran_id,
        departemen_id: detail.spmb_departemen_tujuan_id, gelombang_id: detail.spmb_gelombang_id,
        registered_at: detail.spmb_registered_at, jenis: action,
        skema: action === "skema" && scheme ? scheme : null,
        tahap: action === "perpanjangan" ? selected.progress.stage : null,
        tenggat: action === "perpanjangan" ? deadline : null, catatan: note,
      } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["spmb_payment_monitor"] });
      setNote(""); setDeadline(""); toast.success("Catatan monitoring tersimpan");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const open = (row: PaymentMonitorRow) => {
    setSelectedId(row.id); setAction("tindak_lanjut"); setScheme(row.skema || ""); setDeadline(""); setNote("");
  };
  const columns: DataTableColumn<PaymentMonitorRow>[] = [
    { key: "nama", label: "Calon siswa", sortable: true, render: (_,row) => <div className="min-w-44">
      <p className="font-medium">{row.nama}</p>
      <p className="text-xs text-muted-foreground">{row.departemen_nama} · {row.tahun_ajaran_nama}</p>
      <p className="text-xs text-muted-foreground">{row.internal ? "Internal" : "Non internal"} · {row.status_asrama === "asrama" ? "Asrama" : row.status_asrama === "non_asrama" ? "Non asrama" : "Asrama belum diisi"}</p>
      <p className="text-xs text-muted-foreground">Lulus tes: {dateLabel(row.tanggal_lulus)}</p>
    </div> },
    { key: "total", label: "Uang pangkal", render: (_,row) => <div className="min-w-36 text-xs space-y-1">
      <p>Total: <strong>{formatRupiah(row.progress.total)}</strong></p>
      <p>Dibayar: {formatRupiah(row.progress.paid)}</p>
      <p>Sisa: {formatRupiah(row.progress.remaining)}</p>
    </div> },
    { key: "skema", label: "Status pembayaran", render: (_,row) => <div className="min-w-44 space-y-1">
      <Badge variant={row.progress.status === "lunas" ? "default" : "outline"}>{MONITOR_STATUS_LABELS[row.progress.status]}</Badge>
      <p className="text-xs text-muted-foreground">{row.skema === "cicilan" ? "Cicilan 25% / 25% / sisa" : row.skema === "lunas" ? "Sekaligus" : "Pilih sesuai kesepakatan"}</p>
      {row.unmatchedBills > 0 && <p className="text-xs text-amber-700">{row.unmatchedBills} tagihan tanpa tahun ajaran perlu verifikasi</p>}
    </div> },
    { key: "due", label: "Target berikutnya", render: (_,row) => <div className="min-w-36 text-xs space-y-1">
      {row.progress.due ? <>
        <p>{row.skema === "cicilan" ? "Cicilan " + row.progress.stage : "Pelunasan"}: <strong>{dateLabel(row.progress.due)}</strong></p>
        <p>Kekurangan: <strong>{formatRupiah(row.progress.shortage)}</strong></p>
        {row.progress.overdueDays > 0 ? <Badge variant="destructive">Terlambat {row.progress.overdueDays} hari</Badge>
          : row.progress.nearDue ? <Badge variant="outline">Segera jatuh tempo</Badge> : <p className="text-muted-foreground">Belum jatuh tempo</p>}
      </> : <span className="text-muted-foreground">—</span>}
    </div> },
    { key: "actions", label: "Tindakan", render: (_,row) => <Button size="sm" variant="outline" onClick={() => open(row)}>Detail dan catatan</Button> },
  ];
  const cards = [
    { key: "all", label: "Lulus tes", count: scoped.length },
    { key: "belum_bayar", label: "Belum bayar", count: scoped.filter(r => r.progress.status === "belum_bayar").length },
    { key: "terlambat", label: "Terlambat", count: scoped.filter(r => r.progress.overdueDays > 0).length },
    { key: "lunas", label: "Lunas", count: scoped.filter(r => r.progress.status === "lunas").length },
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Monitoring Pembayaran SPMB</h1>
        <p className="text-sm text-muted-foreground">Pantau uang pangkal calon siswa lulus tes, target pembayaran, dan tindak lanjut.</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Muat ulang</Button>
    </div>
    <p className="text-sm text-muted-foreground">Tenggat pertama 14 hari sejak lulus tes. Cicilan berikutnya 30 hari setelah cicilan sebelumnya memenuhi minimum.
      Skema dicatat sesuai kesepakatan per calon siswa. Pembayaran kasir dan portal dihitung dari transaksi berhasil yang terhubung ke tagihan tahun ajaran tujuan.</p>
    {query.isError && <Alert variant="destructive"><AlertDescription>Gagal memuat monitoring: {query.error.message}</AlertDescription></Alert>}
    {!historyAvailable && <Alert><AlertDescription>Penyimpanan skema dan catatan belum tersedia. Instalasi database monitoring perlu diselesaikan terlebih dahulu.</AlertDescription></Alert>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(card => <Card key={card.key}>
      <CardContent className="p-0"><button className={"w-full p-4 text-left rounded-lg " + (status === card.key ? "ring-2 ring-primary" : "")}
        onClick={() => setStatus(card.key)}><p className="text-sm text-muted-foreground">{card.label}</p><p className="text-2xl font-bold">{card.count}</p></button></CardContent>
    </Card>)}</div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input aria-label="Cari calon siswa" placeholder="Cari nama / NIS..." value={search} onChange={e => setSearch(e.target.value)} />
      <Select value={department} onValueChange={setDepartment}><SelectTrigger aria-label="Lembaga"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Semua lembaga</SelectItem>{departments.map(([id,name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select>
      <Select value={year} onValueChange={setYear}><SelectTrigger aria-label="Tahun ajaran"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Semua tahun ajaran</SelectItem>{years.map(([id,name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select>
      <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Status pembayaran"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Semua status</SelectItem><SelectItem value="terlambat">Terlambat</SelectItem><SelectItem value="mendekati">Jatuh tempo dalam 3 hari</SelectItem>
          {Object.entries(MONITOR_STATUS_LABELS).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
    </div>
    <p className="text-xs text-muted-foreground">{filtered.length} calon siswa ditampilkan · Status diterima tetap terpisah dari pembayaran.</p>
    {!query.isError && <DataTable columns={columns} data={filtered} loading={query.isLoading} searchable={false} horizontalNavigation pageSize={20}
      emptyMessage="Tidak ada calon siswa lulus tes yang sesuai filter." />}
    <Dialog open={Boolean(selected)} onOpenChange={value => { if (!value && !save.isPending) setSelectedId(null); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{selected?.nama}</DialogTitle>
          <DialogDescription>{selected?.departemen_nama} · {selected?.tahun_ajaran_nama}</DialogDescription></DialogHeader>
        {selected && <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <p>Lulus tes: <strong>{dateLabel(selected.tanggal_lulus)}</strong></p>
            <p>Total uang pangkal: <strong>{formatRupiah(selected.progress.total)}</strong></p>
            <p>Sudah dibayar: <strong>{formatRupiah(selected.progress.paid)}</strong></p>
            <p>Sisa: <strong>{formatRupiah(selected.progress.remaining)}</strong></p>
          </div>
          {selected.progress.due && <p className="text-sm">Target berikutnya: {formatRupiah(selected.progress.shortage)} paling lambat {dateLabel(selected.progress.due)}.
            {selected.progress.originalDue !== selected.progress.due && <> Tenggat awal: {dateLabel(selected.progress.originalDue)}.</>}</p>}
          {selected.unmatchedBills > 0 && <Alert><AlertDescription>Tagihan tanpa penanda tahun ajaran tidak dihitung. Verifikasi melalui data tagihan sebelum menghubungkannya ke penerimaan ini.</AlertDescription></Alert>}
          <div className="flex gap-2 flex-wrap">
            {editable && <Button variant="outline" onClick={() => navigate("/keuangan/rencana-siswa-baru?siswa=" + selected.siswa_id)}>Atur tagihan</Button>}
            <Button variant="outline" onClick={() => navigate("/keuangan/pembayaran")}>Buka kasir</Button>
          </div>
          <div className="space-y-3 border-t pt-4">
            <Label>Tindakan monitoring</Label>
            <Select value={action} onValueChange={value => { setAction(value as typeof action); setNote(""); setDeadline(""); }}>
              <SelectTrigger aria-label="Tindakan monitoring"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="tindak_lanjut">Catat tindak lanjut</SelectItem>
                {editable && <SelectItem value="skema">Catat / koreksi skema pembayaran</SelectItem>}
                {editable && selected.progress.due && <SelectItem value="perpanjangan">Perpanjang tenggat tahap berjalan</SelectItem>}
              </SelectContent>
            </Select>
            {action === "skema" && <>
              <Select value={scheme || undefined} onValueChange={value => setScheme(value as PaymentScheme)}>
                <SelectTrigger aria-label="Skema pembayaran"><SelectValue placeholder="Pilih sesuai kesepakatan orang tua" /></SelectTrigger><SelectContent>
                  <SelectItem value="lunas">Sekaligus — lunas dalam 14 hari</SelectItem>
                  <SelectItem value="cicilan">Cicilan — minimal 25%, minimal 25%, sisa</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Pilih hanya jika skema ini sesuai surat/kesepakatan calon siswa.
                Cicilan pertama minimal {formatRupiah(selected.progress.minimum)}; kedua minimal {formatRupiah(selected.progress.minimum)} dari total tagihan.
                Pembayaran pertama yang lebih besar mengurangi sisa cicilan terakhir. Koreksi skema menyimpan riwayat dan memerlukan perpanjangan baru bila ada.</p>
            </>}
            {action === "perpanjangan" && <div className="space-y-2"><Label htmlFor="monitor-deadline">Tenggat baru — tahap {selected.progress.stage}</Label>
              <Input id="monitor-deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
            </div>}
            <Label htmlFor="monitor-note">{action === "skema" ? "Dasar kesepakatan / alasan koreksi" : action === "perpanjangan" ? "Alasan perpanjangan" : "Catatan tindak lanjut"}</Label>
            <Textarea id="monitor-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Misalnya: orang tua dihubungi dan menyepakati..." />
            <Button onClick={() => save.mutate()} disabled={!historyAvailable || save.isPending || note.trim().length < 5
              || (action === "skema" && !scheme) || (action === "perpanjangan" && !deadline)}>
              {save.isPending ? "Menyimpan..." : "Simpan catatan"}</Button>
          </div>
          <div className="space-y-2 border-t pt-4"><h2 className="font-semibold">Riwayat monitoring</h2>
            {!selected.events.length && <p className="text-sm text-muted-foreground">Belum ada catatan untuk penerimaan ini.</p>}
            {selected.events.map(event => <div key={event.id} className="border-b pb-2 text-sm">
              <p className="font-medium">{event.jenis === "skema" ? "Skema: " + (event.skema === "lunas" ? "Sekaligus" : "Cicilan")
                : event.jenis === "perpanjangan" ? "Perpanjangan tahap " + event.tahap + ": " + dateLabel(event.tenggat) : "Tindak lanjut"}
                <span className="ml-2 text-xs text-muted-foreground">{dateLabel(event.created_at)}</span></p>
              <p className="whitespace-pre-wrap">{event.catatan}</p>
            </div>)}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
