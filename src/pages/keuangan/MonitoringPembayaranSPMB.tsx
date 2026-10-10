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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import Unauthorized from "@/pages/Unauthorized";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { MONITOR_PAYMENT_LABELS, MONITOR_READINESS_LABELS, monitorPaymentStatus, monitorReadiness, jakartaDate, type PaymentScheme } from "@/lib/spmbPaymentMonitor";
import { getSpmbPaymentMonitor, saveSpmbMonitorEvent, type PaymentMonitorRow } from "@/server/spmbPaymentMonitor";
import { formatRupiah } from "@/hooks/useKeuangan";
import { RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

function dateLabel(value: string | null) {
  return value ? new Date(jakartaDate(value) + "T00:00:00Z").toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }) : "—";
}
function MonitorIdentity({ row }: { row: PaymentMonitorRow }) {
  const boardingRelevant = /^(SMP|SMA|MTA)$/i.test(row.departemen_nama.trim());
  return <div className="min-w-0 space-y-1">
    <p className="font-semibold break-words">{row.nama}</p>
    <p className="text-xs text-muted-foreground">{row.departemen_nama} · {row.tahun_ajaran_nama}</p>
    <p className="text-xs text-muted-foreground">{row.internal ? "Internal" : "Eksternal"}
      {boardingRelevant && <> · {row.status_asrama === "asrama" ? "Asrama" : row.status_asrama === "non_asrama" ? "Non asrama" : "Asrama belum diisi"}</>}</p>
    <p className="text-xs text-muted-foreground">Lulus tes: {dateLabel(row.tanggal_lulus)}</p>
  </div>;
}
function MonitorAmounts({ row }: { row: PaymentMonitorRow }) {
  if (row.progress.status === "belum_ada_tagihan") return <p className="text-sm text-muted-foreground">Tagihan belum dibuat</p>;
  if (row.progress.status === "perlu_verifikasi") return <p className="text-sm text-amber-700">Nominal perlu diverifikasi</p>;
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
    <dt className="text-muted-foreground">Total</dt><dd className="text-right font-medium">{formatRupiah(row.progress.total)}</dd>
    <dt className="text-muted-foreground">Dibayar</dt><dd className="text-right">{formatRupiah(row.progress.paid)}</dd>
    <dt className="text-muted-foreground">Sisa</dt><dd className="text-right font-semibold">{formatRupiah(row.progress.remaining)}</dd>
  </dl>;
}
function MonitorPayment({ row }: { row: PaymentMonitorRow }) {
  const payment = monitorPaymentStatus(row.progress);
  return <div className="space-y-1">
    <Badge variant={payment === "lunas" ? "default" : "outline"}>{MONITOR_PAYMENT_LABELS[payment]}</Badge>
    {payment === "lunas" ? <p className="text-xs text-muted-foreground">{row.progress.total === 0 ? "Tidak ada sisa setelah keringanan" : "Pembayaran selesai"}</p>
      : row.skema && <p className="text-xs text-muted-foreground">{row.skema === "cicilan" ? "Cicilan 25% / 25% / sisa" : "Sekaligus"}</p>}
    {row.progress.status === "kurang_minimum" && <p className="text-xs text-amber-700">Cicilan pertama belum mencapai minimum</p>}
  </div>;
}
function MonitorReadiness({ row }: { row: PaymentMonitorRow }) {
  const readiness = monitorReadiness(row.progress);
  return <div className="space-y-1">
    <span className={"text-sm " + (readiness === "siap" ? "text-muted-foreground" : "font-medium text-amber-700")}>{MONITOR_READINESS_LABELS[readiness]}</span>
    {row.unmatchedBills > 0 && <p className="text-xs text-amber-700">{row.unmatchedBills} tagihan tanpa tahun ajaran perlu verifikasi</p>}
  </div>;
}
function MonitorTarget({ row }: { row: PaymentMonitorRow }) {
  const p = row.progress;
  if (!p.due) return <p className="text-xs text-muted-foreground">{p.status === "lunas" ? "Selesai"
    : p.status === "belum_diatur" ? "Tenggat menunggu kesepakatan skema"
    : p.status === "belum_ada_tagihan" ? "Buat tagihan terlebih dahulu" : "Verifikasi data terlebih dahulu"}</p>;
  return <div className="space-y-1 text-xs">
    <p>{row.skema === "cicilan" ? "Cicilan " + p.stage : "Pelunasan"}: <strong>{dateLabel(p.due)}</strong></p>
    <p>Kurang <strong>{formatRupiah(p.shortage)}</strong></p>
    {p.overdueDays > 0 ? <Badge variant="destructive">Terlambat {p.overdueDays} hari</Badge>
      : p.nearDue ? <Badge variant="outline">Segera jatuh tempo</Badge> : <p className="text-muted-foreground">Belum jatuh tempo</p>}
  </div>;
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
  const [readiness, setReadiness] = useState("all");
  const [urgency, setUrgency] = useState("all");
  const [page, setPage] = useState(0);
  const [nameOrder, setNameOrder] = useState<"asc" | "desc" | null>(null);
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
  const filtered = useMemo(() => {
    const result = scoped.filter(row => (status === "all" || monitorPaymentStatus(row.progress) === status)
      && (readiness === "all" || monitorReadiness(row.progress) === readiness)
      && (urgency === "all" || (urgency === "terlambat" ? row.progress.overdueDays > 0 : row.progress.nearDue)));
    return nameOrder ? result.sort((a,b) => (nameOrder === "asc" ? 1 : -1) * a.nama.localeCompare(b.nama, "id")) : result;
  }, [scoped, status, readiness, urgency, nameOrder]);
  useEffect(() => { setPage(0); }, [search, department, year, status, readiness, urgency, nameOrder]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  const filtersActive = Boolean(search || department !== "all" || year !== "all" || status !== "all" || readiness !== "all" || urgency !== "all");
  const resetFilters = () => { setSearch(""); setDepartment("all"); setYear("all"); setStatus("all"); setReadiness("all"); setUrgency("all"); setPage(0); };
  const showGroup = (key: string, group: "payment" | "readiness" | "urgency") => {
    setStatus(group === "payment" ? key : "all");
    setReadiness(group === "readiness" ? key : "all");
    setUrgency(group === "urgency" ? key : "all");
  };
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
  const open = (row: PaymentMonitorRow, nextAction: typeof action = "tindak_lanjut") => {
    setSelectedId(row.id); setAction(nextAction); setScheme(row.skema || ""); setDeadline(""); setNote("");
  };
  const rowActions = (row: PaymentMonitorRow) => <div className="flex flex-wrap gap-2">
    {editable && row.progress.status === "belum_diatur" && <Button size="sm" disabled={!historyAvailable} onClick={() => open(row, "skema")}>Tentukan skema</Button>}
    {editable && row.progress.status === "belum_ada_tagihan" && <Button size="sm" onClick={() => navigate("/keuangan/rencana-siswa-baru?siswa=" + row.siswa_id)}>Buat tagihan</Button>}
    {editable && row.progress.status === "perlu_verifikasi" && <Button size="sm" variant="outline" onClick={() => open(row)}>Verifikasi tagihan</Button>}
    <Button size="sm" variant="outline" onClick={() => open(row)}>Detail dan catatan</Button>
  </div>;
  const cards = [
    { key: "all", label: "Lulus tes", count: scoped.length },
    { key: "belum_bayar", label: "Belum bayar", count: scoped.filter(r => monitorPaymentStatus(r.progress) === "belum_bayar").length },
    { key: "sebagian", label: "Dibayar sebagian", count: scoped.filter(r => monitorPaymentStatus(r.progress) === "sebagian").length },
    { key: "lunas", label: "Lunas", count: scoped.filter(r => monitorPaymentStatus(r.progress) === "lunas").length },
  ];
  const work = [
    { key: "terlambat", label: "Terlambat", count: scoped.filter(r => r.progress.overdueDays > 0).length, group: "urgency" as const },
    ...["belum_ada_tagihan", "belum_diatur", "perlu_verifikasi"].map(key => ({ key, label: MONITOR_READINESS_LABELS[key as keyof typeof MONITOR_READINESS_LABELS],
      count: scoped.filter(r => monitorReadiness(r.progress) === key).length, group: "readiness" as const })),
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Monitoring Pembayaran SPMB</h1>
        <p className="text-sm text-muted-foreground">Pantau uang pangkal calon siswa lulus tes, target pembayaran, dan tindak lanjut.</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Muat ulang</Button>
    </div>
    <details className="rounded-lg border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Panduan tenggat dan pembayaran</summary>
      <p className="mt-2 text-muted-foreground">Tenggat pertama 14 hari sejak lulus tes. Cicilan berikutnya 30 hari setelah cicilan sebelumnya memenuhi minimum.
        Tenggat aktif setelah skema disepakati. Pembayaran kasir dan portal dihitung dari transaksi berhasil pada tagihan tahun ajaran tujuan.</p>
    </details>
    {query.isError && <Alert variant="destructive"><AlertDescription>Gagal memuat monitoring: {query.error.message}</AlertDescription></Alert>}
    {!historyAvailable && <Alert><AlertDescription>Penyimpanan skema dan catatan belum tersedia. Hubungi administrator.</AlertDescription></Alert>}
    <section aria-label="Ringkasan pembayaran" className="space-y-2">
      <h2 className="font-semibold">Status pembayaran</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(card => <Card key={card.key}>
        <CardContent className="p-0"><button type="button" disabled={query.isLoading || query.isError}
          aria-pressed={status === card.key && readiness === "all" && urgency === "all"}
          className={"w-full rounded-lg p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " + (status === card.key && readiness === "all" && urgency === "all" ? "ring-2 ring-primary" : "")}
          onClick={() => showGroup(card.key, "payment")}><p className="text-sm text-muted-foreground">{card.label}</p>
          <p className="text-2xl font-bold">{query.isLoading || query.isError ? "—" : card.count}</p></button></CardContent>
      </Card>)}</div>
      <p className="text-xs text-muted-foreground">Tagihan yang belum dibuat atau perlu verifikasi belum masuk hitungan pembayaran.</p>
    </section>
    <section aria-label="Perlu ditindaklanjuti" className="space-y-2">
      <h2 className="font-semibold">Perlu ditindaklanjuti</h2>
      <div className="flex flex-wrap gap-2">{work.map(item => <Button key={item.key} size="sm"
        variant={(item.group === "urgency" ? urgency : readiness) === item.key ? "default" : "outline"}
        disabled={query.isLoading || query.isError} onClick={() => showGroup(item.key, item.group)}>
        {item.label} <span className="ml-1 font-bold">{query.isLoading || query.isError ? "—" : item.count}</span>
      </Button>)}</div>
    </section>
    <section aria-label="Filter calon siswa" className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Filter calon siswa</h2>
        <Button size="sm" variant="ghost" disabled={!filtersActive} onClick={resetFilters}>Reset filter</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="monitor-search">Nama / NIS</Label>
          <Input id="monitor-search" placeholder="Cari calon siswa..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="monitor-department">Lembaga tujuan</Label>
          <Select value={department} onValueChange={setDepartment}><SelectTrigger id="monitor-department"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua lembaga</SelectItem>{departments.map(([id,name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="monitor-year">Tahun ajaran tujuan</Label>
          <Select value={year} onValueChange={setYear}><SelectTrigger id="monitor-year"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua tahun ajaran</SelectItem>{years.map(([id,name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Filter pembayaran, administrasi, dan tenggat{status !== "all" || readiness !== "all" || urgency !== "all" ? " · aktif" : ""}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="monitor-payment">Pembayaran</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger id="monitor-payment"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua pembayaran</SelectItem>{Object.entries(MONITOR_PAYMENT_LABELS).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="monitor-readiness">Kesiapan administrasi</Label>
          <Select value={readiness} onValueChange={setReadiness}><SelectTrigger id="monitor-readiness"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua kesiapan</SelectItem>{Object.entries(MONITOR_READINESS_LABELS).map(([key,label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="monitor-urgency">Tenggat</Label>
          <Select value={urgency} onValueChange={setUrgency}><SelectTrigger id="monitor-urgency"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua tenggat</SelectItem><SelectItem value="terlambat">Terlambat</SelectItem><SelectItem value="mendekati">Jatuh tempo dalam 3 hari</SelectItem></SelectContent></Select></div>
        </div>
      </details>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-sm text-muted-foreground">{query.isLoading ? "Memuat calon siswa..." : query.isError ? "Data belum tersedia" : `${filtered.length} dari ${rows.length} calon siswa ditampilkan`}</p>
      <Button size="sm" variant="ghost" onClick={() => setNameOrder(nameOrder === "asc" ? "desc" : "asc")}><ArrowUpDown className="mr-2 h-4 w-4" />{nameOrder === "desc" ? "Nama Z–A" : nameOrder === "asc" ? "Nama A–Z" : "Urutkan nama"}</Button>
    </div>
    {(status !== "all" || readiness !== "all" || urgency !== "all") && <p className="text-xs text-muted-foreground">Filter aktif: {[status !== "all" ? MONITOR_PAYMENT_LABELS[status as keyof typeof MONITOR_PAYMENT_LABELS] : null,
      readiness !== "all" ? MONITOR_READINESS_LABELS[readiness as keyof typeof MONITOR_READINESS_LABELS] : null,
      urgency !== "all" ? urgency === "terlambat" ? "Terlambat" : "Jatuh tempo dalam 3 hari" : null].filter(Boolean).join(" · ")}</p>}
    {!query.isError && (query.isLoading ? <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
      : !paged.length ? <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground"><p>Tidak ada calon siswa yang sesuai filter.</p>
        {filtersActive && <Button variant="outline" className="mt-3" onClick={resetFilters}>Reset filter</Button>}</div>
      : <>
        <div className="space-y-3 md:hidden">{paged.map(row => <Card key={row.id}><CardContent className="space-y-4 p-4">
          <MonitorIdentity row={row} />
          <MonitorPayment row={row} />
          <MonitorAmounts row={row} />
          <div className="space-y-2 border-t pt-3"><MonitorReadiness row={row} /><MonitorTarget row={row} /></div>
          {rowActions(row)}
        </CardContent></Card>)}</div>
        <div className="hidden rounded-lg border md:block">
          <Table><TableHeader><TableRow>
            <TableHead className="sticky left-0 z-20 min-w-56 max-w-64 bg-card">Calon siswa</TableHead>
            <TableHead>Uang pangkal</TableHead><TableHead>Status pembayaran</TableHead>
            <TableHead>Kesiapan administrasi</TableHead><TableHead>Target berikutnya</TableHead><TableHead>Tindakan</TableHead>
          </TableRow></TableHeader><TableBody>{paged.map(row => <TableRow key={row.id}>
            <TableCell className="sticky left-0 z-10 min-w-56 max-w-64 bg-card"><MonitorIdentity row={row} /></TableCell>
            <TableCell className="min-w-48"><MonitorAmounts row={row} /></TableCell>
            <TableCell className="min-w-44 max-w-52 whitespace-normal"><MonitorPayment row={row} /></TableCell>
            <TableCell className="min-w-48 max-w-56 whitespace-normal"><MonitorReadiness row={row} /></TableCell>
            <TableCell className="min-w-44 max-w-52 whitespace-normal"><MonitorTarget row={row} /></TableCell>
            <TableCell className="min-w-48 max-w-56 whitespace-normal">{rowActions(row)}</TableCell>
          </TableRow>)}</TableBody></Table>
        </div>
      </>)}
    {!query.isError && !query.isLoading && <nav aria-label="Halaman calon siswa" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{filtered.length ? `${currentPage * 20 + 1}–${Math.min((currentPage + 1) * 20, filtered.length)} dari ${filtered.length}` : "0 data"}</span>
      <div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label="Halaman sebelumnya" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span>Hal {currentPage + 1}/{totalPages}</span><Button size="icon" variant="outline" aria-label="Halaman berikutnya" disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
    </nav>}
    <p className="text-xs text-muted-foreground">Kelulusan dan penerimaan siswa tetap terpisah dari status pembayaran.</p>
    <Dialog open={Boolean(selected)} onOpenChange={value => { if (!value && !save.isPending) setSelectedId(null); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{selected?.nama}</DialogTitle>
          <DialogDescription>{selected?.departemen_nama} · {selected?.tahun_ajaran_nama}</DialogDescription></DialogHeader>
        {selected && <>
          <div className="space-y-3 text-sm">
            <MonitorPayment row={selected} />
            <MonitorReadiness row={selected} />
            <p>Lulus tes: <strong>{dateLabel(selected.tanggal_lulus)}</strong></p>
            <MonitorAmounts row={selected} />
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
            <Textarea id="monitor-note" value={note} onChange={e => setNote(e.target.value)} aria-describedby="monitor-note-help" maxLength={2000} placeholder="Misalnya: orang tua dihubungi dan menyepakati..." />
            <p id="monitor-note-help" className="text-xs text-muted-foreground">Catatan wajib diisi, minimal 5 karakter.</p>
            <Button onClick={() => save.mutate()} disabled={!historyAvailable || save.isPending || note.trim().length < 5
              || (action === "skema" && !scheme) || (action === "perpanjangan" && !deadline)}>
              {save.isPending ? "Menyimpan..." : action === "skema" ? "Simpan skema" : action === "perpanjangan" ? "Simpan perpanjangan" : "Simpan catatan"}</Button>
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
